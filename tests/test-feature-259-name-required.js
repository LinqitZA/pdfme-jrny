/**
 * Feature #259: Template name required on create
 * Template creation requires name field
 */

const crypto = require('crypto');
const API_BASE = 'http://localhost:3000/api/pdfme';
const ORG_ID = 'org-test-259';

function makeToken() {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub:'user-test-259',orgId:ORG_ID,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${makeToken()}` };

let passed = 0, failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) { passed++; results.push(`  ✅ ${testName}`); }
  else { failed++; results.push(`  ❌ ${testName}`); }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function runTests() {
  console.log('Feature #259: Template name required on create\n');
  const createdIds = [];

  // Test 1: POST without name field at all
  const res1 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res1.status === 400, 'POST without name returns 400');
  assert(res1.body.error === 'Bad Request', 'Error type is Bad Request');
  assert(
    res1.body.details && res1.body.details.some(d => d.field === 'name'),
    'Error details include name field error'
  );

  // Test 4: POST with empty string name
  const res2 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: '', type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res2.status === 400, 'POST with empty string name returns 400');
  assert(
    res2.body.details && res2.body.details.some(d => d.field === 'name'),
    'Empty name error details include name field'
  );

  // Test 6: POST with whitespace-only name
  const res3 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: '   ', type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res3.status === 400, 'POST with whitespace-only name returns 400');

  // Test 7: POST with null name
  const res4 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: null, type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res4.status === 400, 'POST with null name returns 400');

  // Test 8: POST with valid name succeeds
  const res5 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'VALID_TEST_259', type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res5.status === 201, 'POST with valid name returns 201');
  assert(res5.body.name === 'VALID_TEST_259', 'Created template has correct name');
  assert(res5.body.id, 'Created template has an id');
  if (res5.body.id) createdIds.push(res5.body.id);

  // Test 11: POST with valid name and default type succeeds
  const res6 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'VALID_TEST_259_notype', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res6.status === 201, 'POST without type defaults correctly and returns 201');
  assert(res6.body.type === 'custom', 'Default type is custom');
  if (res6.body.id) createdIds.push(res6.body.id);

  // Test 13: Error response includes proper error envelope
  assert(res1.body.statusCode === 400, 'Error envelope has statusCode 400');
  assert(typeof res1.body.message === 'string', 'Error envelope has message string');
  assert(Array.isArray(res1.body.details), 'Error envelope has details array');

  // Test 16: POST without both name and schema
  const res7 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ type: 'invoice', orgId: ORG_ID }),
  });
  assert(res7.status === 400, 'POST without name and schema returns 400');
  assert(
    res7.body.details && res7.body.details.length >= 2,
    'Missing both name and schema reports both in details'
  );

  // Test 18: Valid name with spaces works
  const res8 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'My Test Template 259', type: 'custom', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res8.status === 201, 'Name with spaces is accepted');
  if (res8.body.id) createdIds.push(res8.body.id);

  // Test 19: Verify created template appears in list
  const listRes = await fetchJSON(`${API_BASE}/templates?search=VALID_TEST_259&orgId=${ORG_ID}&limit=10`);
  assert(listRes.status === 200, 'Search for created template returns 200');
  const found = (listRes.body.data || []).some(t => t.name === 'VALID_TEST_259');
  assert(found, 'Created template appears in template list');

  // Test 21: Response content-type is JSON
  const rawRes = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(
    rawRes.headers.get('content-type')?.includes('application/json'),
    'Error response has application/json content-type'
  );

  // Cleanup
  for (const id of createdIds) {
    if (id) await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers });
  }
  console.log(`Cleaned up ${createdIds.filter(Boolean).length} test templates`);

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${passed + failed} tests passing`);
  console.log(`========================================`);
  results.forEach(r => console.log(r));
  if (failed > 0) process.exit(1);
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
