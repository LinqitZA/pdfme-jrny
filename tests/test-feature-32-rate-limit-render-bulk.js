/**
 * Feature #32: Rate limiting on render/bulk endpoint
 * POST /api/pdfme/render/bulk limited to 5 req/hour per tenant
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

const TENANT_A = makeToken('bulk-rate-a', 'org-bulk-rate-a', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);
const TENANT_B = makeToken('bulk-rate-b', 'org-bulk-rate-b', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);

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

async function createAndPublishTemplate(token) {
  const schema = {
    pages: [{
      elements: [
        { name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Bulk Test' }
      ]
    }]
  };

  const createRes = await api('/api/pdfme/templates', {
    method: 'POST', token,
    body: { name: `Bulk Rate Test ${Date.now()}`, type: 'invoice', schema }
  });
  const id = createRes.json?.id;
  if (!id) return null;

  await api(`/api/pdfme/templates/${id}/publish`, { method: 'POST', token });
  return id;
}

async function resetRateLimits(token) {
  await api('/api/pdfme/render/rate-limit/reset', { method: 'POST', token, body: {} });
}

async function run() {
  console.log('Feature #32: Rate limiting on render/bulk endpoint\n');

  // Setup
  console.log('Setup: Creating test template...');
  templateIdA = await createAndPublishTemplate(TENANT_A);
  assert(templateIdA !== null, 'Created and published test template');

  // Reset rate limits
  await resetRateLimits(TENANT_A);
  await resetRateLimits(TENANT_B);

  // Test 1: Send 5 bulk render requests - all should succeed (202) or conflict (409), but NOT 429
  console.log('\nTest 1: Send 5 bulk requests - none return 429');
  let non429Count = 0;
  let got202Count = 0;
  for (let i = 1; i <= 5; i++) {
    // Small delay between requests to reduce conflicts
    if (i > 1) await new Promise(r => setTimeout(r, 200));
    const res = await api('/api/pdfme/render/bulk', {
      method: 'POST', token: TENANT_A,
      body: {
        templateId: templateIdA,
        entityIds: [`bulk-entity-${i}-a`, `bulk-entity-${i}-b`],
        channel: 'email',
      }
    });
    if (res.status !== 429) non429Count++;
    if (res.status === 202) got202Count++;
  }
  assert(non429Count === 5, `All 5 bulk requests not rate-limited (${non429Count}/5 non-429)`);
  assert(got202Count >= 1, `At least 1 request returned 202 (got ${got202Count})`);

  // Test 2: 6th request should return 429
  console.log('\nTest 2: 6th request returns 429');
  const overLimit = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TENANT_A,
    body: {
      templateId: templateIdA,
      entityIds: ['bulk-over-1', 'bulk-over-2'],
      channel: 'email',
    }
  });
  assert(overLimit.status === 429, `6th request returns 429 (got ${overLimit.status})`);
  assert(overLimit.json?.error === 'Too Many Requests', `Error is "Too Many Requests"`);
  assert(typeof overLimit.json?.message === 'string' && overLimit.json.message.includes('Rate limit'), 'Message mentions rate limit');

  // Test 3: Retry-After header present
  console.log('\nTest 3: Retry-After header present');
  const retryAfter = overLimit.headers.get('retry-after');
  assert(retryAfter !== null && retryAfter !== undefined, `Retry-After header present (value: ${retryAfter})`);
  const retryVal = parseInt(retryAfter);
  assert(!isNaN(retryVal) && retryVal > 0, `Retry-After is positive integer`);
  assert(overLimit.json?.retryAfter > 0, `retryAfter in response body (${overLimit.json?.retryAfter})`);

  // Test 4: Different tenant not affected
  console.log('\nTest 4: Different tenant can still make bulk requests');
  const templateIdB = await createAndPublishTemplate(TENANT_B);
  if (templateIdB) {
    const tenantBRes = await api('/api/pdfme/render/bulk', {
      method: 'POST', token: TENANT_B,
      body: {
        templateId: templateIdB,
        entityIds: ['bulk-b-1', 'bulk-b-2'],
        channel: 'email',
      }
    });
    assert(tenantBRes.status !== 429, `Tenant B not rate limited (status: ${tenantBRes.status})`);
  } else {
    assert(false, 'Could not create template for tenant B');
  }

  // Test 5: Rate limit status shows bulk usage
  console.log('\nTest 5: Rate limit status shows bulk usage');
  const statusRes = await api('/api/pdfme/render/rate-limit/status', { token: TENANT_A });
  assert(statusRes.status === 200, 'Rate limit status returns 200');
  assert(statusRes.json?.renderBulk?.used >= 5, `Shows 5+ used for renderBulk (${statusRes.json?.renderBulk?.used})`);
  assert(statusRes.json?.renderBulk?.remaining === 0, `Shows 0 remaining (${statusRes.json?.renderBulk?.remaining})`);
  assert(statusRes.json?.renderBulk?.limit === 5, `Limit is 5 (${statusRes.json?.renderBulk?.limit})`);

  // Test 6: After reset, bulk requests work again
  console.log('\nTest 6: After reset, bulk requests work again');
  await resetRateLimits(TENANT_A);
  const afterReset = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TENANT_A,
    body: {
      templateId: templateIdA,
      entityIds: ['bulk-reset-1'],
      channel: 'email',
    }
  });
  assert(afterReset.status !== 429, `After reset, not rate limited (status: ${afterReset.status})`);

  // Test 7: 7th request over limit also returns 429 + Retry-After
  console.log('\nTest 7: Additional over-limit requests also get 429');
  await resetRateLimits(TENANT_A);
  for (let i = 0; i < 5; i++) {
    await api('/api/pdfme/render/bulk', {
      method: 'POST', token: TENANT_A,
      body: { templateId: templateIdA, entityIds: [`fill-b-${i}`], channel: 'email' }
    });
  }
  const over2 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TENANT_A,
    body: { templateId: templateIdA, entityIds: ['over-2'], channel: 'email' }
  });
  assert(over2.status === 429, 'Additional over-limit returns 429');
  assert(over2.headers.get('retry-after') !== null, 'Has Retry-After header');

  // Cleanup
  await resetRateLimits(TENANT_A);
  await resetRateLimits(TENANT_B);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
