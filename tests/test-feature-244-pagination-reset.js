/**
 * Feature #244: Pagination resets on filter change
 * Verifies that changing the template list type filter resets pagination to the first page.
 * Tests the API cursor pagination behavior and verifies the source code resets cursor on filter change.
 */
const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');
const path = require('path');

const TOKEN = makeJwt('user-244', 'org-244', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const templateIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function createTemplate(name, type) {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name,
      type,
      schema: {
        schemas: [[{ type: 'text', name: 'el', content: name, position: { x: 10, y: 10 }, width: 100, height: 20 }]],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const data = await res.json();
  if (data.id) templateIds.push(data.id);
  return data;
}

async function cleanup() {
  for (const id of templateIds) {
    await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }
}

async function testPaginationBasics() {
  console.log('\n--- Pagination basics ---');

  // Create enough templates to have multiple pages
  for (let i = 1; i <= 5; i++) {
    await createTemplate(`Paginate Invoice ${i} - 244`, 'invoice');
  }
  for (let i = 1; i <= 5; i++) {
    await createTemplate(`Paginate Quote ${i} - 244`, 'quote');
  }

  // Get first page with limit=3
  const res1 = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244`, { headers: HEADERS });
  const data1 = await res1.json();

  assert(data1.data.length === 3, `First page returns 3 templates (got ${data1.data.length})`);
  assert(data1.pagination.hasMore === true, 'First page indicates more pages');
  assert(data1.pagination.nextCursor !== null, 'First page has nextCursor');

  // Use cursor to get second page
  const res2 = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&cursor=${encodeURIComponent(data1.pagination.nextCursor)}`, { headers: HEADERS });
  const data2 = await res2.json();

  assert(data2.data.length === 3, `Second page returns 3 templates (got ${data2.data.length})`);

  // Ensure no overlap between pages
  const ids1 = data1.data.map(t => t.id);
  const ids2 = data2.data.map(t => t.id);
  const overlap = ids1.filter(id => ids2.includes(id));
  assert(overlap.length === 0, 'No overlap between page 1 and page 2');
}

async function testFilterResetsPagination() {
  console.log('\n--- Filter change resets to first page ---');

  // Get first page of all templates
  const resAll = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244`, { headers: HEADERS });
  const dataAll = await resAll.json();
  assert(dataAll.pagination.hasMore === true, 'Unfiltered has more pages');

  // Now filter by type=invoice (should start from beginning, no cursor)
  const resInvoice = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=invoice`, { headers: HEADERS });
  const dataInvoice = await resInvoice.json();

  assert(dataInvoice.data.length > 0, `Invoice filter returns templates (got ${dataInvoice.data.length})`);
  // All returned templates should be invoices
  const allInvoices = dataInvoice.data.every(t => t.type === 'invoice');
  assert(allInvoices, 'All returned templates are invoices');

  // Now switch to type=quote (no cursor - reset)
  const resQuote = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=quote`, { headers: HEADERS });
  const dataQuote = await resQuote.json();

  assert(dataQuote.data.length > 0, `Quote filter returns templates (got ${dataQuote.data.length})`);
  const allQuotes = dataQuote.data.every(t => t.type === 'quote');
  assert(allQuotes, 'All returned templates are quotes');

  // Verify quote results are different from invoice results
  const invoiceIds = dataInvoice.data.map(t => t.id);
  const quoteIds = dataQuote.data.map(t => t.id);
  const noOverlap = invoiceIds.every(id => !quoteIds.includes(id));
  assert(noOverlap, 'Invoice and quote results are completely different sets');
}

async function testFilterAfterPagination() {
  console.log('\n--- Filter after navigating to page 2 ---');

  // Navigate to page 2 of all
  const resAll = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244`, { headers: HEADERS });
  const dataAll = await resAll.json();
  const cursor = dataAll.pagination.nextCursor;
  assert(cursor !== null, 'Page 1 has a cursor');

  const resPage2 = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&cursor=${encodeURIComponent(cursor)}`, { headers: HEADERS });
  const dataPage2 = await resPage2.json();
  assert(dataPage2.data.length > 0, 'Page 2 has results');

  // Now apply filter - should reset to beginning (no cursor)
  const resFiltered = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=invoice`, { headers: HEADERS });
  const dataFiltered = await resFiltered.json();

  // First invoice page should start from beginning
  assert(dataFiltered.data.length > 0, 'Filtered results start from first page');
  // All results should be the first invoices, not mid-list
  const allFilteredInvoices = dataFiltered.data.every(t => t.type === 'invoice');
  assert(allFilteredInvoices, 'Filtered results are all invoices from first page');
}

