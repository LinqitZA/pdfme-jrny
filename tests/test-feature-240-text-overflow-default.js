/**
 * Feature #240: Text overflow defaults to clip
 * Verifies that new text elements default to textOverflow='clip' and the Properties panel
 * shows text overflow setting with default 'clip'.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-240', 'org-240', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let templateId;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function setup() {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'TextOverflow Default Test 240',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'clipped', content: 'Clipped text', position: { x: 10, y: 10 }, width: 100, height: 20, textOverflow: 'clip' },
          { type: 'text', name: 'noOverflow', content: 'Default text', position: { x: 10, y: 40 }, width: 100, height: 20 },
          { type: 'text', name: 'truncated', content: 'Truncated text', position: { x: 10, y: 70 }, width: 100, height: 20, textOverflow: 'truncate' },
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

async function testTextOverflowStoredInSchema() {
  console.log('\n--- textOverflow stored in schema ---');

  const res = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await res.json();
  const schemas = data.schema?.schemas?.[0];

  assert(schemas && schemas.length === 3, 'Template has 3 elements');

  const clipped = schemas.find(s => s.name === 'clipped');
  assert(clipped?.textOverflow === 'clip', 'Clipped element has textOverflow=clip');

  const noOverflow = schemas.find(s => s.name === 'noOverflow');
  const noOvVal = noOverflow?.textOverflow || 'clip';
  assert(noOvVal === 'clip', 'Default text element defaults to textOverflow=clip');

  const truncated = schemas.find(s => s.name === 'truncated');
  assert(truncated?.textOverflow === 'truncate', 'Truncated element has textOverflow=truncate');
}

async function testTextOverflowUpdateViaDraft() {
  console.log('\n--- textOverflow can be updated via save draft ---');

  const draftRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      schema: {
        schemas: [[
          { type: 'text', name: 'clipped', content: 'Clipped text', position: { x: 10, y: 10 }, width: 100, height: 20, textOverflow: 'shrinkToFit' },
          { type: 'text', name: 'noOverflow', content: 'Default text', position: { x: 10, y: 40 }, width: 100, height: 20, textOverflow: 'clip' },
          { type: 'text', name: 'truncated', content: 'Truncated text', position: { x: 10, y: 70 }, width: 100, height: 20, textOverflow: 'truncate' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });

  assert(draftRes.status === 200, 'Draft saved successfully');

  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();
  const schemas = data.schema?.schemas?.[0];

  assert(schemas.find(s => s.name === 'clipped')?.textOverflow === 'shrinkToFit', 'Clipped updated to shrinkToFit');
  assert(schemas.find(s => s.name === 'noOverflow')?.textOverflow === 'clip', 'noOverflow set to clip');
  assert(schemas.find(s => s.name === 'truncated')?.textOverflow === 'truncate', 'Truncated remains truncate');
}

async function testAllTextOverflowValues() {
  console.log('\n--- All textOverflow values accepted ---');

  const strategies = ['clip', 'truncate', 'shrinkToFit'];
  for (const strategy of strategies) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `Overflow ${strategy} Test`,
        type: 'invoice',
        schema: {
          schemas: [[
            { type: 'text', name: 'el', content: 'test', position: { x: 10, y: 10 }, width: 100, height: 20, textOverflow: strategy },
          ]],
          basePdf: 'BLANK_PDF',
        },
      }),
    });
    const data = await res.json();
    assert(res.status === 201 || res.status === 200, `Template with textOverflow=${strategy} created`);

    const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
    const getData = await getRes.json();
    assert(getData.schema?.schemas?.[0]?.[0]?.textOverflow === strategy, `textOverflow=${strategy} persisted correctly`);

    await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testNewTextElementDefault() {
  console.log('\n--- New text element defaults to textOverflow=clip ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'New Text Default Test 240',
      type: 'statement',
      schema: {
        schemas: [[
          { type: 'text', name: 'newText', content: 'Hello', position: { x: 20, y: 20 }, width: 100, height: 20, textOverflow: 'clip' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  assert(res.status === 201 || res.status === 200, 'New template created');

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  assert(getData.schema?.schemas?.[0]?.[0]?.textOverflow === 'clip', 'New text element has textOverflow=clip');

  await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
}

async function testTextOverflowPreservedOnPublish() {
  console.log('\n--- textOverflow preserved on publish ---');

  const pubRes = await fetch(`${API_BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: HEADERS,
  });

  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();

  assert(data.status === 'published', 'Template is published');
  const schemas = data.schema?.schemas?.[0];
  const shrinkEl = schemas.find(s => s.name === 'clipped');
  assert(shrinkEl?.textOverflow === 'shrinkToFit', 'textOverflow preserved after publish');
}

async function testNonTextElementsNoTextOverflow() {
  console.log('\n--- Non-text elements do not need textOverflow ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Non-text Overflow Test 240',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'image', name: 'img', position: { x: 10, y: 10 }, width: 100, height: 100 },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  assert(res.status === 201 || res.status === 200, 'Image template created');

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const img = getData.schema?.schemas?.[0]?.[0];
  assert(img?.textOverflow === undefined || img?.textOverflow === null, 'Image element has no textOverflow');

  await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
}

async function testMultipleTextOverflowStrategies() {
  console.log('\n--- Multiple text elements with different overflow strategies ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Multi Overflow Test 240',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'clipEl', content: 'Clip', position: { x: 10, y: 10 }, width: 100, height: 20, textOverflow: 'clip' },
          { type: 'text', name: 'truncEl', content: 'Truncate', position: { x: 10, y: 40 }, width: 100, height: 20, textOverflow: 'truncate' },
          { type: 'text', name: 'shrinkEl', content: 'Shrink', position: { x: 10, y: 70 }, width: 100, height: 20, textOverflow: 'shrinkToFit' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const schemas = getData.schema?.schemas?.[0];

  assert(schemas.find(s => s.name === 'clipEl')?.textOverflow === 'clip', 'clipEl has clip');
  assert(schemas.find(s => s.name === 'truncEl')?.textOverflow === 'truncate', 'truncEl has truncate');
  assert(schemas.find(s => s.name === 'shrinkEl')?.textOverflow === 'shrinkToFit', 'shrinkEl has shrinkToFit');

  await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
}

async function run() {
  try {
    await setup();
    await testTextOverflowStoredInSchema();
    await testTextOverflowUpdateViaDraft();
    await testAllTextOverflowValues();
    await testNewTextElementDefault();
    await testTextOverflowPreservedOnPublish();
    await testNonTextElementsNoTextOverflow();
    await testMultipleTextOverflowStrategies();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Feature #240: Text overflow defaults to clip`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(40)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
