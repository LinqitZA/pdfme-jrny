/**
 * Feature #241: Template type defaults correctly
 *
 * Default template type applied when creating.
 * Steps:
 * 1. Create template without specifying type → default type assigned
 * 2. Verify appropriate default type assigned
 * 3. Verify type can be changed
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-type-241', 'org-type-241', ['template:edit', 'template:publish']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE.replace('/api/pdfme', ''));
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function run() {
  console.log('Feature #241: Template type defaults correctly');
  console.log('==============================================\n');

  // Step 1: Create template WITHOUT specifying type
  console.log('Step 1: Create template without type');
  const noTypeRes = await request('POST', `${API_BASE}/templates`, {
    name: 'TYPE_DEFAULT_TEST_241',
    schema: { pages: [{ elements: [] }] },
  });
  assert(noTypeRes.status === 201, `Template created without type (status=${noTypeRes.status})`);
  const noTypeId = noTypeRes.body.id;

  // Step 2: Verify default type assigned
  console.log('\nStep 2: Verify default type assigned');
  assert(noTypeRes.body.type === 'custom', `Default type is "custom" (got "${noTypeRes.body.type}")`);

  // Fetch the template directly to confirm persisted type
  const fetchRes = await request('GET', `${API_BASE}/templates/${noTypeId}`, null);
  assert(fetchRes.status === 200, `Template fetched (status=${fetchRes.status})`);
  assert(fetchRes.body.type === 'custom', `Persisted type is "custom" (got "${fetchRes.body.type}")`);

  // Step 3: Create template WITH explicit type
  console.log('\nStep 3: Create template with explicit type');
  const withTypeRes = await request('POST', `${API_BASE}/templates`, {
    name: 'TYPE_EXPLICIT_TEST_241',
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
  });
  assert(withTypeRes.status === 201, `Template created with type (status=${withTypeRes.status})`);
  assert(withTypeRes.body.type === 'invoice', `Explicit type is "invoice" (got "${withTypeRes.body.type}")`);
  const withTypeId = withTypeRes.body.id;

  // Step 4: Verify type can be changed via update
  console.log('\nStep 4: Verify type can be changed');
  const updateRes = await request('PUT', `${API_BASE}/templates/${withTypeId}`, {
    type: 'statement',
  });
  assert(updateRes.status === 200, `Template updated (status=${updateRes.status})`);
  assert(updateRes.body.type === 'statement', `Type changed to "statement" (got "${updateRes.body.type}")`);

  // Fetch again to confirm change persisted
  const fetchUpdated = await request('GET', `${API_BASE}/templates/${withTypeId}`, null);
  assert(fetchUpdated.body.type === 'statement', `Persisted type is "statement" after update (got "${fetchUpdated.body.type}")`);

  // Step 5: Create template with empty string type → should default
  console.log('\nStep 5: Create template with empty string type');
  const emptyTypeRes = await request('POST', `${API_BASE}/templates`, {
    name: 'TYPE_EMPTY_TEST_241',
    type: '',
    schema: { pages: [{ elements: [] }] },
  });
  assert(emptyTypeRes.status === 201, `Template created with empty type (status=${emptyTypeRes.status})`);
  assert(emptyTypeRes.body.type === 'custom', `Empty type defaults to "custom" (got "${emptyTypeRes.body.type}")`);

  // Step 6: Type can be changed to different valid types
  console.log('\nStep 6: Change type to various valid types');
  const types = ['purchase_order', 'delivery_note', 'credit_note'];
  for (const newType of types) {
    const changeRes = await request('PUT', `${API_BASE}/templates/${noTypeId}`, { type: newType });
    assert(changeRes.status === 200 && changeRes.body.type === newType,
      `Type changed to "${newType}" (got "${changeRes.body?.type}")`);
  }

  // Step 7: Verify default type template appears in template list
  console.log('\nStep 7: Verify template with default type appears in list');
  const listRes = await request('GET', `${API_BASE}/templates?type=credit_note`, null);
  assert(listRes.status === 200, `Template list fetched (status=${listRes.status})`);
  const found = (listRes.body.data || []).some(t => t.id === noTypeId);
  assert(found, 'Template with changed type found in filtered list');

  // Summary
  console.log(`\n==============================================`);
  console.log(`Results: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.log(`FAILED: ${failed} tests`);
    process.exit(1);
  } else {
    console.log('All tests passed! ✅');
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
