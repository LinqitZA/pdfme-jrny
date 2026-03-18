/**
 * Feature #333: Rapid pagination requests handled
 * Quick page-forward requests don't cause issues - no race conditions,
 * no duplicate or missing data.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-333', 'org-333', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create 8 templates to have enough data for pagination (limit=2 per page = 4 pages)
  for (let i = 1; i <= 8; i++) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `Pagination Test 333-${String(i).padStart(2, '0')}`,
        type: 'invoice',
        schema: {
          pages: [{ elements: [{ type: 'text', name: 'f1', content: `Item ${i}`, position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
          schemas: [[{ type: 'text', name: 'f1', content: `Item ${i}`, position: { x: 10, y: 10 }, width: 100, height: 20 }]],
          basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        },
      }),
    });
    const data = await res.json();
    createdIds.push(data.id);
    // Small delay to ensure distinct createdAt timestamps for ordering
    await new Promise(r => setTimeout(r, 30));
  }
  console.log(`Created ${createdIds.length} templates for pagination tests`);
}

async function cleanup() {
  for (const id of createdIds) {
    await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function fetchPage(cursor) {
  const params = new URLSearchParams({ limit: '2', sort: 'createdAt', order: 'desc' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${API_BASE}/templates?${params}`, { headers: HEADERS });
  return { status: res.status, body: await res.json() };
}

async function testRapidSequentialPagination() {
  console.log('\n--- Step 1: Rapidly request page 1, 2, 3, 4 sequentially ---');

  const allItems = [];
  let cursor = null;

  for (let page = 1; page <= 4; page++) {
    const { status, body } = await fetchPage(cursor);
    assert(status === 200, `Page ${page} returns 200 (got ${status})`);
    assert(Array.isArray(body.data), `Page ${page} has data array`);
    assert(body.data.length <= 2, `Page ${page} has at most 2 items (got ${body.data.length})`);

    for (const item of body.data) {
      allItems.push(item);
    }

    cursor = body.pagination.nextCursor;
    if (!cursor && page < 4) {
      console.log(`  INFO: No more pages after page ${page}`);
      break;
    }
  }

  // Step 2: Verify each returns correct results
  console.log('\n--- Step 2: Verify each page returns correct results ---');

  // Filter to only our test templates
  const ourItems = allItems.filter(t => t.name && t.name.startsWith('Pagination Test 333-'));
  assert(ourItems.length === 8, `All 8 test templates found across pages (got ${ourItems.length})`);

  // Verify ordering: should be descending by createdAt
  for (let i = 1; i < ourItems.length; i++) {
    const prev = new Date(ourItems[i - 1].createdAt).getTime();
    const curr = new Date(ourItems[i].createdAt).getTime();
    assert(prev >= curr, `Item ${i} comes before item ${i + 1} (desc order)`);
  }
}

async function testRapidParallelPaginationNoRaceCondition() {
  console.log('\n--- Step 3: No race condition between parallel requests ---');

  // Fire all 4 page requests simultaneously (without waiting for cursors)
  // Page 1 needs no cursor, so we can fire it. Others use sequential cursors.
  // For true parallel testing, we fire page 1 multiple times simultaneously.

  const promises = [];
  for (let i = 0; i < 4; i++) {
    promises.push(fetchPage(null)); // All requesting page 1 simultaneously
  }

  const results = await Promise.all(promises);

  // All should succeed
  for (let i = 0; i < 4; i++) {
    assert(results[i].status === 200, `Parallel request ${i + 1} returns 200 (got ${results[i].status})`);
    assert(Array.isArray(results[i].body.data), `Parallel request ${i + 1} has data array`);
  }

  // All should return the same data (same page with same params)
  const firstPageIds = results[0].body.data.map(t => t.id).sort();
  for (let i = 1; i < 4; i++) {
    const pageIds = results[i].body.data.map(t => t.id).sort();
    assert(
      JSON.stringify(firstPageIds) === JSON.stringify(pageIds),
      `Parallel request ${i + 1} returns same data as request 1`
    );
  }
}

async function testNoDuplicateOrMissingData() {
  console.log('\n--- Step 4: No duplicate or missing data across pages ---');

  const allIds = [];
  let cursor = null;
  let pageCount = 0;
  const maxPages = 10; // Safety limit

  // Paginate through all results
  while (pageCount < maxPages) {
    const { status, body } = await fetchPage(cursor);
    if (status !== 200 || !body.data || body.data.length === 0) break;

    for (const item of body.data) {
      allIds.push(item.id);
    }

    pageCount++;
    cursor = body.pagination.nextCursor;
    if (!cursor) break;
  }

  // Check for duplicates
  const uniqueIds = new Set(allIds);
  assert(uniqueIds.size === allIds.length, `No duplicate items across ${pageCount} pages (${uniqueIds.size} unique of ${allIds.length} total)`);

  // Check that all our 8 test templates are present
  const ourIds = allIds.filter(id => createdIds.includes(id));
  assert(ourIds.length === 8, `All 8 test templates found across all pages (got ${ourIds.length})`);
}

async function testRapidForwardBackwardPagination() {
  console.log('\n--- Rapid forward pagination with different page sizes ---');

  // Test with page size 3
  const params3 = new URLSearchParams({ limit: '3', sort: 'createdAt', order: 'desc' });
  const res3 = await fetch(`${API_BASE}/templates?${params3}`, { headers: HEADERS });
  const body3 = await res3.json();
  assert(res3.ok, 'Limit=3 request succeeds');
  assert(body3.data.length === 3, `Limit=3 returns 3 items (got ${body3.data.length})`);

  // Use the cursor from page size 3 to get next page
  if (body3.pagination.nextCursor) {
    params3.set('cursor', body3.pagination.nextCursor);
    const res3b = await fetch(`${API_BASE}/templates?${params3}`, { headers: HEADERS });
    const body3b = await res3b.json();
    assert(res3b.ok, 'Limit=3 page 2 succeeds');

    // No overlap between pages
    const page1Ids = new Set(body3.data.map(t => t.id));
    const page2Ids = body3b.data.map(t => t.id);
    const overlaps = page2Ids.filter(id => page1Ids.has(id));
    assert(overlaps.length === 0, `No overlap between page 1 and page 2 (${overlaps.length} overlaps)`);
  }
}

async function testConcurrentDifferentPages() {
  console.log('\n--- Concurrent requests for different page sizes ---');

  // Fire requests with different limits simultaneously
  const [res1, res2, res3] = await Promise.all([
    fetch(`${API_BASE}/templates?limit=1&sort=createdAt&order=desc`, { headers: HEADERS }),
    fetch(`${API_BASE}/templates?limit=4&sort=createdAt&order=desc`, { headers: HEADERS }),
    fetch(`${API_BASE}/templates?limit=8&sort=createdAt&order=desc`, { headers: HEADERS }),
  ]);

  const [body1, body2, body3] = await Promise.all([res1.json(), res2.json(), res3.json()]);

  assert(res1.ok && res2.ok && res3.ok, 'All concurrent requests succeed');
  assert(body1.data.length === 1, `Limit=1 returns 1 item`);
  assert(body2.data.length === 4, `Limit=4 returns 4 items`);
  assert(body3.data.length === 8, `Limit=8 returns 8 items`);

  // The first item from limit=1 should be the same as the first item from limit=4 and limit=8
  assert(body1.data[0].id === body2.data[0].id, 'First item consistent across limit=1 and limit=4');
  assert(body1.data[0].id === body3.data[0].id, 'First item consistent across limit=1 and limit=8');

  // limit=4 results should be a subset of limit=8
  const ids4 = body2.data.map(t => t.id);
  const ids8 = body3.data.map(t => t.id);
  const allIn8 = ids4.every(id => ids8.includes(id));
  assert(allIn8, 'Limit=4 results are subset of limit=8 results');
}

(async () => {
  console.log('Feature #333: Rapid pagination requests handled');
  try {
    await setup();
    await testRapidSequentialPagination();
    await testRapidParallelPaginationNoRaceCondition();
    await testNoDuplicateOrMissingData();
    await testRapidForwardBackwardPagination();
    await testConcurrentDifferentPages();
  } finally {
    await cleanup();
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
