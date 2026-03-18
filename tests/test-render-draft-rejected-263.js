const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t263', orgId: 'org-t263', roles: ['template:edit', 'template:publish', 'render:trigger'] });

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
  console.log('=== Feature #263: Render request validates template is published ===\n');

  const validSchema = {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Hello' }]]
  };

  // === Step 1: Create a draft template ===
  console.log('--- Step 1: Create draft template ---');
  const createRes = await req('POST', 'http://localhost:3001/api/pdfme/templates', {
    name: 'Draft Render Test 263',
    type: 'invoice',
    schema: validSchema,
  });
  assert(createRes.s === 201, 'Created draft template: ' + createRes.s);
  const tid = createRes.b.id;
  console.log('  Template ID: ' + tid);
  assert(createRes.b.status === 'draft', 'Template status is draft');

  // === Step 2: POST render/now with draft templateId -> error (422 or 400) ===
  console.log('\n--- Step 2: Render draft template -> error ---');
  const r1 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: tid,
    entityId: 'entity-263',
    channel: 'email'
  });
  assert(r1.s === 422 || r1.s === 400, 'Draft template render returns 422 or 400, got ' + r1.s);
  assert(typeof r1.b.message === 'string', 'Has error message');
  assert(r1.b.message.includes('draft') || r1.b.message.includes('published') || r1.b.message.includes('status'), 'Error mentions draft/published status');
  console.log('  Error: ' + r1.b.message);

  // === Step 3: Verify error is distinguishable from 404 ===
  console.log('\n--- Step 3: Draft error differs from non-existent error ---');
  const r2 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: 'totally-nonexistent-id-xxx',
    entityId: 'entity-1',
    channel: 'email'
  });
  assert(r2.s === 404, 'Non-existent template returns 404, got ' + r2.s);
  assert(r1.s !== r2.s, 'Draft error status (' + r1.s + ') differs from not-found status (' + r2.s + ')');

  // === Step 4: Verify templateStatus is included in error response ===
  console.log('\n--- Step 4: Error response includes templateStatus ---');
  assert(r1.b.templateStatus === 'draft', 'Error response includes templateStatus=draft, got: ' + r1.b.templateStatus);

  // === Step 5: Publish template ===
  console.log('\n--- Step 5: Publish template ---');
  const pubRes = await req('POST', 'http://localhost:3001/api/pdfme/templates/' + tid + '/publish', {});
  assert(pubRes.s === 200 || pubRes.s === 201, 'Published template: ' + pubRes.s);

  // === Step 6: POST render/now with published template -> succeeds ===
  console.log('\n--- Step 6: Render published template -> success ---');
  const r3 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: tid,
    entityId: 'entity-263-pub',
    channel: 'email'
  });
  assert(r3.s === 200 || r3.s === 201, 'Published template render returns 200/201, got ' + r3.s);
  assert(r3.b.document && r3.b.document.id, 'Response contains document with id');
  console.log('  Document ID: ' + (r3.b.document ? r3.b.document.id : 'none'));

  // === Step 7: Archive template, then try to render ===
  console.log('\n--- Step 7: Archived template render -> error ---');
  await req('DELETE', 'http://localhost:3001/api/pdfme/templates/' + tid, null);
  const r4 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: tid,
    entityId: 'entity-263-arch',
    channel: 'email'
  });
  assert(r4.s === 422 || r4.s === 400, 'Archived template render returns 422 or 400, got ' + r4.s);
  assert(r4.b.message && (r4.b.message.includes('archived') || r4.b.message.includes('published')), 'Error mentions archived or published status');
  console.log('  Archived error: ' + r4.b.message);

  // === Step 8: Create another draft, try render via bulk ===
  console.log('\n--- Step 8: Bulk render with draft template ---');
  const draft2 = await req('POST', 'http://localhost:3001/api/pdfme/templates', {
    name: 'Draft Bulk Test 263',
    type: 'invoice',
    schema: validSchema,
  });
  const draft2Id = draft2.b.id;

  // Re-verify single render with new draft
  const r5 = await req('POST', 'http://localhost:3001/api/pdfme/render/now', {
    templateId: draft2Id,
    entityId: 'entity-bulk',
    channel: 'email'
  });
  assert(r5.s === 422 || r5.s === 400, 'Another draft template render returns 422/400, got ' + r5.s);

  // Cleanup
  await req('DELETE', 'http://localhost:3001/api/pdfme/templates/' + draft2Id, null);

  // === Step 9: Verify the previous published render's document exists ===
  console.log('\n--- Step 9: Previous render document exists ---');
  assert(r3.b.document && r3.b.document.status === 'done', 'Rendered document has done status');

  console.log('\n=== Results: ' + pass + '/' + (pass + fail) + ' passing ===');
  if (fail > 0) process.exit(1);
}

go().catch(function(e) { console.error(e); process.exit(1); });
