const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-279', 'test-org-279', ['admin']);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || TOKEN),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
const cleanupIds = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function cleanup() {
  for (const id of cleanupIds) {
    try { await request('DELETE', `/templates/${id}`); } catch {}
  }
}

async function runTests() {
  console.log('Feature #279: Server-side validation matches client-side\n');

  // === TEMPLATE CREATE VALIDATION ===
  console.log('--- Template Create: Missing required fields ---');

  // 1. Empty body
  const r1 = await request('POST', '/templates', {});
  assert(r1.status === 400, `Empty body returns 400 (got ${r1.status})`);
  assert(r1.body.details && r1.body.details.length > 0, 'Error response includes details array');
  assert(r1.body.message && r1.body.message.length > 10, `Error message is specific: "${r1.body.message}"`);

  // 2. Missing name
  const r2 = await request('POST', '/templates', { type: 'invoice', schema: { pages: [] } });
  assert(r2.status === 400, `Missing name returns 400 (got ${r2.status})`);
  assert(r2.body.details && r2.body.details.some(d => d.field === 'name'), 'Error identifies "name" as missing field');

  // 3. Missing type
  const r3 = await request('POST', '/templates', { name: 'Test', schema: { pages: [] } });
  assert(r3.status === 400, `Missing type returns 400 (got ${r3.status})`);
  assert(r3.body.details && r3.body.details.some(d => d.field === 'type'), 'Error identifies "type" as missing field');

  // 4. Missing schema
  const r4 = await request('POST', '/templates', { name: 'Test', type: 'invoice' });
  assert(r4.status === 400, `Missing schema returns 400 (got ${r4.status})`);
  assert(r4.body.details && r4.body.details.some(d => d.field === 'schema'), 'Error identifies "schema" as missing field');

  // 5. Invalid type value
  console.log('\n--- Template Create: Invalid field values ---');
  const r5 = await request('POST', '/templates', { name: 'Test', type: 'INVALID_TYPE', schema: { pages: [] } });
  assert(r5.status === 400, `Invalid type returns 400 (got ${r5.status})`);
  assert(r5.body.message && r5.body.message.includes('INVALID_TYPE'), 'Error message includes the invalid value');
  assert(r5.body.message && r5.body.message.includes('invoice'), 'Error message lists valid types');

  // 6. Schema as string
  const r6 = await request('POST', '/templates', { name: 'Test', type: 'invoice', schema: 'not-an-object' });
  assert(r6.status === 400, `Schema as string returns 400 (got ${r6.status})`);

  // 7. Schema as array
  const r7 = await request('POST', '/templates', { name: 'Test', type: 'invoice', schema: [1, 2, 3] });
  assert(r7.status === 400, `Schema as array returns 400 (got ${r7.status})`);

  // 8. Name is whitespace only
  const r8 = await request('POST', '/templates', { name: '   ', type: 'invoice', schema: { pages: [] } });
  assert(r8.status === 400, `Whitespace-only name returns 400 (got ${r8.status})`);

  // 9. Type is whitespace only
  const r9 = await request('POST', '/templates', { name: 'Test', type: '   ', schema: { pages: [] } });
  assert(r9.status === 400, `Whitespace-only type returns 400 (got ${r9.status})`);

  // === TEMPLATE UPDATE VALIDATION (schema) ===
  console.log('\n--- Template Update: Schema validation ---');
  // Create a valid template first
  const createRes = await request('POST', '/templates', { name: 'Validation Test 279', type: 'invoice', schema: { pages: [{ elements: [{ type: 'text', x: 0, y: 0, w: 100, h: 20 }] }] } });
  assert(createRes.status === 201, `Created test template (status ${createRes.status})`);
  const templateId = createRes.body.id;
  if (templateId) cleanupIds.push(templateId);

  if (templateId) {
    // Schema as null on update
    const r10 = await request('PUT', `/templates/${templateId}`, { schema: null });
    assert(r10.status === 400, `Schema=null on PUT returns 400 (got ${r10.status})`);

    // Schema as array on update
    const r11 = await request('PUT', `/templates/${templateId}`, { schema: [1, 2] });
    assert(r11.status === 400, `Schema=array on PUT returns 400 (got ${r11.status})`);

    // Schema as string on update
    const r12 = await request('PUT', `/templates/${templateId}`, { schema: 'bad' });
    assert(r12.status === 400, `Schema=string on PUT returns 400 (got ${r12.status})`);
    assert(r12.body.details && r12.body.details.length > 0, 'PUT schema error has details array');

    // Invalid schema structure (pages not array) - 422
    const r13 = await request('PUT', `/templates/${templateId}`, { schema: { pages: 'not-array' } });
    assert(r13.status === 422, `Schema with pages=string returns 422 (got ${r13.status})`);
  }

  // === DRAFT SAVE VALIDATION ===
  console.log('\n--- Draft Save: Validation ---');
  if (templateId) {
    // Invalid saveMode
    const r14 = await request('PUT', `/templates/${templateId}/draft`, { saveMode: 'badMode' });
    assert(r14.status === 400, `Invalid saveMode returns 400 (got ${r14.status})`);
    assert(r14.body.message && r14.body.message.includes('badMode'), 'Error message includes the invalid saveMode value');

    // Invalid schema in draft save
    const r15 = await request('PUT', `/templates/${templateId}/draft`, { schema: 'not-object' });
    assert(r15.status === 400, `Invalid schema in draft save returns 400 (got ${r15.status})`);
  }

  // === RENDER VALIDATION ===
  console.log('\n--- Render Now: Validation ---');

  // Missing all required fields
  const r16 = await request('POST', '/render/now', {});
  assert(r16.status === 400, `Render with empty body returns 400 (got ${r16.status})`);
  assert(r16.body.details && r16.body.details.length >= 3, `Render error lists all 3 missing fields (got ${r16.body.details ? r16.body.details.length : 0})`);

  // Invalid channel
  const r17 = await request('POST', '/render/now', { templateId: 'test', entityId: 'test', channel: 'fax' });
  assert(r17.status === 400, `Invalid channel returns 400 (got ${r17.status})`);
  assert(r17.body.message && r17.body.message.includes('fax'), 'Error includes invalid channel value');
  assert(r17.body.message && r17.body.message.includes('email'), 'Error lists valid channels');

  // Non-existent templateId
  const r18 = await request('POST', '/render/now', { templateId: 'nonexistent-uuid', entityId: 'test', channel: 'email' });
  assert(r18.status === 404 || r18.status === 400, `Nonexistent templateId returns 404 or 400 (got ${r18.status})`);

  // Empty templateId
  const r19 = await request('POST', '/render/now', { templateId: '', entityId: 'test', channel: 'email' });
  assert(r19.status === 400, `Empty templateId returns 400 (got ${r19.status})`);

  // === BULK RENDER VALIDATION ===
  console.log('\n--- Render Bulk: Validation ---');

  // Missing entityIds
  const r20 = await request('POST', '/render/bulk', { templateId: 'test', channel: 'email' });
  assert(r20.status === 400, `Bulk render missing entityIds returns 400 (got ${r20.status})`);

  // Empty entityIds array
  const r21 = await request('POST', '/render/bulk', { templateId: 'test', entityIds: [], channel: 'email' });
  assert(r21.status === 400, `Bulk render empty entityIds returns 400 (got ${r21.status})`);

  // Invalid channel in bulk
  const r22 = await request('POST', '/render/bulk', { templateId: 'test', entityIds: ['a'], channel: 'invalid' });
  assert(r22.status === 400, `Bulk render invalid channel returns 400 (got ${r22.status})`);

  // Duplicate entityIds
  const r23 = await request('POST', '/render/bulk', { templateId: 'test', entityIds: ['a', 'a'], channel: 'email' });
  assert(r23.status === 400, `Bulk render duplicate entityIds returns 400 (got ${r23.status})`);
  assert(r23.body.details && r23.body.details[0].duplicates, 'Duplicate error includes duplicates list');

  // entityIds with null/empty entries
  const r24 = await request('POST', '/render/bulk', { templateId: 'test', entityIds: ['a', '', 'b'], channel: 'email' });
  assert(r24.status === 400, `Bulk render with empty entityId entry returns 400 (got ${r24.status})`);

  // Invalid onFailure
  const r25 = await request('POST', '/render/bulk', { templateId: 'test', entityIds: ['a'], channel: 'email', onFailure: 'explode' });
  assert(r25.status === 400, `Bulk render invalid onFailure returns 400 (got ${r25.status})`);

  // === IMPORT VALIDATION ===
  console.log('\n--- Template Import: Validation ---');

  // Missing version and template
  const r26 = await request('POST', '/templates/import', {});
  assert(r26.status === 400, `Import empty body returns 400 (got ${r26.status})`);
  assert(r26.body.details && r26.body.details.length >= 2, 'Import error lists all missing top-level fields');

  // Wrong version
  const r27 = await request('POST', '/templates/import', { version: 99, template: { name: 'T', type: 'invoice', schema: {} } });
  assert(r27.status === 422, `Import wrong version returns 422 (got ${r27.status})`);

  // Missing template name/type/schema
  const r28 = await request('POST', '/templates/import', { version: 1, template: {} });
  assert(r28.status === 422, `Import template missing fields returns 422 (got ${r28.status})`);
  assert(r28.body.details && r28.body.details.length >= 3, `Import lists all missing template fields (got ${r28.body.details ? r28.body.details.length : 0})`);

  // === SIGNATURE VALIDATION ===
  console.log('\n--- Signature Upload: Validation ---');

  // Missing data field
  const r29 = await request('POST', '/signatures', {});
  assert(r29.status === 400, `Signature missing data returns 400 (got ${r29.status})`);
  assert(r29.body.message && r29.body.message.toLowerCase().includes('required'), 'Signature error says data is required');

  // Empty data
  const r30 = await request('POST', '/signatures', { data: '' });
  assert(r30.status === 400, `Signature empty data returns 400 (got ${r30.status})`);

  // Invalid image format (not PNG/SVG)
  const r31 = await request('POST', '/signatures', { data: 'data:image/jpeg;base64,/9j/4AAQ' });
  assert(r31.status === 400, `Signature JPEG rejected returns 400 (got ${r31.status})`);
  assert(r31.body.message && r31.body.message.includes('image/jpeg'), 'Error identifies the rejected format');

  // === PREVIEW VALIDATION ===
  console.log('\n--- Preview: Validation ---');

  // Invalid sampleRowCount
  if (templateId) {
    const r32 = await request('POST', `/templates/${templateId}/preview`, { sampleRowCount: 99 });
    assert(r32.status === 400, `Invalid sampleRowCount returns 400 (got ${r32.status})`);
    assert(r32.body.message && r32.body.message.includes('5, 15, or 30'), 'Error lists valid sampleRowCount values');
  }

  // === AUDIT FILTER VALIDATION ===
  console.log('\n--- Render Documents: Status filter validation ---');

  const r33 = await request('GET', '/render/documents/some-template?status=invalid_status');
  assert(r33.status === 400, `Invalid render status filter returns 400 (got ${r33.status})`);

  // === ALL ERROR RESPONSES ARE ACTIONABLE ===
  console.log('\n--- Error response quality checks ---');

  // Verify error responses have consistent structure
  const errorResponses = [r1, r2, r5, r16, r17, r20, r26];
  let allHaveStatusCode = true;
  let allHaveMessage = true;
  for (const r of errorResponses) {
    if (!r.body.statusCode) allHaveStatusCode = false;
    if (!r.body.message || r.body.message.length < 10) allHaveMessage = false;
  }
  assert(allHaveStatusCode, 'All error responses include statusCode field');
  assert(allHaveMessage, 'All error responses include descriptive message (>10 chars)');

  // Verify error messages are specific (not just generic "Bad Request")
  const specificMessages = [r5, r17, r22, r25];
  let allSpecific = true;
  for (const r of specificMessages) {
    if (r.body.message === 'Bad Request' || r.body.message === 'Error') {
      allSpecific = false;
    }
  }
  assert(allSpecific, 'Error messages are specific, not generic "Bad Request"');

  // Version validation on template
  console.log('\n--- Version endpoint validation ---');
  if (templateId) {
    const r34 = await request('GET', `/templates/${templateId}/versions/0`);
    assert(r34.status === 400, `Version 0 returns 400 (got ${r34.status})`);

    const r35 = await request('GET', `/templates/${templateId}/versions/-1`);
    assert(r35.status === 400, `Negative version returns 400 (got ${r35.status})`);

    const r36 = await request('GET', `/templates/${templateId}/versions/abc`);
    assert(r36.status === 400, `Non-numeric version returns 400 (got ${r36.status})`);
  }

  // === CLEANUP ===
  await cleanup();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
