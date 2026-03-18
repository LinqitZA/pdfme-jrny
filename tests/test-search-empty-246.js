/**
 * Feature #246: Template search handles empty query
 * Empty search returns all templates, search filters correctly, clearing returns all.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-search-246', 'org-search-246', ['admin']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function createTemplate(name, type) {
  const { status, data } = await api('POST', '/templates', {
    name, type: type || 'custom', schema: { fields: [] }, createdBy: 'user-search-246', orgId: 'org-search-246'
  });
  if (status === 201 && data.id) createdIds.push(data.id);
  return data;
}

async function cleanup() {
  for (const id of createdIds) {
    await api('DELETE', `/templates/${id}`);
  }
}

async function run() {
  console.log('Feature #246: Template search handles empty query\n');

  // Setup: create test templates with distinct names
  const t1 = await createTemplate('Alpha Invoice Report', 'invoice');
  const t2 = await createTemplate('Beta Statement Doc', 'statement');
  const t3 = await createTemplate('Gamma Invoice Summary', 'invoice');
  const t4 = await createTemplate('Delta Credit Note', 'credit_note');

  assert(t1.id && t2.id && t3.id && t4.id, 'Created 4 test templates');

  // Test 1: Empty search query returns all templates (no search param)
  console.log('\n--- Empty search (no param) ---');
  const { data: noParam } = await api('GET', '/templates?orgId=org-search-246');
  assert(noParam.data.length >= 4, `No search param returns all templates (got ${noParam.data.length})`);

  // Test 2: Empty string search returns all templates
  console.log('\n--- Empty string search ---');
  const { data: emptyStr } = await api('GET', '/templates?orgId=org-search-246&search=');
  assert(emptyStr.data.length >= 4, `Empty string search returns all templates (got ${emptyStr.data.length})`);

  // Test 3: Whitespace-only search returns all templates
  console.log('\n--- Whitespace-only search ---');
  const { data: whitespace } = await api('GET', '/templates?orgId=org-search-246&search=%20%20%20');
  assert(whitespace.data.length >= 4, `Whitespace search returns all templates (got ${whitespace.data.length})`);

  // Test 4: Search with a specific term filters correctly
  console.log('\n--- Search for "Invoice" ---');
  const { data: invoiceSearch } = await api('GET', '/templates?orgId=org-search-246&search=Invoice');
  const invoiceNames = invoiceSearch.data.map(t => t.name);
  assert(invoiceSearch.data.length >= 2, `Search "Invoice" returns at least 2 results (got ${invoiceSearch.data.length})`);
  assert(invoiceNames.some(n => n.includes('Alpha')), 'Search results include Alpha Invoice Report');
  assert(invoiceNames.some(n => n.includes('Gamma')), 'Search results include Gamma Invoice Summary');

  // Test 5: Search is case-insensitive
  console.log('\n--- Case-insensitive search ---');
  const { data: lowerSearch } = await api('GET', '/templates?orgId=org-search-246&search=invoice');
  assert(lowerSearch.data.length >= 2, `Lowercase "invoice" search returns same results (got ${lowerSearch.data.length})`);
  const { data: upperSearch } = await api('GET', '/templates?orgId=org-search-246&search=INVOICE');
  assert(upperSearch.data.length >= 2, `Uppercase "INVOICE" search returns same results (got ${upperSearch.data.length})`);

  // Test 6: Search for non-matching term returns empty
  console.log('\n--- Non-matching search ---');
  const { data: noMatch } = await api('GET', '/templates?orgId=org-search-246&search=ZZZnonexistentXXX');
  assert(noMatch.data.length === 0, `Non-matching search returns 0 results (got ${noMatch.data.length})`);

  // Test 7: No error on empty search
  console.log('\n--- No error on empty search ---');
  const emptyResult = await api('GET', '/templates?orgId=org-search-246&search=');
  assert(emptyResult.status === 200, `Empty search returns 200 (got ${emptyResult.status})`);

  // Test 8: Search with partial name
  console.log('\n--- Partial name search ---');
  const { data: partial } = await api('GET', '/templates?orgId=org-search-246&search=Alph');
  assert(partial.data.length >= 1, `Partial "Alph" matches (got ${partial.data.length})`);
  assert(partial.data.some(t => t.name.includes('Alpha')), 'Partial search finds Alpha template');

  // Test 9: Clear search (empty again) returns all
  console.log('\n--- Clear search returns all ---');
  const { data: cleared } = await api('GET', '/templates?orgId=org-search-246');
  assert(cleared.data.length >= 4, `Cleared search returns all templates (got ${cleared.data.length})`);
  assert(cleared.pagination.total >= 4, `Total count is correct after clearing search`);

  // Test 10: Search combined with type filter
  console.log('\n--- Search + type filter ---');
  const { data: combined } = await api('GET', '/templates?orgId=org-search-246&search=Invoice&type=invoice');
  assert(combined.data.length >= 2, `Search "Invoice" + type "invoice" returns matches (got ${combined.data.length})`);

  // Test 11: Search term not in type-filtered results
  const { data: noCombo } = await api('GET', '/templates?orgId=org-search-246&search=Statement&type=invoice');
  assert(noCombo.data.length === 0, `Search "Statement" + type "invoice" returns 0 results`);

  // Test 12: Pagination total reflects search filter
  console.log('\n--- Pagination total with search ---');
  const { data: pagSearch } = await api('GET', '/templates?orgId=org-search-246&search=Invoice');
  assert(pagSearch.pagination.total >= 2, `Pagination total reflects search filter (got ${pagSearch.pagination.total})`);

  // Test 13: Search for single unique template
  console.log('\n--- Unique template search ---');
  const { data: unique } = await api('GET', '/templates?orgId=org-search-246&search=Delta Credit');
  assert(unique.data.length >= 1, `Search "Delta Credit" finds template (got ${unique.data.length})`);
  assert(unique.data.some(t => t.name === 'Delta Credit Note'), 'Found exact Delta Credit Note');

  // Cleanup
  await cleanup();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${passed + failed} ---`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
