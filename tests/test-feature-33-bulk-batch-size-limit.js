/**
 * Feature #33: Bulk batch size limited to 2000 entityIds
 * Bulk render rejects requests exceeding 2000 entityIds
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

const TOKEN = makeToken('batch-size-user', 'org-batch-size', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);

let passed = 0;
let failed = 0;
let templateId = null;

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

function generateEntityIds(count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(`entity-${i}`);
  }
  return ids;
}

async function createAndPublishTemplate() {
  const schema = {
    pages: [{
      elements: [
        { name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }
      ]
    }]
  };

  const createRes = await api('/api/pdfme/templates', {
    method: 'POST', token: TOKEN,
    body: { name: `Batch Size Test ${Date.now()}`, type: 'invoice', schema }
  });
  const id = createRes.json?.id;
  if (!id) return null;

  await api(`/api/pdfme/templates/${id}/publish`, { method: 'POST', token: TOKEN });
  return id;
}

async function resetRateLimits() {
  await api('/api/pdfme/render/rate-limit/reset', { method: 'POST', token: TOKEN, body: {} });
}

async function run() {
  console.log('Feature #33: Bulk batch size limited to 2000 entityIds\n');

  // Setup
  console.log('Setup: Creating test template...');
  templateId = await createAndPublishTemplate();
  assert(templateId !== null, 'Created and published test template');

  // Reset rate limits to avoid interference
  await resetRateLimits();

  // Test 1: 2000 entityIds accepted (not rejected for batch size)
  console.log('\nTest 1: 2000 entityIds accepted');
  // Use a fresh template to avoid conflict from previous batches
  const freshTemplateId = await createAndPublishTemplate();
  const res2000 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: freshTemplateId || templateId,
      entityIds: generateEntityIds(2000),
      channel: 'email',
    }
  });
  assert(res2000.status === 202 || res2000.status === 409, `2000 entityIds accepted (got ${res2000.status})`);
  assert(res2000.status !== 400, '2000 entityIds is NOT rejected for batch size (no 400)');

  // Reset rate limit after successful request
  await resetRateLimits();

  // Test 2: 2001 entityIds returns 400
  console.log('\nTest 2: 2001 entityIds returns 400');
  const res2001 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      entityIds: generateEntityIds(2001),
      channel: 'email',
    }
  });
  assert(res2001.status === 400, `2001 entityIds returns 400 (got ${res2001.status})`);
  assert(typeof res2001.json?.message === 'string' && (
    res2001.json.message.toLowerCase().includes('maximum') ||
    res2001.json.message.toLowerCase().includes('2000') ||
    res2001.json.message.toLowerCase().includes('batch size') ||
    res2001.json.message.toLowerCase().includes('entityids')
  ), `Error message mentions maximum batch size (got "${res2001.json?.message}")`);

  // Test 3: Error details include entityIds info
  console.log('\nTest 3: Error includes details about batch size');
  const details = res2001.json?.details;
  assert(Array.isArray(details) && details.length > 0, 'Error includes details array');
  const entityIdsDetail = details?.find(d => d.field === 'entityIds');
  assert(entityIdsDetail !== undefined, 'Details include entityIds field');
  assert(entityIdsDetail?.reason?.includes('2000') || entityIdsDetail?.reason?.includes('maximum'), 'Reason mentions maximum limit');

  // Test 4: Large batch (5000 entityIds) also rejected
  console.log('\nTest 4: 5000 entityIds also rejected');
  const res5000 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      entityIds: generateEntityIds(5000),
      channel: 'email',
    }
  });
  assert(res5000.status === 400, `5000 entityIds returns 400 (got ${res5000.status})`);

  // Test 5: Exactly 1999 entityIds accepted (202 or 409 conflict - both mean not rejected for size)
  console.log('\nTest 5: 1999 entityIds accepted (not rejected for batch size)');
  await resetRateLimits();
  const res1999 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      entityIds: generateEntityIds(1999),
      channel: 'email',
    }
  });
  assert(res1999.status === 202 || res1999.status === 409, `1999 entityIds not rejected for size (got ${res1999.status})`);
  assert(res1999.status !== 400, '1999 entityIds does not return 400 Bad Request');

  // Test 6: Small batch (10 entityIds) accepted
  console.log('\nTest 6: Small batch (10 entityIds) accepted');
  await resetRateLimits();
  const res10 = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      entityIds: generateEntityIds(10),
      channel: 'email',
    }
  });
  assert(res10.status === 202 || res10.status === 409, `10 entityIds accepted (got ${res10.status})`);
  assert(res10.status !== 400, '10 entityIds does not return 400');

  // Test 7: Error message specifically mentions "Maximum 2000"
  console.log('\nTest 7: Error message mentions maximum and 2000');
  const resOverMsg = await api('/api/pdfme/render/bulk', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      entityIds: generateEntityIds(3000),
      channel: 'email',
    }
  });
  assert(resOverMsg.json?.message?.includes('2000'), `Message contains "2000" (got "${resOverMsg.json?.message}")`);

  // Cleanup
  await resetRateLimits();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
