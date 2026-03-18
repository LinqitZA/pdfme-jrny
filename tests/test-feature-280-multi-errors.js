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

const TOKEN = makeToken('test-user-280', 'test-org-280', ['admin']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
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
  console.log('Feature #280: Validation errors list all issues at once\n');

  // === TEMPLATE CREATE: Multiple missing fields ===
  console.log('--- Template Create: All 3 required fields missing ---');

  const r1 = await request('POST', '/templates', {});
  assert(r1.status === 400, `Returns 400 for completely empty body`);
  assert(Array.isArray(r1.body.details), 'Response has details array');
  assert(r1.body.details.length === 3, `Details contains all 3 missing fields (got ${r1.body.details ? r1.body.details.length : 0})`);

  const fields1 = r1.body.details.map(d => d.field);
  assert(fields1.includes('name'), 'Details includes "name" field error');
  assert(fields1.includes('type'), 'Details includes "type" field error');
  assert(fields1.includes('schema'), 'Details includes "schema" field error');

  // Verify each detail has field AND reason
  const allHaveFieldAndReason1 = r1.body.details.every(d => d.field && d.reason);
  assert(allHaveFieldAndReason1, 'Each detail has both "field" and "reason" (message)');

  // Not just reporting the first error
  assert(r1.body.details.length > 1, 'Not just first error reported - multiple errors in one response');

  // === TEMPLATE CREATE: 2 of 3 fields missing ===
  console.log('\n--- Template Create: 2 fields missing ---');

  const r2 = await request('POST', '/templates', { schema: { pages: [] } });
  assert(r2.status === 400, `Returns 400 when name and type both missing`);
  assert(r2.body.details.length === 2, `Details contains both missing fields (got ${r2.body.details ? r2.body.details.length : 0})`);
  const fields2 = r2.body.details.map(d => d.field);
  assert(fields2.includes('name') && fields2.includes('type'), 'Both name and type reported');

  const r3 = await request('POST', '/templates', { name: 'Test' });
  assert(r3.status === 400, `Returns 400 when type and schema both missing`);
  assert(r3.body.details.length === 2, `Both type and schema reported (got ${r3.body.details ? r3.body.details.length : 0})`);

  // === TEMPLATE IMPORT: Multiple structural errors ===
  console.log('\n--- Template Import: Multiple structural errors ---');

  // Missing version + missing template
  const r4 = await request('POST', '/templates/import', {});
  assert(r4.status === 400, `Import empty body returns 400`);
  assert(r4.body.details.length >= 2, `Import error lists version AND template missing (got ${r4.body.details ? r4.body.details.length : 0})`);

  // Template with all fields wrong (version bad, template missing fields)
  const r5 = await request('POST', '/templates/import', { version: 99, template: {} });
  assert(r5.status === 422, `Import multiple structural errors returns 422`);
  assert(r5.body.details.length >= 3, `Multiple structural errors reported at once (got ${r5.body.details ? r5.body.details.length : 0})`);

  // Check all errors have field and reason
  const allHaveFieldAndReason5 = r5.body.details.every(d => d.field && d.reason);
  assert(allHaveFieldAndReason5, 'Import errors each have "field" and "reason"');

  // Verify it's not stopping at first error
  const importFields = r5.body.details.map(d => d.field);
  assert(importFields.length > 1, 'Import validation reports more than just the first error');

  // Verify distinct fields are reported
  const uniqueImportFields = new Set(importFields);
  assert(uniqueImportFields.size > 1, `Multiple distinct fields reported: ${[...uniqueImportFields].join(', ')}`);

  // === BULK RENDER: Multiple validation errors ===
  console.log('\n--- Bulk Render: Missing fields ---');

  const r6 = await request('POST', '/render/bulk', {});
  assert(r6.status === 400, `Bulk render empty body returns 400`);
  assert(r6.body.details.length >= 3, `All 3 missing fields reported (got ${r6.body.details ? r6.body.details.length : 0})`);
  const bulkFields = r6.body.details.map(d => d.field);
  assert(bulkFields.includes('templateId'), 'Bulk error includes templateId');
  assert(bulkFields.includes('entityIds'), 'Bulk error includes entityIds');
  assert(bulkFields.includes('channel'), 'Bulk error includes channel');

  // === RENDER NOW: Missing fields ===
  console.log('\n--- Render Now: Multiple missing fields ---');

  const r7 = await request('POST', '/render/now', {});
  assert(r7.status === 400, `Render now empty body returns 400`);
  assert(r7.body.details.length === 3, `All 3 missing fields reported (got ${r7.body.details ? r7.body.details.length : 0})`);

  const renderFields = r7.body.details.map(d => d.field);
  assert(renderFields.includes('templateId'), 'Render error includes templateId');
  assert(renderFields.includes('entityId'), 'Render error includes entityId');
  assert(renderFields.includes('channel'), 'Render error includes channel');

  // === PUBLISH VALIDATION: Multiple errors on template ===
  console.log('\n--- Publish Validation: Multiple issues ---');

  // Create a template with bad schema for publish validation
  const createRes = await request('POST', '/templates', {
    name: 'Multi-Error Test 280',
    type: 'invoice',
    schema: {
      pages: [
        { elements: [] }, // Empty page - validation error
      ],
    },
  });
  assert(createRes.status === 201, `Created test template`);
  const templateId = createRes.body.id;
  if (templateId) cleanupIds.push(templateId);

  if (templateId) {
    // Use validate endpoint to check multiple errors
    const r8 = await request('POST', `/templates/${templateId}/validate`);
    assert(r8.status === 200, `Validate endpoint returns 200`);
    assert(r8.body.valid === false || r8.body.errors?.length > 0, 'Template with empty page has validation errors');
    if (r8.body.errors && r8.body.errors.length > 0) {
      assert(r8.body.errors.every(e => typeof e === 'object'), 'Each validation error is an object with details');
    }

    // Try to publish and verify all errors returned
    const r9 = await request('POST', `/templates/${templateId}/publish`);
    assert(r9.status === 422, `Publish with errors returns 422 (got ${r9.status})`);
    if (r9.body.details) {
      assert(Array.isArray(r9.body.details), 'Publish error has details array');
      assert(r9.body.details.length >= 1, `At least 1 validation error reported (got ${r9.body.details.length})`);
    }
  }

  // === IMPORT: Multiple template sub-field errors ===
  console.log('\n--- Import: Multiple template sub-fields missing ---');

  const r10 = await request('POST', '/templates/import', {
    version: 1,
    template: { name: '', type: '', schema: null },
  });
  assert(r10.status === 422, `Import with multiple bad template fields returns 422 (got ${r10.status})`);
  assert(r10.body.details.length >= 3, `All bad template sub-fields reported (got ${r10.body.details ? r10.body.details.length : 0})`);

  // Verify each error is distinguishable
  const importFieldNames = r10.body.details.map(d => d.field);
  const uniqueFieldNames = new Set(importFieldNames);
  assert(uniqueFieldNames.size >= 3, `At least 3 distinct fields in errors: ${[...uniqueFieldNames].join(', ')}`);

  // === GENERAL: All details entries have field+reason ===
  console.log('\n--- Error format consistency ---');

  const allResponses = [r1, r4, r5, r6, r7, r10];
  let allConsistent = true;
  for (const r of allResponses) {
    if (!r.body.details || !Array.isArray(r.body.details)) { allConsistent = false; continue; }
    for (const d of r.body.details) {
      if (!d.field || !d.reason) { allConsistent = false; break; }
    }
  }
  assert(allConsistent, 'All error responses have details entries with both "field" and "reason"');

  // Verify none of these stopped at just the first error
  let allMultiple = true;
  for (const r of [r1, r5, r6, r7, r10]) {
    if (!r.body.details || r.body.details.length < 2) { allMultiple = false; }
  }
  assert(allMultiple, 'All multi-error scenarios return 2+ errors (not just the first)');

  // === CLEANUP ===
  await cleanup();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
