/**
 * Feature #260: Template type required and validated
 * Template type must be valid enum value
 */

const crypto = require('crypto');
const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const ORG_ID = 'org-test-260';

function makeToken() {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub:'user-test-260',orgId:ORG_ID,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
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

const VALID_TYPES = [
  'invoice', 'statement', 'purchase_order', 'delivery_note', 'credit_note',
  'report_aged_debtors', 'report_stock_on_hand', 'report_sales_summary',
  'report', 'custom',
];

async function runTests() {
  console.log('Feature #260: Template type required and validated\n');
  const createdIds = [];

  // === Section 1: Type is required ===
  console.log('--- Section 1: Type Required ---');

  // Test 1: POST without type returns 400
  const res1 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'NoType260', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res1.status === 400, 'POST without type returns 400');
  assert(
    res1.body.details && res1.body.details.some(d => d.field === 'type'),
    'Error details include type field error'
  );

  // Test 3: POST with empty string type returns 400
  const res2 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'EmptyType260', type: '', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res2.status === 400, 'POST with empty string type returns 400');

  // Test 4: POST with null type returns 400
  const res3 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'NullType260', type: null, orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res3.status === 400, 'POST with null type returns 400');

  // Test 5: POST with whitespace-only type returns 400
  const res4 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'WhitespaceType260', type: '   ', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res4.status === 400, 'POST with whitespace-only type returns 400');

  // === Section 2: Invalid type values rejected ===
  console.log('\n--- Section 2: Invalid Types Rejected ---');

  // Test 6: POST with invalid_type returns 400
  const res5 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'InvalidType260', type: 'invalid_type', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res5.status === 400, 'POST with type=invalid_type returns 400');
  assert(
    res5.body.details && res5.body.details.some(d => d.field === 'type'),
    'Invalid type error details include type field'
  );
  assert(
    res5.body.message && res5.body.message.includes('invalid_type'),
    'Error message mentions the invalid type value'
  );

  // Test 9: POST with random string type returns 400
  const res6 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Random260', type: 'foobar123', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res6.status === 400, 'POST with type=foobar123 returns 400');

  // Test 10: POST with numeric type returns 400
  const res7 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'NumType260', type: '12345', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res7.status === 400, 'POST with numeric type string returns 400');

  // Test 11: POST with SQL injection type returns 400
  const res8 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'SQLType260', type: "invoice' OR '1'='1", orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res8.status === 400, 'POST with SQL injection type returns 400');

  // === Section 3: Valid types accepted ===
  console.log('\n--- Section 3: Valid Types Accepted ---');

  // Test 12: POST with type=invoice succeeds
  const res9 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Invoice260', type: 'invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res9.status === 201, 'POST with type=invoice returns 201');
  assert(res9.body.type === 'invoice', 'Created template has type=invoice');
  if (res9.body.id) createdIds.push(res9.body.id);

  // Test 14: POST with type=statement succeeds
  const res10 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Statement260', type: 'statement', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res10.status === 201, 'POST with type=statement returns 201');
  if (res10.body.id) createdIds.push(res10.body.id);

  // Test 15: POST with type=custom succeeds
  const res11 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Custom260', type: 'custom', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res11.status === 201, 'POST with type=custom returns 201');
  if (res11.body.id) createdIds.push(res11.body.id);

  // Test 16: POST with type=purchase_order succeeds
  const res12 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'PO260', type: 'purchase_order', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res12.status === 201, 'POST with type=purchase_order returns 201');
  if (res12.body.id) createdIds.push(res12.body.id);

  // Test 17: POST with type=credit_note succeeds
  const res13 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'CN260', type: 'credit_note', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res13.status === 201, 'POST with type=credit_note returns 201');
  if (res13.body.id) createdIds.push(res13.body.id);

  // Test 18: POST with type=report succeeds
  const res14 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Report260', type: 'report', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res14.status === 201, 'POST with type=report returns 201');
  if (res14.body.id) createdIds.push(res14.body.id);

  // Test 19: POST with type=report_aged_debtors succeeds
  const res15 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'AgedDebtors260', type: 'report_aged_debtors', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res15.status === 201, 'POST with type=report_aged_debtors returns 201');
  if (res15.body.id) createdIds.push(res15.body.id);

  // === Section 4: Error envelope quality ===
  console.log('\n--- Section 4: Error Envelope Quality ---');

  // Test 20: Error has proper structure
  assert(res5.body.statusCode === 400, 'Error has statusCode 400');
  assert(res5.body.error === 'Bad Request', 'Error has error field');
  assert(typeof res5.body.message === 'string', 'Error has message string');
  assert(Array.isArray(res5.body.details), 'Error has details array');

  // Test 24: Error message lists valid types
  assert(
    res5.body.message.includes('invoice') || (res5.body.details[0]?.reason || '').includes('invoice'),
    'Error message or details lists valid types'
  );

  // Test 25: Content-type is JSON for error
  const rawRes = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Test', type: 'bad_type', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(
    rawRes.headers.get('content-type')?.includes('application/json'),
    'Error response content-type is application/json'
  );

  // === Section 5: Case sensitivity ===
  console.log('\n--- Section 5: Case Sensitivity ---');

  // Test 26: Uppercase type rejected
  const res16 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Upper260', type: 'INVOICE', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res16.status === 400, 'Uppercase INVOICE is rejected (case-sensitive)');

  // Test 27: Mixed case type rejected
  const res17 = await fetchJSON(`${API_BASE}/templates`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Mixed260', type: 'Invoice', orgId: ORG_ID, schema: { type: 'text' } }),
  });
  assert(res17.status === 400, 'Mixed case Invoice is rejected');

  // Cleanup
  console.log('\n--- Cleanup ---');
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
