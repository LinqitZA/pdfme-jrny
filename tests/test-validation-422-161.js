/**
 * Test for Feature #161: API returns 422 for validation failures
 * Steps:
 * 1. POST publish with invalid bindings
 * 2. Verify 422 response
 * 3. Verify details array with specific validation errors
 * 4. Each error has field and message
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function makeJwt(sub = 'test-user-161', orgId = 'org-validation-161') {
  const payload = { sub, orgId, roles: ['user'] };
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

const TOKEN = makeJwt();
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function createTemplate(name, schema) {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name, type: 'invoice', schema }),
  });
  return res.json();
}

async function publishTemplate(id) {
  return fetch(`${BASE}/templates/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
}

async function cleanup(id) {
  await fetch(`${BASE}/templates/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

async function run() {
  console.log('=== Feature #161: API returns 422 for validation failures ===\n');

  // Test 1: Invalid binding expressions
  console.log('Test 1: Template with invalid bindings');
  const t1 = await createTemplate('Invalid Bindings 161', {
    pages: [{
      elements: [
        { type: 'text', content: '{{}}', position: { x: 10, y: 10 } },
        { type: 'text', content: '{{invalid binding with spaces}}', position: { x: 10, y: 30 } },
        { type: 'text', content: '{{valid_field}}', position: { x: 10, y: 50 } },
      ],
    }],
  });
  const res1 = await publishTemplate(t1.id);
  const data1 = await res1.json();
  assert(res1.status === 422, `Invalid bindings returns 422 (got ${res1.status})`);
  assert(data1.error === 'Unprocessable Entity', 'Error is "Unprocessable Entity"');
  assert(data1.message === 'Template validation failed', 'Message is "Template validation failed"');
  assert(Array.isArray(data1.details), 'Response has details array');
  assert(data1.details.length >= 2, `Has at least 2 errors (got ${data1.details?.length})`);

  // Check each error has field and message
  const allHaveField = data1.details.every(e => typeof e.field === 'string' && e.field.length > 0);
  const allHaveMessage = data1.details.every(e => typeof e.message === 'string' && e.message.length > 0);
  assert(allHaveField, 'Each error has a field property');
  assert(allHaveMessage, 'Each error has a message property');

  // Check specific errors
  const emptyBinding = data1.details.find(e => e.message.includes('Empty binding'));
  assert(!!emptyBinding, 'Has error for empty binding {{}}');
  const invalidBinding = data1.details.find(e => e.message.includes('Invalid binding'));
  assert(!!invalidBinding, 'Has error for invalid binding expression');
  await cleanup(t1.id);

  // Test 2: Empty pages
  console.log('\nTest 2: Template with empty pages');
  const t2 = await createTemplate('Empty Pages 161', {
    pages: [],
  });
  const res2 = await publishTemplate(t2.id);
  const data2 = await res2.json();
  assert(res2.status === 422, `Empty pages returns 422 (got ${res2.status})`);
  assert(data2.details.some(e => e.message.includes('at least one page')), 'Error mentions at least one page');
  await cleanup(t2.id);

  // Test 3: Element with negative position
  console.log('\nTest 3: Element with negative position');
  const t3 = await createTemplate('Bad Position 161', {
    pages: [{
      elements: [
        { type: 'text', content: 'Hello', position: { x: -5, y: 10 } },
      ],
    }],
  });
  const res3 = await publishTemplate(t3.id);
  const data3 = await res3.json();
  assert(res3.status === 422, `Negative position returns 422 (got ${res3.status})`);
  assert(data3.details.some(e => e.field.includes('position') && e.message.includes('non-negative')),
    'Error mentions position must be non-negative');
  await cleanup(t3.id);

  // Test 4: Element without type
  console.log('\nTest 4: Element without type');
  const t4 = await createTemplate('No Type 161', {
    pages: [{
      elements: [
        { content: 'Hello', position: { x: 10, y: 10 } },
      ],
    }],
  });
  const res4 = await publishTemplate(t4.id);
  const data4 = await res4.json();
  assert(res4.status === 422, `Missing type returns 422 (got ${res4.status})`);
  assert(data4.details.some(e => e.message.includes('type')), 'Error mentions element must have type');
  await cleanup(t4.id);

  // Test 5: Valid template publishes successfully
  console.log('\nTest 5: Valid template publishes OK');
  const t5 = await createTemplate('Valid Template 161', {
    pages: [{
      elements: [
        { type: 'text', content: '{{company.name}}', position: { x: 10, y: 10 } },
        { type: 'text', content: 'Static text', position: { x: 10, y: 30 } },
      ],
    }],
  });
  const res5 = await publishTemplate(t5.id);
  assert(res5.status === 200 || res5.status === 201, `Valid template publishes with 200/201 (got ${res5.status})`);
  const data5 = await res5.json();
  assert(data5.status === 'published', 'Template status is published');
  await cleanup(t5.id);

  // Test 6: Multiple errors returned at once
  console.log('\nTest 6: Multiple validation errors');
  const t6 = await createTemplate('Multi Error 161', {
    pages: [{
      elements: [
        { content: '{{}}', position: { x: -1, y: -2 } },
        { type: 'text', content: '{{bad expr!}}' },
      ],
    }],
  });
  const res6 = await publishTemplate(t6.id);
  const data6 = await res6.json();
  assert(res6.status === 422, `Multiple errors returns 422 (got ${res6.status})`);
  assert(data6.details.length >= 3, `Has 3+ errors (got ${data6.details?.length}): type missing, bad position, bad binding`);
  await cleanup(t6.id);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
