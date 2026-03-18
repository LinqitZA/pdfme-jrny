/**
 * Feature #331: Concurrent render of same entity stable
 * Parallel renders for same entity don't corrupt - each produces separate document and PDF file.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-331', 'org-331', ['template:edit', 'template:publish', 'render:trigger']);
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
      name: 'ConcurrentSameEntity Test 331',
      type: 'invoice',
      schema: {
        pages: [{ elements: [{ type: 'text', name: 'field1', content: 'Concurrent Entity Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
        schemas: [[{ type: 'text', name: 'field1', content: 'Concurrent Entity Test', position: { x: 10, y: 10 }, width: 100, height: 20 }]],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
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

async function testThreeSimultaneousRendersForSameEntity() {
  console.log('\n--- Step 1 & 2: Start 3 render/now requests simultaneously for same entity, verify all complete ---');

  const renderBody = {
    templateId,
    entityId: 'entity-331-same',
    channel: 'print',
  };

  // Fire 3 requests in parallel
  const [res1, res2, res3] = await Promise.all([
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
    fetch(`${API_BASE}/render/now`, { method: 'POST', headers: HEADERS, body: JSON.stringify(renderBody) }),
  ]);

  const body1 = await res1.json();
  const body2 = await res2.json();
  const body3 = await res3.json();

  // All 3 should complete successfully (200 OK, or 500 with document for PDF/A failures)
  const hasDoc1 = body1.document && body1.document.id;
  const hasDoc2 = body2.document && body2.document.id;
  const hasDoc3 = body3.document && body3.document.id;

  assert(hasDoc1, `First render completes with document record (status: ${res1.status})`);
  assert(hasDoc2, `Second render completes with document record (status: ${res2.status})`);
  assert(hasDoc3, `Third render completes with document record (status: ${res3.status})`);

  // No unhandled crashes (500 without document = crash)
  assert(res1.status !== 500 || hasDoc1, 'First render handled gracefully (no crash)');
  assert(res2.status !== 500 || hasDoc2, 'Second render handled gracefully (no crash)');
  assert(res3.status !== 500 || hasDoc3, 'Third render handled gracefully (no crash)');

  if (hasDoc1 && hasDoc2 && hasDoc3) {
    // Step 3: Verify 3 separate GeneratedDocument records (unique IDs)
    console.log('\n--- Step 3: Verify 3 separate GeneratedDocument records ---');
    const ids = [body1.document.id, body2.document.id, body3.document.id];
    const uniqueIds = new Set(ids);
    assert(uniqueIds.size === 3, `All 3 document IDs are unique: ${ids.join(', ')}`);

    // All refer to the same entity
    assert(body1.document.entityId === 'entity-331-same', 'Doc 1 has correct entityId');
    assert(body2.document.entityId === 'entity-331-same', 'Doc 2 has correct entityId');
    assert(body3.document.entityId === 'entity-331-same', 'Doc 3 has correct entityId');

    // All refer to the same template
    assert(body1.document.templateId === templateId, 'Doc 1 has correct templateId');
    assert(body2.document.templateId === templateId, 'Doc 2 has correct templateId');
    assert(body3.document.templateId === templateId, 'Doc 3 has correct templateId');

    // Step 4: Verify 3 separate PDF files (unique file paths)
    console.log('\n--- Step 4: Verify 3 separate PDF files ---');
    const paths = [body1.document.filePath, body2.document.filePath, body3.document.filePath];
    const uniquePaths = new Set(paths);
    assert(uniquePaths.size === 3, `All 3 file paths are unique: ${paths.join(', ')}`);

    // Each file path should be non-empty
    assert(paths[0] && paths[0].length > 0, 'Doc 1 has non-empty filePath');
    assert(paths[1] && paths[1].length > 0, 'Doc 2 has non-empty filePath');
    assert(paths[2] && paths[2].length > 0, 'Doc 3 has non-empty filePath');

    // Each should have a pdf hash
    assert(body1.document.pdfHash && body1.document.pdfHash.length > 0, 'Doc 1 has pdfHash');
    assert(body2.document.pdfHash && body2.document.pdfHash.length > 0, 'Doc 2 has pdfHash');
    assert(body3.document.pdfHash && body3.document.pdfHash.length > 0, 'Doc 3 has pdfHash');

    // Verify no corruption: all docs should have status 'done' or 'failed' (with PDF file)
    const validStatuses = ['done', 'failed'];
    assert(validStatuses.includes(body1.document.status), `Doc 1 status is valid: ${body1.document.status}`);
    assert(validStatuses.includes(body2.document.status), `Doc 2 status is valid: ${body2.document.status}`);
    assert(validStatuses.includes(body3.document.status), `Doc 3 status is valid: ${body3.document.status}`);

    // Verify documents are retrievable from the documents list endpoint
    const listRes = await fetch(`${API_BASE}/render/documents/${templateId}`, {
      headers: HEADERS,
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const allDocs = listData.data || [];
      const found331 = allDocs.filter(d => d.entityId === 'entity-331-same');
      assert(found331.length >= 3, `At least 3 documents found for entity-331-same in list (found ${found331.length})`);
    }
  }
}

(async () => {
  console.log('Feature #331: Concurrent render of same entity stable');
  try {
    await setup();
    await testThreeSimultaneousRendersForSameEntity();
  } finally {
    await cleanup();
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
