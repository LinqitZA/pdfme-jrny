/**
 * Feature #245: Template search filters by name
 * Verifies that template list search filters by template name substring.
 * Tests: search finds matching, excludes non-matching, clear shows all.
 */
const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');
const path = require('path');

const TOKEN = makeJwt('user-245', 'org-245', ['template:edit']);
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
      type: type || 'invoice',
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

async function setup() {
  console.log('Setting up test templates...');
  await createTemplate('Alpha Widget Invoice', 'invoice');
  await createTemplate('Beta Gadget Quote', 'quote');
  await createTemplate('Gamma Widget Statement', 'statement');
  await createTemplate('Delta Report Annual', 'invoice');
  await createTemplate('Epsilon Gadget Summary', 'quote');
  console.log(`Created ${templateIds.length} templates`);
}

async function testSearchByExactSubstring() {
  console.log('\n--- Search by exact name substring ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=Widget`, { headers: HEADERS });
  const data = await res.json();

  assert(res.status === 200, 'Search request returns 200');
  assert(data.data.length === 2, `Search "Widget" returns 2 templates (got ${data.data.length})`);

  const names = data.data.map(t => t.name);
  assert(names.some(n => n.includes('Alpha Widget')), 'Alpha Widget Invoice found');
  assert(names.some(n => n.includes('Gamma Widget')), 'Gamma Widget Statement found');
}

async function testSearchCaseInsensitive() {
  console.log('\n--- Search is case insensitive ---');

  const resLower = await fetch(`${API_BASE}/templates?orgId=org-245&search=widget`, { headers: HEADERS });
  const dataLower = await resLower.json();
  assert(dataLower.data.length === 2, `Lowercase "widget" returns 2 templates (got ${dataLower.data.length})`);

  const resUpper = await fetch(`${API_BASE}/templates?orgId=org-245&search=WIDGET`, { headers: HEADERS });
  const dataUpper = await resUpper.json();
  assert(dataUpper.data.length === 2, `Uppercase "WIDGET" returns 2 templates (got ${dataUpper.data.length})`);

  const resMixed = await fetch(`${API_BASE}/templates?orgId=org-245&search=wIdGeT`, { headers: HEADERS });
  const dataMixed = await resMixed.json();
  assert(dataMixed.data.length === 2, `Mixed case "wIdGeT" returns 2 templates (got ${dataMixed.data.length})`);
}

async function testSearchExcludesNonMatching() {
  console.log('\n--- Search excludes non-matching templates ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=Gadget`, { headers: HEADERS });
  const data = await res.json();

  assert(data.data.length === 2, `Search "Gadget" returns 2 templates (got ${data.data.length})`);
  const allGadgets = data.data.every(t => t.name.includes('Gadget'));
  assert(allGadgets, 'All returned templates contain "Gadget" in name');
  const noNonGadgets = data.data.every(t => !t.name.includes('Widget') && !t.name.includes('Report'));
  assert(noNonGadgets, 'No non-Gadget templates returned');
}

async function testSearchNoResults() {
  console.log('\n--- Search with no results ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=ZzzNonExistent`, { headers: HEADERS });
  const data = await res.json();

  assert(res.status === 200, 'Empty search still returns 200');
  assert(data.data.length === 0, `Search "ZzzNonExistent" returns 0 templates (got ${data.data.length})`);
  assert(data.pagination.total === 0, `Total is 0 for no-match search (got ${data.pagination.total})`);
}

async function testClearSearchShowsAll() {
  console.log('\n--- Clear search shows all templates ---');

  // First search (narrowed)
  const resSearch = await fetch(`${API_BASE}/templates?orgId=org-245&search=Widget`, { headers: HEADERS });
  const dataSearch = await resSearch.json();
  assert(dataSearch.data.length === 2, 'Narrowed search has 2 results');

  // Clear search (empty search param or no param)
  const resAll = await fetch(`${API_BASE}/templates?orgId=org-245`, { headers: HEADERS });
  const dataAll = await resAll.json();

  assert(dataAll.data.length >= 5, `All templates returned after clearing search (got ${dataAll.data.length})`);
  assert(dataAll.pagination.total >= 5, `Total count includes all templates (got ${dataAll.pagination.total})`);
}

async function testSearchWithTypeFilter() {
  console.log('\n--- Search combined with type filter ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=Gadget&type=quote`, { headers: HEADERS });
  const data = await res.json();

  assert(data.data.length === 2, `Search "Gadget" + type "quote" returns 2 templates (got ${data.data.length})`);
  const allQuotes = data.data.every(t => t.type === 'quote');
  assert(allQuotes, 'All returned templates are quotes');
  const allGadgets = data.data.every(t => t.name.includes('Gadget'));
  assert(allGadgets, 'All returned templates have "Gadget" in name');

  // Search for Widget in quotes (should be 0)
  const resNoMatch = await fetch(`${API_BASE}/templates?orgId=org-245&search=Widget&type=quote`, { headers: HEADERS });
  const dataNoMatch = await resNoMatch.json();
  assert(dataNoMatch.data.length === 0, `Search "Widget" + type "quote" returns 0 (got ${dataNoMatch.data.length})`);
}

async function testSearchPagination() {
  console.log('\n--- Search results are paginated ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=a&limit=2`, { headers: HEADERS });
  const data = await res.json();

  assert(res.status === 200, 'Paginated search request succeeds');
  assert(data.data.length <= 2, `Search with limit=2 returns at most 2 (got ${data.data.length})`);
  assert(data.pagination !== undefined, 'Pagination info included in search results');
  assert(typeof data.pagination.total === 'number', 'Total count in search pagination');
}

async function testSearchPartialName() {
  console.log('\n--- Search by partial name ---');

  // Search for "Alph" should find "Alpha Widget Invoice"
  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=Alph`, { headers: HEADERS });
  const data = await res.json();

  assert(data.data.length >= 1, `Partial "Alph" finds at least 1 template (got ${data.data.length})`);
  assert(data.data.some(t => t.name.includes('Alpha')), 'Found template with "Alpha" in name');

  // Search for "Annual"
  const res2 = await fetch(`${API_BASE}/templates?orgId=org-245&search=Annual`, { headers: HEADERS });
  const data2 = await res2.json();

  assert(data2.data.length === 1, `Search "Annual" returns 1 template (got ${data2.data.length})`);
  assert(data2.data[0].name.includes('Annual'), 'Found Delta Report Annual');
}

async function testEmptySearchReturnAll() {
  console.log('\n--- Empty search string returns all ---');

  const resEmpty = await fetch(`${API_BASE}/templates?orgId=org-245&search=`, { headers: HEADERS });
  const dataEmpty = await resEmpty.json();

  const resNone = await fetch(`${API_BASE}/templates?orgId=org-245`, { headers: HEADERS });
  const dataNone = await resNone.json();

  assert(dataEmpty.pagination.total === dataNone.pagination.total, `Empty search total (${dataEmpty.pagination.total}) equals no-search total (${dataNone.pagination.total})`);
}

async function testWhitespaceSearch() {
  console.log('\n--- Whitespace-only search treated as empty ---');

  const res = await fetch(`${API_BASE}/templates?orgId=org-245&search=%20%20`, { headers: HEADERS });
  const data = await res.json();

  const resAll = await fetch(`${API_BASE}/templates?orgId=org-245`, { headers: HEADERS });
  const dataAll = await resAll.json();

  assert(data.pagination.total === dataAll.pagination.total, `Whitespace search total (${data.pagination.total}) equals all total (${dataAll.pagination.total})`);
}

async function testSourceCodeSearchImplementation() {
  console.log('\n--- Source code implements search correctly ---');

  const templateListPath = path.resolve(__dirname, '../apps/designer-sandbox/components/TemplateList.tsx');
  const source = fs.readFileSync(templateListPath, 'utf8');

  // Check search input exists
  assert(source.includes('search-input'), 'Search input with data-testid exists');
  assert(source.includes('searchQuery'), 'searchQuery state exists');
  assert(source.includes('setSearchQuery'), 'setSearchQuery setter exists');

  // Check handleSearchChange resets cursor
  assert(source.includes('handleSearchChange'), 'handleSearchChange function exists');

  // Check search param sent to API
  assert(source.includes("params.set('search'"), 'Search param sent to API');

  // Check cursor reset on search
  const handleSearchMatch = source.match(/handleSearchChange[^}]*\{([^}]*)\}/s);
  if (handleSearchMatch) {
    assert(handleSearchMatch[1].includes('setCursor(null)'), 'handleSearchChange resets cursor');
    assert(handleSearchMatch[1].includes('setSearchQuery'), 'handleSearchChange updates search query');
  }

  // Check backend has ilike search
  const servicePath = path.resolve(__dirname, '../nest-module/src/template.service.ts');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  assert(serviceSource.includes('ilike') && serviceSource.includes('search'), 'Backend uses ilike for name search');
}

async function run() {
  try {
    await setup();
    await testSearchByExactSubstring();
    await testSearchCaseInsensitive();
    await testSearchExcludesNonMatching();
    await testSearchNoResults();
    await testClearSearchShowsAll();
    await testSearchWithTypeFilter();
    await testSearchPagination();
    await testSearchPartialName();
    await testEmptySearchReturnAll();
    await testWhitespaceSearch();
    await testSourceCodeSearchImplementation();
    await cleanup();
  } catch (e) {
    console.error('Test error:', e);
    failed++;
    await cleanup();
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Feature #245: Template search filters by name`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
