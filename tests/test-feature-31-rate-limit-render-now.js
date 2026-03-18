/**
 * Feature #31: Rate limiting on render/now endpoint
 * POST /api/pdfme/render/now limited to 60 req/min per tenant
 */

const crypto = require('crypto');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TENANT_A = makeToken('rate-user-a', 'org-rate-a', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);
const TENANT_B = makeToken('rate-user-b', 'org-rate-b', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);

let passed = 0;
let failed = 0;
let templateIdA = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

async function createAndPublishTemplate(token, orgId) {
  const schema = {
    pages: [{
      elements: [
        { name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Hello' }
      ]
    }]
  };

  const createRes = await api('/api/pdfme/templates', {
    method: 'POST', token,
    body: { name: `Rate Limit Test ${orgId} ${Date.now()}`, type: 'invoice', schema }
  });
  const id = createRes.json?.id;
  if (!id) { console.log('Template create failed:', JSON.stringify(createRes.json).substring(0, 200)); return null; }

  await api(`/api/pdfme/templates/${id}/publish`, { method: 'POST', token });
  return id;
}

async function resetRateLimits(token) {
  await api('/api/pdfme/render/rate-limit/reset', { method: 'POST', token, body: {} });
}

async function run() {
  console.log('Feature #31: Rate limiting on render/now endpoint\n');

  // Setup
  console.log('Setup: Creating test template...');
  templateIdA = await createAndPublishTemplate(TENANT_A, 'org-rate-a');
  assert(templateIdA !== null, 'Created and published test template for tenant A');

  // Reset rate limits before testing
  await resetRateLimits(TENANT_A);

  // Test 1: Send 60 valid render requests - all should succeed (not get 429)
  console.log('\nTest 1: Send 60 requests - none should return 429');
  let non429Count = 0;
  const batchSize = 15;
  for (let batch = 0; batch < 4; batch++) {
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      const reqNum = batch * batchSize + i + 1;
      promises.push(api('/api/pdfme/render/now', {
        method: 'POST', token: TENANT_A,
        body: { templateId: templateIdA, entityId: `rate-test-${reqNum}`, channel: 'email' }
      }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status !== 429) non429Count++;
    }
  }
  assert(non429Count === 60, `All 60 requests not rate-limited (got ${non429Count}/60 non-429)`);

  // Test 2: 61st request should be rate limited (429)
  console.log('\nTest 2: 61st request should return 429');
  const overLimit = await api('/api/pdfme/render/now', {
    method: 'POST', token: TENANT_A,
    body: { templateId: templateIdA, entityId: 'rate-test-61', channel: 'email' }
  });
  assert(overLimit.status === 429, `61st request returns 429 (got ${overLimit.status})`);
  assert(overLimit.json?.error === 'Too Many Requests', `Error is "Too Many Requests" (got "${overLimit.json?.error}")`);
  assert(typeof overLimit.json?.message === 'string' && overLimit.json.message.includes('Rate limit'), `Message mentions rate limit`);

  // Test 3: Retry-After header present
  console.log('\nTest 3: Retry-After header present');
  const retryAfter = overLimit.headers.get('retry-after');
  assert(retryAfter !== null && retryAfter !== undefined, `Retry-After header present (value: ${retryAfter})`);
  const retryVal = parseInt(retryAfter);
  assert(!isNaN(retryVal) && retryVal > 0, `Retry-After is positive integer (${retryAfter})`);
  assert(overLimit.json?.retryAfter > 0, `retryAfter in response body (${overLimit.json?.retryAfter})`);

  // Test 4: Different tenant can still make requests
  console.log('\nTest 4: Different tenant (B) can still make requests');
  const templateIdB = await createAndPublishTemplate(TENANT_B, 'org-rate-b');
  if (templateIdB) {
    const tenantBRes = await api('/api/pdfme/render/now', {
      method: 'POST', token: TENANT_B,
      body: { templateId: templateIdB, entityId: 'rate-test-b-1', channel: 'email' }
    });
    assert(tenantBRes.status !== 429, `Tenant B is not rate limited (status: ${tenantBRes.status})`);
  } else {
    const tenantBRes = await api('/api/pdfme/render/now', {
      method: 'POST', token: TENANT_B,
      body: { templateId: 'nonexistent', entityId: 'rate-test-b-1', channel: 'email' }
    });
    assert(tenantBRes.status !== 429, `Tenant B is not rate limited (status: ${tenantBRes.status})`);
  }

  // Test 5: Rate limit status endpoint
  console.log('\nTest 5: Rate limit status endpoint');
  const statusRes = await api('/api/pdfme/render/rate-limit/status', { token: TENANT_A });
  assert(statusRes.status === 200, `Rate limit status returns 200`);
  assert(statusRes.json?.renderNow?.used >= 60, `Shows 60+ used for renderNow (${statusRes.json?.renderNow?.used})`);
  assert(statusRes.json?.renderNow?.remaining === 0, `Shows 0 remaining (${statusRes.json?.renderNow?.remaining})`);
  assert(statusRes.json?.renderNow?.limit === 60, `Limit is 60 (${statusRes.json?.renderNow?.limit})`);

  // Test 6: After reset, requests work again
  console.log('\nTest 6: After reset, requests succeed again');
  await resetRateLimits(TENANT_A);
  const afterReset = await api('/api/pdfme/render/now', {
    method: 'POST', token: TENANT_A,
    body: { templateId: templateIdA, entityId: 'rate-test-after-reset', channel: 'email' }
  });
  assert(afterReset.status !== 429, `After reset, request not rate-limited (status: ${afterReset.status})`);

  // Test 7: Additional over-limit requests also return 429 + Retry-After
  console.log('\nTest 7: Multiple over-limit requests all return 429 with Retry-After');
  await resetRateLimits(TENANT_A);
  // Fill up
  const fillPromises = [];
  for (let i = 0; i < 60; i++) {
    fillPromises.push(api('/api/pdfme/render/now', {
      method: 'POST', token: TENANT_A,
      body: { templateId: templateIdA, entityId: `fill-${i}`, channel: 'email' }
    }));
  }
  await Promise.all(fillPromises);

  const over1 = await api('/api/pdfme/render/now', {
    method: 'POST', token: TENANT_A,
    body: { templateId: templateIdA, entityId: 'over1', channel: 'email' }
  });
  const over2 = await api('/api/pdfme/render/now', {
    method: 'POST', token: TENANT_A,
    body: { templateId: templateIdA, entityId: 'over2', channel: 'email' }
  });
  assert(over1.status === 429, 'Over-limit request 1 returns 429');
  assert(over2.status === 429, 'Over-limit request 2 returns 429');
  assert(over1.headers.get('retry-after') !== null, 'Over-limit request 1 has Retry-After header');
  assert(over2.headers.get('retry-after') !== null, 'Over-limit request 2 has Retry-After header');

  // Cleanup
  await resetRateLimits(TENANT_A);
  await resetRateLimits(TENANT_B);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
