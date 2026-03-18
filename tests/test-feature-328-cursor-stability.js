/**
 * Feature #328: Pagination cursor stable across time
 *
 * Tests that cursor-based pagination handles new records correctly.
 * When new templates are created between page fetches, the cursor
 * should still produce consistent results with no duplicates or gaps.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-cursor-test-328';

function generateToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'cursor-test-user',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createTemplate(name, index) {
  const res = await request('POST', '/api/pdfme/templates', {
    name: `CURSOR_TEST_${name}_${index}_${Date.now()}`,
    type: 'invoice',
    orgId: ORG_ID,
    schema: { pages: [{ elements: [] }] },
    createdBy: 'cursor-test-user',
  });
  return res;
}

async function listTemplates(limit, cursor) {
  let path = `/api/pdfme/templates?orgId=${ORG_ID}&limit=${limit}`;
  if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
  return request('GET', path);
}

async function deleteTemplate(id) {
  return request('DELETE', `/api/pdfme/templates/${id}`);
}

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function cleanup() {
  for (const id of createdIds) {
    try { await deleteTemplate(id); } catch {}
  }
}

async function runTests() {
  console.log('Feature #328: Pagination cursor stable across time\n');

  // Step 1: Create 20 templates with small delay between each for unique timestamps
  console.log('Step 1: Creating 20 initial templates...');
  const initialTemplates = [];
  for (let i = 0; i < 20; i++) {
    const res = await createTemplate('INIT', i);
    assert(res.status === 201, `Created initial template ${i + 1}/20`);
    if (res.body?.id) {
      createdIds.push(res.body.id);
      initialTemplates.push(res.body);
    }
    // Small delay to ensure distinct timestamps
    if (i < 19) await new Promise(r => setTimeout(r, 20));
  }

  // Step 2: GET page 1 with limit=10 to get cursor
  console.log('\nStep 2: Fetching page 1 (limit=10)...');
  const page1 = await listTemplates(10);
  assert(page1.status === 200, 'Page 1 returns 200');
  assert(page1.body.data && page1.body.data.length === 10, `Page 1 has 10 items (got ${page1.body.data?.length})`);
  assert(page1.body.pagination.hasMore === true, 'Page 1 indicates hasMore=true');
  assert(page1.body.pagination.nextCursor !== null, 'Page 1 has a nextCursor');

  const page1Cursor = page1.body.pagination.nextCursor;
  const page1Ids = page1.body.data.map(t => t.id);

  console.log(`  Cursor obtained: ${page1Cursor ? page1Cursor.substring(0, 30) + '...' : 'null'}`);

  // Step 3: Create 5 more templates (these should NOT affect page 2 results)
  console.log('\nStep 3: Creating 5 more templates after getting cursor...');
  const newTemplates = [];
  for (let i = 0; i < 5; i++) {
    const res = await createTemplate('NEW', i);
    assert(res.status === 201, `Created new template ${i + 1}/5 after cursor`);
    if (res.body?.id) {
      createdIds.push(res.body.id);
      newTemplates.push(res.body);
    }
    if (i < 4) await new Promise(r => setTimeout(r, 20));
  }

  // Step 4: GET page 2 using the ORIGINAL cursor
  console.log('\nStep 4: Fetching page 2 with original cursor...');
  const page2 = await listTemplates(10, page1Cursor);
  assert(page2.status === 200, 'Page 2 returns 200');
  assert(page2.body.data && page2.body.data.length > 0, `Page 2 has items (got ${page2.body.data?.length})`);

  const page2Ids = page2.body.data.map(t => t.id);

  // Step 5: Verify consistency - no duplicates, no gaps in original 20
  console.log('\nStep 5: Verifying cursor stability...');

  // Check no duplicates between page 1 and page 2
  const duplicates = page1Ids.filter(id => page2Ids.includes(id));
  assert(duplicates.length === 0, `No duplicate IDs between page 1 and page 2 (found ${duplicates.length})`);

  // Check that none of the new templates appear in page 2
  // (they should be "ahead" of the cursor since sorted DESC by createdAt)
  const newIds = newTemplates.map(t => t.id);
  const newInPage2 = page2Ids.filter(id => newIds.includes(id));
  assert(newInPage2.length === 0, `New templates don't appear in page 2 (found ${newInPage2.length})`);

  // Collect all original template IDs
  const originalIds = initialTemplates.map(t => t.id);

  // All page 1 items should be from original templates
  const page1FromOriginal = page1Ids.filter(id => originalIds.includes(id));
  assert(page1FromOriginal.length === page1Ids.length, `All page 1 items are from original set (${page1FromOriginal.length}/${page1Ids.length})`);

  // All page 2 items should be from original templates
  const page2FromOriginal = page2Ids.filter(id => originalIds.includes(id));
  assert(page2FromOriginal.length === page2Ids.length, `All page 2 items are from original set (${page2FromOriginal.length}/${page2Ids.length})`);

  // Combined pages should cover all 20 original templates
  const allPagedIds = [...page1Ids, ...page2Ids];
  const coveredOriginal = originalIds.filter(id => allPagedIds.includes(id));
  assert(coveredOriginal.length === 20, `Pages 1+2 cover all 20 original templates (covered ${coveredOriginal.length})`);

  // Verify ordering: page 1 items should all be newer than page 2 items
  // (since default sort is createdAt DESC)
  if (page1.body.data.length > 0 && page2.body.data.length > 0) {
    const lastPage1Date = new Date(page1.body.data[page1.body.data.length - 1].createdAt);
    const firstPage2Date = new Date(page2.body.data[0].createdAt);
    assert(lastPage1Date >= firstPage2Date, `Page 1 last item (${lastPage1Date.toISOString()}) >= Page 2 first item (${firstPage2Date.toISOString()})`);
  }

  // Additional test: Fetch a fresh page 1 to see new templates appear there
  console.log('\nStep 6: Verify new templates appear in fresh page 1...');
  const freshPage1 = await listTemplates(10);
  assert(freshPage1.status === 200, 'Fresh page 1 returns 200');
  const freshPage1Ids = freshPage1.body.data.map(t => t.id);
  const newInFreshPage1 = freshPage1Ids.filter(id => newIds.includes(id));
  assert(newInFreshPage1.length > 0, `New templates appear in fresh page 1 (found ${newInFreshPage1.length})`);

  // Test: Using cursor multiple times gives same results (idempotent)
  console.log('\nStep 7: Verify cursor is idempotent...');
  const page2Again = await listTemplates(10, page1Cursor);
  assert(page2Again.status === 200, 'Repeated page 2 returns 200');
  const page2AgainIds = page2Again.body.data.map(t => t.id);
  const sameResults = JSON.stringify(page2Ids) === JSON.stringify(page2AgainIds);
  assert(sameResults, 'Same cursor returns same results (idempotent)');

  // Test: Page through all results with no gaps using fresh cursors
  console.log('\nStep 8: Full pagination walk-through with no gaps...');
  const allIds = new Set();
  let currentCursor = null;
  let pageNum = 0;
  let hasMore = true;
  while (hasMore && pageNum < 10) {
    pageNum++;
    const pageRes = await listTemplates(10, currentCursor);
    assert(pageRes.status === 200, `Walk page ${pageNum} returns 200`);
    for (const item of pageRes.body.data) {
      assert(!allIds.has(item.id), `Walk page ${pageNum}: no duplicate ID ${item.id.substring(0, 8)}...`);
      allIds.add(item.id);
    }
    hasMore = pageRes.body.pagination.hasMore;
    currentCursor = pageRes.body.pagination.nextCursor;
  }
  // All 25 of our test templates should be in the walked set
  const allTestIds = [...createdIds];
  const foundTestIds = allTestIds.filter(id => allIds.has(id));
  assert(foundTestIds.length === 25, `Full walk found all 25 test templates (got ${foundTestIds.length} out of ${allIds.size} total)`);

  // Cleanup
  console.log('\nCleaning up test templates...');
  await cleanup();

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`========================================`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  cleanup().then(() => process.exit(1));
});