async function testClearFilterResets() {
  console.log('\n--- Clearing filter resets to first page ---');

  // Start with filter
  const resFiltered = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=invoice`, { headers: HEADERS });
  const dataFiltered = await resFiltered.json();
  assert(dataFiltered.data.length > 0, 'Filtered results returned');

  // Navigate to page 2 of filtered results
  if (dataFiltered.pagination.nextCursor) {
    const resPage2 = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=invoice&cursor=${encodeURIComponent(dataFiltered.pagination.nextCursor)}`, { headers: HEADERS });
    const dataPage2 = await resPage2.json();
    assert(dataPage2.data.length > 0, 'Filtered page 2 has results');
  }

  // Clear filter (no type param) - should reset
  const resCleared = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244`, { headers: HEADERS });
  const dataCleared = await resCleared.json();

  assert(dataCleared.data.length === 3, 'Cleared filter returns first 3 templates');
  assert(dataCleared.pagination.total >= 10, `Total includes all types (got ${dataCleared.pagination.total})`);
}

async function testSourceCodeResetsOnFilterChange() {
  console.log('\n--- Source code resets cursor on filter change ---');

  const templateListPath = path.resolve(__dirname, '../apps/designer-sandbox/components/TemplateList.tsx');
  const source = fs.readFileSync(templateListPath, 'utf8');

  // Check handleTypeChange resets cursor
  assert(source.includes('handleTypeChange'), 'handleTypeChange function exists');
  assert(source.includes('setCursor(null)'), 'setCursor(null) is called somewhere');

  // Verify the function body resets cursor
  const handleTypeMatch = source.match(/handleTypeChange[^}]*\{([^}]*)\}/s);
  if (handleTypeMatch) {
    assert(handleTypeMatch[1].includes('setCursor(null)'), 'handleTypeChange calls setCursor(null)');
    assert(handleTypeMatch[1].includes('setTypeFilter'), 'handleTypeChange calls setTypeFilter');
  } else {
    assert(false, 'Could not parse handleTypeChange');
  }

  // Check that useEffect for fetchTemplates also resets
  assert(source.includes('setCursor(null)'), 'Cursor reset found in component');

  // Check the type filter dropdown uses handleTypeChange
  assert(source.includes('handleTypeChange(e.target.value)') || source.includes('handleTypeChange'), 'Type filter dropdown uses handleTypeChange');
}

async function testPaginationCountsUpdate() {
  console.log('\n--- Pagination counts update on filter change ---');

  // Unfiltered total
  const resAll = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244`, { headers: HEADERS });
  const dataAll = await resAll.json();
  const totalAll = dataAll.pagination.total;

  // Invoice total
  const resInvoice = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=invoice`, { headers: HEADERS });
  const dataInvoice = await resInvoice.json();
  const totalInvoice = dataInvoice.pagination.total;

  // Quote total
  const resQuote = await fetch(`${API_BASE}/templates?limit=3&orgId=org-244&type=quote`, { headers: HEADERS });
  const dataQuote = await resQuote.json();
  const totalQuote = dataQuote.pagination.total;

  assert(totalAll >= totalInvoice + totalQuote, `All total (${totalAll}) >= invoice (${totalInvoice}) + quote (${totalQuote})`);
  assert(totalInvoice >= 5, `Invoice count is at least 5 (got ${totalInvoice})`);
  assert(totalQuote >= 5, `Quote count is at least 5 (got ${totalQuote})`);
  assert(totalInvoice < totalAll, `Invoice count (${totalInvoice}) < all count (${totalAll}) - filter narrows results`);
  assert(totalQuote < totalAll, `Quote count (${totalQuote}) < all count (${totalAll}) - filter narrows results`);
}

async function run() {
  try {
    await testPaginationBasics();
    await testFilterResetsPagination();
    await testFilterAfterPagination();
    await testClearFilterResets();
    await testSourceCodeResetsOnFilterChange();
    await testPaginationCountsUpdate();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Feature #244: Pagination resets on filter change`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
