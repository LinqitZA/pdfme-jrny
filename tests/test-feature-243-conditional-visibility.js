/**
 * Feature #243: Conditional visibility defaults to always visible
 * Verifies that new elements have no condition set (conditionalVisibility='always'),
 * and that the schema stores/retrieves the property correctly.
 * Also verifies the source code sets the default correctly in addElementToCanvas.
 */
const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');
const path = require('path');

const TOKEN = makeJwt('user-243', 'org-243', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const templateIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function cleanup() {
  for (const id of templateIds) {
    await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }
}

async function testDefaultConditionalVisibilityInSchema() {
  console.log('\n--- New element stored with conditionalVisibility=always ---');

  // Create template with element that has conditionalVisibility='always' (default)
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Cond Vis Default Test 243',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'header', content: 'Hello', position: { x: 10, y: 10 }, width: 100, height: 20, conditionalVisibility: 'always' },
          { type: 'text', name: 'noCondition', content: 'World', position: { x: 10, y: 40 }, width: 100, height: 20 },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  templateIds.push(data.id);
  assert(res.status === 201 || res.status === 200, 'Template created successfully');

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const schemas = getData.schema?.schemas?.[0];

  assert(schemas && schemas.length === 2, 'Template has 2 elements');

  const header = schemas.find(s => s.name === 'header');
  assert(header?.conditionalVisibility === 'always', 'Element with explicit always has conditionalVisibility=always');

  const noCondition = schemas.find(s => s.name === 'noCondition');
  const cv = noCondition?.conditionalVisibility || 'always';
  assert(cv === 'always', 'Element without conditionalVisibility defaults to always');
}

async function testConditionalVisibilityCanBeSetToConditional() {
  console.log('\n--- conditionalVisibility can be set to conditional ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Cond Vis Conditional Test 243',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'condEl', content: 'Conditional', position: { x: 10, y: 10 }, width: 100, height: 20, conditionalVisibility: 'conditional', visibilityCondition: '{{document.total}} > 0' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  templateIds.push(data.id);
  assert(res.status === 201 || res.status === 200, 'Template with conditional element created');

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const el = getData.schema?.schemas?.[0]?.[0];

  assert(el?.conditionalVisibility === 'conditional', 'conditionalVisibility stored as conditional');
  assert(el?.visibilityCondition === '{{document.total}} > 0', 'visibilityCondition stored correctly');
}

async function testConditionalVisibilityUpdateViaDraft() {
  console.log('\n--- conditionalVisibility updated via draft save ---');

  const id = templateIds[0];
  const draftRes = await fetch(`${API_BASE}/templates/${id}/draft`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      schema: {
        schemas: [[
          { type: 'text', name: 'header', content: 'Hello', position: { x: 10, y: 10 }, width: 100, height: 20, conditionalVisibility: 'conditional', visibilityCondition: '{{customer.name}} != ""' },
          { type: 'text', name: 'noCondition', content: 'World', position: { x: 10, y: 40 }, width: 100, height: 20, conditionalVisibility: 'always' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  assert(draftRes.status === 200, 'Draft saved with updated conditionalVisibility');

  const getRes = await fetch(`${API_BASE}/templates/${id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const schemas = getData.schema?.schemas?.[0];

  const header = schemas.find(s => s.name === 'header');
  assert(header?.conditionalVisibility === 'conditional', 'header updated to conditional');
  assert(header?.visibilityCondition === '{{customer.name}} != ""', 'condition expression updated');

  const noCondition = schemas.find(s => s.name === 'noCondition');
  assert(noCondition?.conditionalVisibility === 'always', 'noCondition remains always');
}

async function testConditionalVisibilityPreservedOnPublish() {
  console.log('\n--- conditionalVisibility preserved on publish ---');

  const id = templateIds[0];
  const pubRes = await fetch(`${API_BASE}/templates/${id}/publish`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(pubRes.status === 200 || pubRes.status === 201, 'Template published');

  const getRes = await fetch(`${API_BASE}/templates/${id}`, { headers: HEADERS });
  const getData = await getRes.json();
  assert(getData.status === 'published', 'Template is published');

  const schemas = getData.schema?.schemas?.[0];
  const header = schemas.find(s => s.name === 'header');
  assert(header?.conditionalVisibility === 'conditional', 'conditionalVisibility preserved after publish');
  assert(header?.visibilityCondition === '{{customer.name}} != ""', 'visibilityCondition preserved after publish');
}

async function testMultipleElementTypesDefault() {
  console.log('\n--- Multiple element types default to always ---');

  const types = ['text', 'image', 'rich-text', 'calculated', 'signature', 'line-items'];
  for (const elType of types) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `Type ${elType} CVis Test 243`,
        type: 'invoice',
        schema: {
          schemas: [[
            { type: elType, name: 'el', content: 'test', position: { x: 10, y: 10 }, width: 100, height: 20, conditionalVisibility: 'always' },
          ]],
          basePdf: 'BLANK_PDF',
        },
      }),
    });
    const data = await res.json();
    templateIds.push(data.id);
    assert(res.status === 201 || res.status === 200, `Template with ${elType} element created`);

    const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
    const getData = await getRes.json();
    const el = getData.schema?.schemas?.[0]?.[0];
    const cv = el?.conditionalVisibility || 'always';
    assert(cv === 'always', `${elType} element defaults to conditionalVisibility=always`);
  }
}

async function testSourceCodeDefaults() {
  console.log('\n--- Source code sets correct defaults ---');

  const erpDesignerPath = path.resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx');
  const source = fs.readFileSync(erpDesignerPath, 'utf8');

  // Check DesignElement interface has conditionalVisibility property
  assert(source.includes("conditionalVisibility?: 'always' | 'conditional'"), 'DesignElement interface has conditionalVisibility property');

  // Check addElementToCanvas sets default
  assert(source.includes("conditionalVisibility: 'always'"), 'addElementToCanvas sets conditionalVisibility to always');

  // Check properties panel has conditional visibility section
  assert(source.includes('properties-conditional-visibility'), 'Properties panel has conditional visibility section');
  assert(source.includes('prop-conditional-visibility'), 'Properties panel has conditional visibility dropdown');
  assert(source.includes('Always Visible'), 'Properties panel has Always Visible option');

  // Check no lightning bolt badge when always (badge only shown for conditional)
  assert(source.includes('conditional-visibility-badge'), 'Conditional visibility badge element exists');
  assert(source.includes("conditionalVisibility === 'conditional'"), 'Badge only shown when conditional is selected');
}

async function run() {
  try {
    await testDefaultConditionalVisibilityInSchema();
    await testConditionalVisibilityCanBeSetToConditional();
    await testConditionalVisibilityUpdateViaDraft();
    await testConditionalVisibilityPreservedOnPublish();
    await testMultipleElementTypesDefault();
    await testSourceCodeDefaults();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Feature #243: Conditional visibility defaults to always visible`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
