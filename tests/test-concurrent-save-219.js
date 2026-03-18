/**
 * Feature #219: Concurrent save requests don't corrupt data
 * Rapid save clicks produce consistent result
 *
 * Steps:
 * 1. Start save request A
 * 2. Immediately start save request B
 * 3. Verify no data corruption
 * 4. Verify latest schema saved
 * 5. Verify no partial writes
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000';
const ORG_ID = 'test-concurrent-' + Date.now();
const USER_ID = 'concurrent-user-' + Date.now();
const TOKEN = signJwt({ sub: USER_ID, orgId: ORG_ID, roles: ['admin'] });

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => chunks += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: chunks });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function makeSchema(label, elemCount) {
  const elements = [];
  for (let i = 0; i < elemCount; i++) {
    elements.push({
      type: 'text',
      content: `${label}_element_${i}`,
      x: i * 10,
      y: i * 10,
      w: 100,
      h: 20,
      fontSize: 12,
    });
  }
  return {
    pages: [{ elements }],
    pageSize: { width: 210, height: 297 },
    label: label,
  };
}

async function runTests() {
  console.log('Feature #219: Concurrent save requests don\'t corrupt data\n');

  // Create a template to work with
  console.log('Setup: Create test template');
  const create = await request('POST', '/api/pdfme/templates', {
    name: 'Concurrent Save Test ' + Date.now(),
    type: 'invoice',
    orgId: ORG_ID,
    schema: makeSchema('INITIAL', 3),
  });
  assert(create.status === 201, `Create template should return 201, got ${create.status}`);
  const templateId = create.body?.id;
  assert(templateId, 'Template should have an id');

  // Test 1: Two concurrent save requests - both succeed, last one wins
  console.log('\nTest 1: Two concurrent draft saves');
  const schemaA = makeSchema('SAVE_A', 5);
  const schemaB = makeSchema('SAVE_B', 7);

  const [saveA, saveB] = await Promise.all([
    request('PUT', `/api/pdfme/templates/${templateId}/draft`, { schema: schemaA }),
    request('PUT', `/api/pdfme/templates/${templateId}/draft`, { schema: schemaB }),
  ]);

  assert(saveA.status === 200, `Save A should return 200, got ${saveA.status}`);
  assert(saveB.status === 200, `Save B should return 200, got ${saveB.status}`);

  // Verify no data corruption - template should be readable
  const get1 = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(get1.status === 200, 'Template readable after concurrent saves');
  assert(get1.body && get1.body.schema, 'Template has schema after concurrent saves');
  assert(get1.body && get1.body.schema.pages, 'Schema has pages (no corruption)');
  assert(get1.body && get1.body.schema.pages.length === 1, 'Schema has exactly 1 page (no duplication)');

  // The saved schema should be one of the two (last writer wins)
  const savedLabel = get1.body?.schema?.label;
  assert(savedLabel === 'SAVE_A' || savedLabel === 'SAVE_B', `Saved schema should be A or B, got ${savedLabel}`);

  // Test 2: Five concurrent saves - all succeed, no corruption
  console.log('\nTest 2: Five concurrent draft saves');
  const schemas = [];
  for (let i = 0; i < 5; i++) {
    schemas.push(makeSchema(`BURST_${i}`, 3 + i));
  }

  const results = await Promise.all(
    schemas.map((s, i) =>
      request('PUT', `/api/pdfme/templates/${templateId}/draft`, { schema: s, name: `Burst ${i}` })
    )
  );

  const successCount = results.filter(r => r.status === 200).length;
  assert(successCount === 5, `All 5 concurrent saves should succeed, got ${successCount}`);

  // Verify data integrity after burst
  const get2 = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(get2.status === 200, 'Template readable after 5 concurrent saves');
  assert(get2.body && get2.body.schema && get2.body.schema.pages, 'Schema intact after burst');
  assert(get2.body && get2.body.schema.pages.length === 1, 'Still exactly 1 page after burst');
  const burstElements = get2.body?.schema?.pages?.[0]?.elements;
  assert(Array.isArray(burstElements), 'Elements array intact');
  // Should be one of the schemas (3-7 elements)
  assert(burstElements.length >= 3 && burstElements.length <= 7, `Elements count should be 3-7, got ${burstElements?.length}`);

  // Verify the label matches one of our schemas (no partial writes / mixing)
  const burstLabel = get2.body?.schema?.label;
  const validLabels = schemas.map(s => s.label);
  assert(validLabels.includes(burstLabel), `Schema label should be one of BURST_0-4, got ${burstLabel}`);

  // Verify elements match the label (no partial write mixing schema from one with elements from another)
  const expectedElemCount = parseInt(burstLabel?.split('_')[1] || '0') + 3;
  assert(burstElements.length === expectedElemCount, `Elements count (${burstElements.length}) matches schema label (${burstLabel} => ${expectedElemCount})`);

  // Test 3: Concurrent name + schema saves
  console.log('\nTest 3: Concurrent name and schema updates');
  const [nameResult, schemaResult] = await Promise.all([
    request('PUT', `/api/pdfme/templates/${templateId}/draft`, { name: 'Name Update Concurrent' }),
    request('PUT', `/api/pdfme/templates/${templateId}/draft`, { schema: makeSchema('SCHEMA_UPDATE', 4) }),
  ]);

  assert(nameResult.status === 200, 'Name update succeeds');
  assert(schemaResult.status === 200, 'Schema update succeeds');

  const get3 = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(get3.status === 200, 'Template readable after name+schema concurrent update');
  assert(get3.body && get3.body.schema && get3.body.schema.pages, 'Schema not corrupted');
  assert(get3.body && typeof get3.body.name === 'string' && get3.body.name.length > 0, 'Name is valid string');

  // Test 4: Sequential rapid saves (like fast double-click)
  console.log('\nTest 4: Sequential rapid saves');
  for (let i = 0; i < 5; i++) {
    const r = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
      schema: makeSchema(`RAPID_${i}`, 3),
      name: `Rapid Save ${i}`,
    });
    assert(r.status === 200, `Rapid save ${i} succeeds`);
  }

  const get4 = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(get4.status === 200, 'Template readable after rapid saves');
  assert(get4.body && get4.body.name === 'Rapid Save 4', 'Last rapid save name persisted');
  assert(get4.body && get4.body.schema && get4.body.schema.label === 'RAPID_4', 'Last rapid save schema persisted');

  // Test 5: Verify updatedAt is set (no null timestamps)
  console.log('\nTest 5: Timestamps not corrupted');
  assert(get4.body && get4.body.updatedAt, 'updatedAt exists');
  const updatedAt = new Date(get4.body?.updatedAt);
  assert(!isNaN(updatedAt.getTime()), 'updatedAt is valid date');

  // Test 6: Large concurrent saves with complex schemas
  console.log('\nTest 6: Large concurrent saves with complex schemas');
  const largeSchemas = [];
  for (let i = 0; i < 3; i++) {
    largeSchemas.push(makeSchema(`LARGE_${i}`, 20 + i * 5));
  }

  const largeResults = await Promise.all(
    largeSchemas.map(s =>
      request('PUT', `/api/pdfme/templates/${templateId}/draft`, { schema: s })
    )
  );

  const largeSuccesses = largeResults.filter(r => r.status === 200).length;
  assert(largeSuccesses === 3, `All 3 large concurrent saves succeed, got ${largeSuccesses}`);

  const get6 = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(get6.status === 200, 'Template readable after large concurrent saves');
  const largeElements = get6.body?.schema?.pages?.[0]?.elements;
  assert(Array.isArray(largeElements), 'Large schema elements intact');
  // Should be 20, 25, or 30 elements
  assert([20, 25, 30].includes(largeElements.length), `Element count should be 20/25/30, got ${largeElements.length}`);

  // Test 7: Verify data persists (read multiple times)
  console.log('\nTest 7: Data consistent across reads');
  const reads = await Promise.all([
    request('GET', `/api/pdfme/templates/${templateId}`),
    request('GET', `/api/pdfme/templates/${templateId}`),
    request('GET', `/api/pdfme/templates/${templateId}`),
  ]);

  const schemas_read = reads.map(r => JSON.stringify(r.body?.schema));
  assert(schemas_read[0] === schemas_read[1], 'Concurrent reads return same data (1 vs 2)');
  assert(schemas_read[1] === schemas_read[2], 'Concurrent reads return same data (2 vs 3)');

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
