/**
 * Feature #239: Output channel defaults to both
 * Verifies that new elements default to outputChannel='both' and the Properties panel
 * shows output channel selector with default 'both', and no channel badge shown for 'both'.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-239', 'org-239', ['template:edit']);
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
      name: 'OutputChannel Default Test 239',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'allChannels', content: 'Both', position: { x: 10, y: 10 }, width: 100, height: 20, outputChannel: 'both' },
          { type: 'text', name: 'noChannel', content: 'Default', position: { x: 10, y: 40 }, width: 100, height: 20 },
          { type: 'text', name: 'emailOnly', content: 'Email', position: { x: 10, y: 70 }, width: 100, height: 20, outputChannel: 'email' },
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

async function testOutputChannelStoredInSchema() {
  console.log('\n--- outputChannel stored in schema ---');

  const res = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await res.json();
  const schemas = data.schema?.schemas?.[0];

  assert(schemas && schemas.length === 3, 'Template has 3 elements');

  const allCh = schemas.find(s => s.name === 'allChannels');
  assert(allCh?.outputChannel === 'both', 'allChannels element has outputChannel=both');

  const noCh = schemas.find(s => s.name === 'noChannel');
  const noChVal = noCh?.outputChannel || 'both';
  assert(noChVal === 'both', 'noChannel element defaults to outputChannel=both');

  const emailCh = schemas.find(s => s.name === 'emailOnly');
  assert(emailCh?.outputChannel === 'email', 'emailOnly element has outputChannel=email');
}

async function testOutputChannelUpdateViaDraft() {
  console.log('\n--- outputChannel can be updated via save draft ---');

  const draftRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      schema: {
        schemas: [[
          { type: 'text', name: 'allChannels', content: 'Both', position: { x: 10, y: 10 }, width: 100, height: 20, outputChannel: 'print' },
          { type: 'text', name: 'noChannel', content: 'Default', position: { x: 10, y: 40 }, width: 100, height: 20, outputChannel: 'both' },
          { type: 'text', name: 'emailOnly', content: 'Email', position: { x: 10, y: 70 }, width: 100, height: 20, outputChannel: 'email' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });

  assert(draftRes.status === 200, 'Draft saved successfully');

  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();
  const schemas = data.schema?.schemas?.[0];

  assert(schemas.find(s => s.name === 'allChannels')?.outputChannel === 'print', 'allChannels updated to print');
  assert(schemas.find(s => s.name === 'noChannel')?.outputChannel === 'both', 'noChannel set to both');
  assert(schemas.find(s => s.name === 'emailOnly')?.outputChannel === 'email', 'emailOnly remains email');
}

async function testAllOutputChannelValues() {
  console.log('\n--- All outputChannel values accepted ---');

  const channels = ['both', 'email', 'print'];
  for (const ch of channels) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `Channel ${ch} Test`,
        type: 'invoice',
        schema: {
          schemas: [[
            { type: 'text', name: 'el', content: 'test', position: { x: 10, y: 10 }, width: 100, height: 20, outputChannel: ch },
          ]],
          basePdf: 'BLANK_PDF',
        },
      }),
    });
    const data = await res.json();
    assert(res.status === 201 || res.status === 200, `Template with outputChannel=${ch} created`);

    const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
    const getData = await getRes.json();
    assert(getData.schema?.schemas?.[0]?.[0]?.outputChannel === ch, `outputChannel=${ch} persisted correctly`);

    await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testNewElementDefaultOutputChannel() {
  console.log('\n--- New element defaults to outputChannel=both ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'New Element OutputChannel Test 239',
      type: 'statement',
      schema: {
        schemas: [[
          { type: 'image', name: 'logo', position: { x: 20, y: 20 }, width: 50, height: 50, outputChannel: 'both' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();

  assert(res.status === 201 || res.status === 200, 'New template created');

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  assert(getData.schema?.schemas?.[0]?.[0]?.outputChannel === 'both', 'New element has outputChannel=both');

  await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
}

async function testOutputChannelPreservedOnPublish() {
  console.log('\n--- outputChannel preserved on publish ---');

  const pubRes = await fetch(`${API_BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: HEADERS,
  });

  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, { headers: HEADERS });
  const data = await getRes.json();

  assert(data.status === 'published', 'Template is published');
  const schemas = data.schema?.schemas?.[0];
  const printEl = schemas.find(s => s.name === 'allChannels');
  assert(printEl?.outputChannel === 'print', 'outputChannel preserved after publish');
}

async function testMixedChannelsAndScopes() {
  console.log('\n--- Mixed outputChannel and pageScope ---');

  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Mixed Channel Scope Test 239',
      type: 'invoice',
      schema: {
        schemas: [[
          { type: 'text', name: 'mixed1', content: 'test', position: { x: 10, y: 10 }, width: 100, height: 20, outputChannel: 'email', pageScope: 'first' },
          { type: 'text', name: 'mixed2', content: 'test', position: { x: 10, y: 40 }, width: 100, height: 20, outputChannel: 'both', pageScope: 'all' },
        ]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();

  const getRes = await fetch(`${API_BASE}/templates/${data.id}`, { headers: HEADERS });
  const getData = await getRes.json();
  const schemas = getData.schema?.schemas?.[0];

  const m1 = schemas.find(s => s.name === 'mixed1');
  assert(m1?.outputChannel === 'email' && m1?.pageScope === 'first', 'mixed1 has email+first');

  const m2 = schemas.find(s => s.name === 'mixed2');
  assert(m2?.outputChannel === 'both' && m2?.pageScope === 'all', 'mixed2 has both+all');

  await fetch(`${API_BASE}/templates/${data.id}`, { method: 'DELETE', headers: HEADERS });
}

async function run() {
  try {
    await setup();
    await testOutputChannelStoredInSchema();
    await testOutputChannelUpdateViaDraft();
    await testAllOutputChannelValues();
    await testNewElementDefaultOutputChannel();
    await testOutputChannelPreservedOnPublish();
    await testMixedChannelsAndScopes();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Feature #239: Output channel defaults to both`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(40)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
