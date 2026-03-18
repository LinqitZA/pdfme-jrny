const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t262', orgId: 'org-t262', roles: ['template:edit', 'template:publish', 'render:trigger'] });

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
  console.log('=== Feature #262: Render request validates templateId exists ===\n');

  // === Test 1: POST render/now with nonexistent templateId -> 404 ===
  console.log('--- Test: render/now with nonexistent templateId ---');
  const r1 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: 'nonexistent-template-id-xyz',
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r1.s === 404, 'Nonexistent templateId returns 404, got ' + r1.s);
  assert(r1.b.error === 'Not Found', 'Error type is Not Found');
  assert(typeof r1.b.message === 'string' && r1.b.message.length > 0, 'Error message is non-empty');
  assert(r1.b.message.toLowerCase().includes('template') || r1.b.message.toLowerCase().includes('not found'), 'Error message mentions template or not found');
  console.log('  Response: ' + JSON.stringify(r1.b));

  // === Test 2: render/now with empty string templateId -> 400 ===
  console.log('\n--- Test: render/now with empty templateId ---');
  const r2 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: '',
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r2.s === 400, 'Empty templateId returns 400, got ' + r2.s);

  // === Test 3: render/now without templateId -> 400 ===
  console.log('\n--- Test: render/now without templateId ---');
  const r3 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r3.s === 400, 'Missing templateId returns 400, got ' + r3.s);
  assert(r3.b.details && r3.b.details.some(function(d) { return d.field === 'templateId'; }), 'Details reference templateId field');

  // === Test 4: render/now with random UUID-like templateId -> 404 ===
  console.log('\n--- Test: render/now with UUID-like nonexistent templateId ---');
  const r4 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: 'a1b2c3d4e5f6g7h8i9j0k1l2',
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r4.s === 404, 'UUID-like nonexistent templateId returns 404, got ' + r4.s);

  // === Test 5: render/now with valid (published) template succeeds ===
  console.log('\n--- Test: Create, publish, and render with valid templateId ---');

  // Create a template
  const validSchema = {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    schemas: [[{ name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Hello' }]]
  };
  const createRes = await req('POST', 'http://localhost:3001/api/pdfme/templates', {
    name: 'Render Validate Test 262',
    type: 'invoice',
    schema: validSchema,
  });
  assert(createRes.s === 201, 'Created test template: ' + createRes.s);
  const tid = createRes.b.id;
  console.log('  Template ID: ' + tid);

  // Publish the template
  const pubRes = await req('POST', 'http://localhost:3001/api/pdfme/templates/' + tid + '/publish', {});
  assert(pubRes.s === 200 || pubRes.s === 201, 'Published template: ' + pubRes.s);

  // Render with valid template
  const r5 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: tid,
    entityId: 'entity-262',
    channel: 'email'
  });
  assert(r5.s === 200 || r5.s === 201, 'Render with valid templateId returns 200/201, got ' + r5.s);
  assert(r5.b.document && r5.b.document.id, 'Response contains document with id');
  console.log('  Document ID: ' + (r5.b.document ? r5.b.document.id : 'none'));

  // === Test 6: render/now with draft (unpublished) template -> 404 ===
  console.log('\n--- Test: render/now with draft template ---');
  const draftRes = await req('POST', 'http://localhost:3001/api/pdfme/templates', {
    name: 'Draft Only Test 262',
    type: 'invoice',
    schema: validSchema,
  });
  assert(draftRes.s === 201, 'Created draft template');
  const draftTid = draftRes.b.id;

  const r6 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: draftTid,
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r6.s === 422 || r6.s === 404, 'Draft template returns 422 or 404 for render, got ' + r6.s);
  assert(r6.b.message && (r6.b.message.includes('published') || r6.b.message.includes('not found') || r6.b.message.includes('draft')), 'Error mentions template status');

  // === Test 7: render/now with archived template -> 404 ===
  console.log('\n--- Test: render/now with archived template ---');
  const archiveRes = await req('DELETE', 'http://localhost:3001/api/pdfme/templates/' + draftTid, null);
  assert(archiveRes.s === 200, 'Archived draft template');

  const r7 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: draftTid,
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r7.s === 422 || r7.s === 404, 'Archived template returns 422 or 404 for render, got ' + r7.s);

  // === Test 8: bulk render with nonexistent templateId -> 404 or appropriate error ===
  console.log('\n--- Test: bulk render with nonexistent templateId ---');
  const r8 = await req('POST', 'http://localhost:3001/api/pdfme/render/bulk', {
    templateId: 'nonexistent-bulk-template',
    entityIds: ['e1', 'e2'],
    channel: 'email'
  });
  assert(r8.s === 404 || r8.s === 202, 'Bulk with nonexistent templateId returns 404 or 202, got ' + r8.s);
  console.log('  Bulk response status: ' + r8.s);

  // === Test 9: Error message identifies the missing template ===
  console.log('\n--- Test: Error message identifies missing template ---');
  const badId = 'definitely-not-a-real-template-id';
  const r9 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: badId,
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r9.s === 404, 'Returns 404 for bad ID');
  assert(r9.b.message && r9.b.message.toLowerCase().includes('template'), 'Error message mentions template');
  console.log('  Error message: ' + r9.b.message);

  // Cleanup
  await req('DELETE', 'http://localhost:3001/api/pdfme/templates/' + tid, null);

  console.log('\n=== Results: ' + pass + '/' + (pass + fail) + ' passing ===');
  if (fail > 0) process.exit(1);
}

go().catch(function(e) { console.error(e); process.exit(1); });
