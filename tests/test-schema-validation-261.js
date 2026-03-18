const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t261', orgId: 'org-t261', roles: ['template:edit', 'template:publish'] });

function req(m, p, b) {
  return new Promise((ok, no) => {
    const u = new URL(p);
    const o = { method: m, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    const r = http.request(o, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch(e) { ok({ s: res.statusCode, b: d }); } }); });
    r.on('error', no);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}

let pass = 0;
let fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; console.log('  PASS: ' + msg); }
  else { fail++; console.log('  FAIL: ' + msg); }
}

async function go() {
  console.log('=== Feature #261: Template schema must be valid JSON ===\n');

  // Create a template to test PUT endpoints against
  const validSchema = { pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Hello' }] }] };
  const createRes = await req('POST', 'http://localhost:3000/api/pdfme/templates', {
    name: 'Schema Validation Test 261',
    type: 'invoice',
    schema: validSchema,
  });
  assert(createRes.s === 201, 'Created test template: ' + createRes.s);
  const tid = createRes.b.id;
  console.log('  Template ID: ' + tid);

  // === Test 1: PUT /templates/:id with schema as string (malformed) -> 400 ===
  console.log('\n--- Test: PUT update with schema as string ---');
  const r1 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: 'this is not json'
  });
  assert(r1.s === 400, 'PUT with string schema returns 400, got ' + r1.s);
  assert(r1.b.details && r1.b.details.length > 0, 'Response includes details array');
  assert(r1.b.details && r1.b.details[0].field === 'schema', 'Details reference schema field');
  console.log('  Response: ' + JSON.stringify(r1.b).substring(0, 200));

  // === Test 2: PUT /templates/:id/draft with schema as string -> 400 ===
  console.log('\n--- Test: PUT draft with schema as string ---');
  const r2 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid + '/draft', {
    schema: '{"broken json'
  });
  assert(r2.s === 400, 'PUT draft with string schema returns 400, got ' + r2.s);
  assert(r2.b.error === 'Bad Request', 'Error type is Bad Request');
  assert(r2.b.details && r2.b.details[0].field === 'schema', 'Details reference schema field');

  // === Test 3: PUT with schema as array -> 400 ===
  console.log('\n--- Test: PUT with schema as array ---');
  const r3 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: [1, 2, 3]
  });
  assert(r3.s === 400, 'PUT with array schema returns 400, got ' + r3.s);
  assert(r3.b.details && r3.b.details[0].reason.includes('array'), 'Details mention array');

  // === Test 4: PUT with schema as number -> 400 ===
  console.log('\n--- Test: PUT with schema as number ---');
  const r4 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: 42
  });
  assert(r4.s === 400, 'PUT with number schema returns 400, got ' + r4.s);

  // === Test 5: PUT with schema as boolean -> 400 ===
  console.log('\n--- Test: PUT with schema as boolean ---');
  const r5 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: true
  });
  assert(r5.s === 400, 'PUT with boolean schema returns 400, got ' + r5.s);

  // === Test 6: PUT with schema as null -> 400 ===
  console.log('\n--- Test: PUT with schema as null ---');
  const r6 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: null
  });
  assert(r6.s === 400, 'PUT with null schema returns 400, got ' + r6.s);
  assert(r6.b.details && r6.b.details[0].field === 'schema', 'Details reference schema field');

  // === Test 7: PUT with valid JSON but wrong structure (pages not array) -> 422 ===
  console.log('\n--- Test: PUT with valid JSON but pages as string ---');
  const r7 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: { pages: 'not-an-array' }
  });
  assert(r7.s === 422, 'PUT with pages as string returns 422, got ' + r7.s);
  assert(r7.b.error === 'Unprocessable Entity', 'Error type is Unprocessable Entity');
  assert(r7.b.details && r7.b.details.some(d => d.field === 'schema.pages'), 'Details reference schema.pages field');
  console.log('  Response: ' + JSON.stringify(r7.b).substring(0, 250));

  // === Test 8: PUT draft with valid JSON but wrong structure -> 422 ===
  console.log('\n--- Test: PUT draft with pages as number ---');
  const r8 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid + '/draft', {
    schema: { pages: 123 }
  });
  assert(r8.s === 422, 'PUT draft with pages as number returns 422, got ' + r8.s);
  assert(r8.b.details && r8.b.details.length > 0, 'Has specific validation errors');

  // === Test 9: PUT with pages containing non-object entries -> 422 ===
  console.log('\n--- Test: PUT with pages containing non-objects ---');
  const r9 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: { pages: ['not-an-object', 123] }
  });
  assert(r9.s === 422, 'PUT with non-object pages returns 422, got ' + r9.s);
  assert(r9.b.details && r9.b.details.length >= 2, 'Has errors for each invalid page entry');

  // === Test 10: PUT with valid schema -> 200 ===
  console.log('\n--- Test: PUT with valid schema ---');
  const r10 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: { pages: [{ elements: [{ type: 'text', position: { x: 20, y: 20 }, width: 100, height: 20, content: 'Updated' }] }] }
  });
  assert(r10.s === 200, 'PUT with valid schema returns 200, got ' + r10.s);
  assert(r10.b.id === tid, 'Returns updated template');

  // === Test 11: PUT draft with valid schema -> 200 ===
  console.log('\n--- Test: PUT draft with valid schema ---');
  const r11 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid + '/draft', {
    schema: { pages: [{ elements: [] }] }
  });
  assert(r11.s === 200, 'PUT draft with valid schema returns 200, got ' + r11.s);

  // === Test 12: PUT with empty object schema (no pages) -> 200 (valid JSON object, no structural issues) ===
  console.log('\n--- Test: PUT with empty object schema (no pages key) ---');
  const r12 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: {}
  });
  assert(r12.s === 200, 'PUT with empty object schema returns 200 (pages not required for draft), got ' + r12.s);

  // === Test 13: PUT with schemas key (alternative to pages) -> 200 ===
  console.log('\n--- Test: PUT with schemas key instead of pages ---');
  const r13 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: { schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10 }]] }
  });
  assert(r13.s === 200, 'PUT with schemas key returns 200, got ' + r13.s);

  // === Test 14: PUT with basePdf as invalid type -> 422 ===
  console.log('\n--- Test: PUT with basePdf as number ---');
  const r14 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    schema: { basePdf: 42, pages: [{ elements: [] }] }
  });
  assert(r14.s === 422, 'PUT with basePdf as number returns 422, got ' + r14.s);
  assert(r14.b.details && r14.b.details.some(d => d.field === 'schema.basePdf'), 'Details reference basePdf');

  // === Test 15: PUT update without schema field -> 200 (no validation needed) ===
  console.log('\n--- Test: PUT with no schema field (name only) ---');
  const r15 = await req('PUT', 'http://localhost:3000/api/pdfme/templates/' + tid, {
    name: 'Renamed Template'
  });
  assert(r15.s === 200, 'PUT without schema field returns 200, got ' + r15.s);
  assert(r15.b.name === 'Renamed Template', 'Name was updated');

  // === Test 16: POST create with string schema -> 400 ===
  console.log('\n--- Test: POST create with string schema ---');
  const r16 = await req('POST', 'http://localhost:3000/api/pdfme/templates', {
    name: 'Bad Schema Test',
    type: 'invoice',
    schema: 'not a json object'
  });
  assert(r16.s === 400, 'POST with string schema returns 400, got ' + r16.s);

  // === Test 17: Verify original template data integrity ===
  console.log('\n--- Test: Verify template data integrity after all tests ---');
  const r17 = await req('GET', 'http://localhost:3000/api/pdfme/templates/' + tid, null);
  assert(r17.s === 200, 'Template still accessible after all tests');
  assert(r17.b.name === 'Renamed Template', 'Template name reflects last valid update');

  // Cleanup
  await req('DELETE', 'http://localhost:3000/api/pdfme/templates/' + tid, null);

  console.log('\n=== Results: ' + pass + '/' + (pass + fail) + ' passing ===');
  if (fail > 0) process.exit(1);
}

go().catch(e => { console.error(e); process.exit(1); });
