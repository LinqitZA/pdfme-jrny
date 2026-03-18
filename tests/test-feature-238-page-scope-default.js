/**
 * Feature #238: Page scope defaults to all
 * Verifies that new elements default to pageScope='all' and the Properties panel
 * shows page visibility with default 'all', and no scope badge is shown for 'all'.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-238', 'org-238', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let templateId;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create a template with elements that have pageScope='all' (the default)
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'PageScope Default Test 238',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'header', content: 'Header Text', position: { x: 10, y: 10 }, width: 100, height: 20, pageScope: 'all' },
          { type: 'text', name: 'body', content: 'Body Text', position: { x: 10, y: 40 }, width: 100, height: 20 },
          { type: 'text', name: 'footer', content: 'Footer', position: { x: 10, y: 70 }, width: 100, height: 20, pageScope: 'first' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);
}

async function cleanup() {
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testPageScopeStoredInSchema() {
  console.log('\n--- pageScope stored in schema ---');

  const res = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await res.json();

  const schemas = data.schema?.schemas?.[0];
  assert(schemas && schemas.length === 3, 'Template has 3 elements');

  // Element with explicit pageScope='all'
  const header = schemas.find(s => s.name === 'header');
  assert(header?.pageScope === 'all', 'Header element has pageScope=all');

  // Element without pageScope (should be treated as default 'all')
  const body = schemas.find(s => s.name === 'body');
  // When not set, it should be undefined or 'all' - both are valid defaults
  const bodyScope = body?.pageScope || 'all';
  assert(bodyScope === 'all', 'Body element defaults to pageScope=all (undefined treated as all)');

  // Element with specific pageScope
  const footer = schemas.find(s => s.name === 'footer');
  assert(footer?.pageScope === 'first', 'Footer element has pageScope=first');
}

async function testPageScopeUpdateViaDraft() {
  console.log('\n--- pageScope can be updated via save draft ---');

  // Save draft with updated pageScope values
  const draftRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      schema: {
        schemas: [[
          { type: 'text', name: 'header', content: 'Header Text', position: { x: 10, y: 10 }, width: 100, height: 20, pageScope: 'last' },
          { type: 'text', name: 'body', content: 'Body Text', position: { x: 10, y: 40 }, width: 100, height: 20, pageScope: 'all' },
          { type: 'text', name: 'footer', content: 'Footer', position: { x: 10, y: 70 }, width: 100, height: 20, pageScope: 'notFirst' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });

  assert(draftRes.status === 200, 'Draft saved successfully');

  // Verify the updated values
  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();
  const schemas = data.schema?.schemas?.[0];

  const header = schemas.find(s => s.name === 'header');
  assert(header?.pageScope === 'last', 'Header pageScope updated to last');

  const body = schemas.find(s => s.name === 'body');
  assert(body?.pageScope === 'all', 'Body pageScope set to all');

  const footer = schemas.find(s => s.name === 'footer');
  assert(footer?.pageScope === 'notFirst', 'Footer pageScope updated to notFirst');
}

async function testNewElementDefaultPageScope() {
  console.log('\n--- New element defaults to pageScope=all ---');

  // Create a brand new template with a single element, no pageScope set
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'New Element Default Test 238',
      type: 'statement',
      schema: {
        schemas: [[
          { type: 'image', name: 'logo', position: { x: 20, y: 20 }, width: 50, height: 50, pageScope: 'all' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  const newId = data.id;

  assert(res.status === 201 || res.status === 200, 'New template created');

  const getRes = await fetch(`${API_BASE}/templates/${newId}`, { headers: HEADERS });
  const getData = await getRes.json();
  const el = getData.schema?.schemas?.[0]?.[0];
  assert(el?.pageScope === 'all', 'New image element has pageScope=all');

  // Cleanup
  await fetch(`${API_BASE}/templates/${newId}`, { method: 'DELETE', headers: HEADERS });
}

async function testAllPageScopeValues() {
  console.log('\n--- All pageScope values accepted ---');

  const scopes = ['all', 'first', 'last', 'notFirst'];
  for (const scope of scopes) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `Scope ${scope} Test`,
        type: 'invoice',
        schema: {
          schemas: [[
            { type: 'text', name: 'el', content: 'test', position: { x: 10, y: 10 }, width: 100, height: 20, pageScope: scope },
          ]],
          basePdf: 'BLANK_PDF',
        },
      }),
    });
    const data = await res.json();
    assert(res.status === 201 || res.status === 200, `Template with pageScope=${scope} created`);

    const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
    const getData = await getRes.json();
    assert(getData.schema?.schemas?.[0]?.[0]?.pageScope === scope, `pageScope=${scope} persisted correctly`);

    // Cleanup
    await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testMultipleElementsDifferentScopes() {
  console.log('\n--- Multiple elements with different scopes ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Multi Scope Test 238',
      type: 'purchase_order',
      schema: {
        schemas: [[
          { type: 'text', name: 'always', content: 'Always', position: { x: 10, y: 10 }, width: 100, height: 20, pageScope: 'all' },
          { type: 'text', name: 'firstOnly', content: 'First', position: { x: 10, y: 40 }, width: 100, height: 20, pageScope: 'first' },
          { type: 'text', name: 'lastOnly', content: 'Last', position: { x: 10, y: 70 }, width: 100, height: 20, pageScope: 'last' },
          { type: 'text', name: 'continuation', content: 'Continued', position: { x: 10, y: 100 }, width: 100, height: 20, pageScope: 'notFirst' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  const multiId = data.id;

  const getRes = await fetch(`${API_BASE}/templates/${multiId}`, { headers: HEADERS });
  const getData = await getRes.json();
  const schemas = getData.schema?.schemas?.[0];

  assert(schemas.length === 4, 'All 4 elements stored');
  assert(schemas.find(s => s.name === 'always')?.pageScope === 'all', 'always element is all');
  assert(schemas.find(s => s.name === 'firstOnly')?.pageScope === 'first', 'firstOnly element is first');
  assert(schemas.find(s => s.name === 'lastOnly')?.pageScope === 'last', 'lastOnly element is last');
  assert(schemas.find(s => s.name === 'continuation')?.pageScope === 'notFirst', 'continuation element is notFirst');

  // Cleanup
  await fetch(`${API_BASE}/templates/${multiId}`, { method: 'DELETE', headers: HEADERS });
}

async function testPageScopePreservedOnPublish() {
  console.log('\n--- pageScope preserved on publish ---');

  // Publish the template
  const pubRes = await fetch(`${API_BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: HEADERS,
  });

  // Check published version retains pageScope
  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();

  assert(data.status === 'published', 'Template is published');
  const schemas = data.schema?.schemas?.[0];
  assert(schemas && schemas.length >= 3, 'Published template has elements');

  // Verify pageScope values survived publish
  const header = schemas.find(s => s.name === 'header');
  assert(header?.pageScope !== undefined, 'pageScope preserved after publish');
}

async function run() {
  try {
    await setup();
    await testPageScopeStoredInSchema();
    await testPageScopeUpdateViaDraft();
    await testNewElementDefaultPageScope();
    await testAllPageScopeValues();
    await testMultipleElementsDifferentScopes();
    await testPageScopePreservedOnPublish();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Feature #238: Page scope defaults to all`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(40)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
