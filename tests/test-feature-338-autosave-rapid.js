/**
 * Feature #338: Auto-save during rapid editing
 * Auto-save during fast edits captures latest state
 *
 * Tests:
 * 1. Make rapid changes (10 edits in 5 seconds)
 * 2. Wait for auto-save trigger
 * 3. Verify saved state includes all changes
 * 4. Verify no partial state saved
 */

const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function makeToken(userId, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || 'test-user-338',
    orgId: orgId || 'org-338',
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function apiPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function apiGet(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log('\n=== Feature #338: Auto-save during rapid editing ===\n');

  const token = makeToken('test-user-338', 'org-338');

  // Create a template to work with
  console.log('Setup: Create test template');
  const createRes = await apiPost('/templates', {
    name: 'Rapid Edit Test 338',
    type: 'invoice',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ elements: [] }],
    },
  }, token);
  assert(createRes.status === 201, `Template created (status ${createRes.status})`);
  const templateId = createRes.data.id;
  console.log(`  Template ID: ${templateId}`);

  // Acquire lock
  const lockRes = await apiPost(`/templates/${templateId}/lock`, {}, token);
  assert(lockRes.status === 200 || lockRes.status === 201, 'Lock acquired');

  // --- Test 1: Make rapid changes (10 edits in 5 seconds) ---
  console.log('\nTest 1: Make rapid changes (10 edits in ~5 seconds)');

  const editNames = [];
  for (let i = 1; i <= 10; i++) {
    const editName = `Rapid Edit v${i} - ${Date.now()}`;
    editNames.push(editName);

    const elements = [];
    for (let j = 0; j < i; j++) {
      elements.push({
        type: 'text',
        x: 10 + j * 20,
        y: 10 + j * 15,
        width: 100,
        height: 20,
        content: `Element ${j + 1} from edit ${i}`,
      });
    }

    const draftRes = await apiPut(`/templates/${templateId}/draft`, {
      name: editName,
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [{ elements }],
      },
    }, token);
    assert(draftRes.status === 200, `Edit ${i}/10 saved (${editName.substring(0, 20)}...)`);

    // ~500ms between edits (10 edits in ~5 seconds)
    if (i < 10) await sleep(500);
  }

  // --- Test 2: Wait and verify final state ---
  console.log('\nTest 2: Verify saved state includes ALL changes from final edit');

  // Small wait for any async processing
  await sleep(1000);

  // Fetch the template and verify it has the LATEST state
  const finalGet = await apiGet(`/templates/${templateId}`, token);
  assert(finalGet.status === 200, 'Template retrieved successfully');

  const finalName = finalGet.data.name;
  const lastEditName = editNames[editNames.length - 1];
  assert(finalName === lastEditName, `Template name is latest edit: "${finalName}"`);

  // Check the schema has 10 elements (from the final edit)
  const finalSchema = finalGet.data.schema;
  const finalPages = finalSchema.pages || [];
  assert(finalPages.length === 1, 'Has 1 page');

  const finalElements = finalPages[0]?.elements || [];
  assert(finalElements.length === 10, `Final edit has 10 elements (got ${finalElements.length})`);

  // Verify element content from the 10th edit
  const lastElement = finalElements[finalElements.length - 1];
  assert(
    lastElement && lastElement.content && lastElement.content.includes('edit 10'),
    `Last element content references edit 10: "${lastElement?.content}"`,
  );

  // --- Test 3: Verify no partial state ---
  console.log('\nTest 3: Verify no partial state (element count matches final edit)');

  // The final state should have exactly 10 elements (from edit 10)
  // Not 1, 2, 3... from intermediate edits
  assert(finalElements.length === 10, `Element count (${finalElements.length}) matches final edit count (10)`);

  // All elements should reference their correct position
  for (let j = 0; j < finalElements.length; j++) {
    const el = finalElements[j];
    const expectedContent = `Element ${j + 1} from edit 10`;
    assert(
      el.content === expectedContent,
      `Element ${j + 1} has correct content from final edit`,
    );
  }

  // --- Test 4: Rapid saves with concurrent auto-save simulation ---
  console.log('\nTest 4: Simulate concurrent auto-save with rapid edits');

  // Save 5 times very rapidly (no delay)
  const rapidPromises = [];
  for (let i = 1; i <= 5; i++) {
    const editName = `Concurrent Save v${i}`;
    const elements = Array.from({ length: i + 10 }, (_, j) => ({
      type: 'text',
      x: j * 10,
      y: j * 10,
      width: 80,
      height: 15,
      content: `Concurrent element ${j + 1} batch ${i}`,
    }));

    rapidPromises.push(
      apiPut(`/templates/${templateId}/draft`, {
        name: editName,
        schema: {
          schemas: [],
          basePdf: 'BLANK_PDF',
          pageSize: 'A4',
          pages: [{ elements }],
        },
      }, token),
    );
  }

  const rapidResults = await Promise.all(rapidPromises);
  const allSucceeded = rapidResults.every(r => r.status === 200);
  assert(allSucceeded, 'All 5 concurrent saves completed successfully');

  // Wait and fetch final state
  await sleep(500);
  const concurrentGet = await apiGet(`/templates/${templateId}`, token);
  assert(concurrentGet.status === 200, 'Template retrieved after concurrent saves');

  // The name should be one of the concurrent save names (last write wins)
  const concName = concurrentGet.data.name;
  const isConcurrentName = concName.startsWith('Concurrent Save v');
  assert(isConcurrentName, `Final name is from concurrent save batch: "${concName}"`);

  // Schema should be consistent (element count should match one complete edit, not mixed)
  const concPages = concurrentGet.data.schema.pages || [];
  const concElements = concPages[0]?.elements || [];
  // The name tells us which batch won - verify element count matches
  const batchNum = parseInt(concName.replace('Concurrent Save v', ''));
  const expectedElements = batchNum + 10;
  assert(
    concElements.length === expectedElements,
    `Element count (${concElements.length}) matches winning batch ${batchNum} (expected ${expectedElements})`,
  );

  // Verify all elements are from the same batch (no mixed state)
  const allSameBatch = concElements.every(el => el.content && el.content.includes(`batch ${batchNum}`));
  assert(allSameBatch, `All elements are from batch ${batchNum} (no mixed state)`);

  // --- Test 5: Auto-save preserves latest changes after delay ---
  console.log('\nTest 5: Saved state persists and is retrievable');

  // Make one final known edit
  const finalEditName = `FINAL_STATE_338_${Date.now()}`;
  const finalEditRes = await apiPut(`/templates/${templateId}/draft`, {
    name: finalEditName,
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{
        elements: [
          { type: 'text', x: 50, y: 50, width: 200, height: 30, content: 'Final verified state' },
        ],
      }],
    },
  }, token);
  assert(finalEditRes.status === 200, 'Final edit saved');

  // Wait and retrieve
  await sleep(500);
  const verifyGet = await apiGet(`/templates/${templateId}`, token);
  assert(verifyGet.data.name === finalEditName, `Persisted name matches: "${verifyGet.data.name}"`);
  assert(
    verifyGet.data.schema.pages[0].elements[0].content === 'Final verified state',
    'Persisted content matches final edit',
  );

  // Release lock
  await apiPost(`/templates/${templateId}/lock/release`, {}, token);

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
