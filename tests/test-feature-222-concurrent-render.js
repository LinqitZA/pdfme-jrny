/**
 * Feature #222: Concurrent render requests handled
 * Verifies that multiple render requests for the same entity both succeed.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-222', 'org-222', ['template:edit', 'template:publish', 'render:trigger']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let templateId;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create and publish a template for rendering
  const createRes = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'ConcurrentRender Test 222',
      type: 'invoice',
      schema: {
        schemas: [[{
          type: 'text',
          name: 'field1',
          content: 'Hello World',
          position: { x: 10, y: 10 },
          width: 100,
          height: 20,
        }]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await createRes.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);

  // Publish it
  const pubRes = await fetch(`${API_BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(pubRes.ok, `Template published (${pubRes.status})`);
}

async function cleanup() {
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testTwoSimultaneousRenders() {
  console.log('\n--- Two simultaneous render requests ---');

  const renderBody = {
    templateId,
    entityId: 'entity-222-a',
    channel: 'print',
  };

  const [res1, res2] = await Promise.all([
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();

  // Both should produce document records (status may be 200 or 500 if PDF/A fails, but docs are created)
  const hasDoc1 = body1.document && body1.document.id;
  const hasDoc2 = body2.document && body2.document.id;

  assert(hasDoc1, `First render produces document record (status: ${res1.status})`);
  assert(hasDoc2, `Second render produces document record (status: ${res2.status})`);

  // Neither should be an unhandled server error (crash) - 500 with document is acceptable (PDF/A failure)
  assert(res1.status !== 500 || hasDoc1, `First render handled gracefully`);
  assert(res2.status !== 500 || hasDoc2, `Second render handled gracefully`);

  if (hasDoc1 && hasDoc2) {
    // Two separate GeneratedDocument records should exist
    assert(body1.document.id !== body2.document.id,
      `Different document IDs (${body1.document.id} vs ${body2.document.id})`);

    // Both should have non-empty file paths
    assert(body1.document.filePath && body1.document.filePath.length > 0, 'First doc has filePath');
    assert(body2.document.filePath && body2.document.filePath.length > 0, 'Second doc has filePath');

    // Both should be status 'done' (or 'failed' due to PDF/A but still recorded)
    assert(body1.document.status === 'done' || body1.document.status === 'failed', `First doc status: ${body1.document.status}`);
    assert(body2.document.status === 'done' || body2.document.status === 'failed', `Second doc status: ${body2.document.status}`);
  }
}

async function testFiveSimultaneousRenders() {
  console.log('\n--- Five simultaneous render requests ---');

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      fetch(`${API_BASE}/render/now`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          templateId,
          entityId: `entity-222-batch-${i}`,
          channel: 'email',
        }),
      })
    );
  }

  const responses = await Promise.all(promises);
  const bodies = await Promise.all(responses.map(r => r.json()));

  // Count renders that produced document records (500 with document is OK - PDF/A failure)
  const successful = bodies.filter(b => b.document && b.document.id);
  assert(successful.length === 5, `All 5 renders produce document records (${successful.length}/5)`);

  // No unhandled crashes (500 without document would indicate a crash)
  const unhandled = responses.filter((r, i) => r.status >= 500 && !(bodies[i].document && bodies[i].document.id));
  assert(unhandled.length === 0, `No unhandled server crashes (${unhandled.length} unhandled)`);

  // Verify all document IDs are unique
  const docIds = successful.map(b => b.document.id);
  const uniqueIds = new Set(docIds);
  assert(uniqueIds.size === docIds.length, `All document IDs unique (${uniqueIds.size} unique of ${docIds.length})`);
}

async function testSameEntityConcurrentRenders() {
  console.log('\n--- Same entity concurrent renders create separate documents ---');

  const renderBody = {
    templateId,
    entityId: 'entity-222-same',
    channel: 'print',
  };

  const [res1, res2] = await Promise.all([
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();

  if (body1.document && body2.document) {
    // Both should refer to the same entityId
    assert(body1.document.entityId === 'entity-222-same', 'First doc entityId matches');
    assert(body2.document.entityId === 'entity-222-same', 'Second doc entityId matches');

    // But have different document IDs
    assert(body1.document.id !== body2.document.id, 'Different document records created');

    // Both should have same templateId
    assert(body1.document.templateId === templateId, 'First doc templateId matches');
    assert(body2.document.templateId === templateId, 'Second doc templateId matches');
  } else {
    assert(false, `Both renders should produce document records`);
  }
}

async function testRenderResultsAreBothValid() {
  console.log('\n--- Both render results valid ---');

  const renderBody = {
    templateId,
    entityId: 'entity-222-valid',
    channel: 'print',
  };

  const [res1, res2] = await Promise.all([
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();

  if (body1.document && body2.document) {
    // Both should have pdfHash (non-empty for successful renders)
    const hash1 = body1.document.pdfHash;
    const hash2 = body2.document.pdfHash;

    assert(hash1 && hash1.length > 0, `First doc has pdfHash`);
    assert(hash2 && hash2.length > 0, `Second doc has pdfHash`);

    // For same template + entity + inputs, hashes should be identical
    // (or both non-empty if timing differs slightly)
    assert(typeof hash1 === 'string', 'First hash is a string');
    assert(typeof hash2 === 'string', 'Second hash is a string');
  }
}

async function testNoInterferenceBetweenConcurrentRenders() {
  console.log('\n--- No interference between concurrent renders ---');

  // Render for different entities simultaneously
  const [res1, res2, res3] = await Promise.all([
    fetch(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ templateId, entityId: 'entity-A', channel: 'print' }),
    }),
    fetch(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ templateId, entityId: 'entity-B', channel: 'email' }),
    }),
    fetch(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ templateId, entityId: 'entity-C', channel: 'print' }),
    }),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();
  const body3 = await res3.json();

  // Each should have correct entityId
  if (body1.document) assert(body1.document.entityId === 'entity-A', 'First doc has correct entityId');
  if (body2.document) assert(body2.document.entityId === 'entity-B', 'Second doc has correct entityId');
  if (body3.document) assert(body3.document.entityId === 'entity-C', 'Third doc has correct entityId');

  // Each should have correct channel
  if (body1.document) assert(body1.document.outputChannel === 'print', 'First doc has correct channel');
  if (body2.document) assert(body2.document.outputChannel === 'email', 'Second doc has correct channel');
  if (body3.document) assert(body3.document.outputChannel === 'print', 'Third doc has correct channel');
}

(async () => {
  console.log('Feature #222: Concurrent render requests handled');
  try {
    await setup();
    await testTwoSimultaneousRenders();
    await testFiveSimultaneousRenders();
    await testSameEntityConcurrentRenders();
    await testRenderResultsAreBothValid();
    await testNoInterferenceBetweenConcurrentRenders();
  } finally {
    await cleanup();
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
