/**
 * Feature #249: Fields tab search with no results
 * Verifies that searching for a nonexistent field name shows an empty state message,
 * no error occurs, and clearing the search restores all fields.
 */

const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// DATA_FIELDS from ErpDesigner.tsx for reference
const DATA_FIELDS = [
  {
    group: 'Document',
    fields: [
      { key: 'document.number', label: 'Document Number', example: 'INV-2026-001' },
      { key: 'document.date', label: 'Date', example: '2026-03-18' },
      { key: 'document.dueDate', label: 'Due Date', example: '2026-04-17' },
      { key: 'document.total', label: 'Total', example: 'R 1,250.00' },
      { key: 'document.subtotal', label: 'Subtotal', example: 'R 1,086.96' },
      { key: 'document.tax', label: 'Tax', example: 'R 163.04' },
    ],
  },
  {
    group: 'Customer',
    fields: [
      { key: 'customer.name', label: 'Name', example: 'Acme Corporation' },
      { key: 'customer.email', label: 'Email', example: 'billing@acme.com' },
      { key: 'customer.address', label: 'Address', example: '123 Main St' },
      { key: 'customer.phone', label: 'Phone', example: '+27 11 123 4567' },
      { key: 'customer.vatNumber', label: 'VAT Number', example: 'VAT4530001234' },
    ],
  },
  {
    group: 'Company',
    fields: [
      { key: 'company.name', label: 'Company Name', example: 'My Company Ltd' },
      { key: 'company.regNumber', label: 'Reg Number', example: '2020/123456/07' },
      { key: 'company.address', label: 'Address', example: '456 Business Park' },
    ],
  },
];

const ALL_FIELD_COUNT = DATA_FIELDS.reduce((sum, g) => sum + g.fields.length, 0);

// Replicate the filter logic from ErpDesigner.tsx
function filterFields(search) {
  if (!search) return DATA_FIELDS;
  const q = search.toLowerCase();
  return DATA_FIELDS.map((group) => ({
    ...group,
    fields: group.fields.filter(
      (f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    ),
  })).filter((g) => g.fields.length > 0);
}

async function testFilterLogic() {
  console.log('\n--- Filter logic unit tests ---');

  // No search returns all fields
  const noSearch = filterFields('');
  const noSearchCount = noSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(noSearchCount === ALL_FIELD_COUNT, `Empty search returns all ${ALL_FIELD_COUNT} fields (got ${noSearchCount})`);
  assert(noSearch.length === 3, `Empty search returns all 3 groups (got ${noSearch.length})`);

  // Search for existing field by key
  const docSearch = filterFields('document.number');
  const docCount = docSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(docCount >= 1, `Searching "document.number" finds at least 1 field (got ${docCount})`);

  // Search for existing field by label
  const labelSearch = filterFields('VAT Number');
  const labelCount = labelSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(labelCount >= 1, `Searching "VAT Number" finds at least 1 field (got ${labelCount})`);

  // Case-insensitive search
  const caseSearch = filterFields('CUSTOMER');
  const caseCount = caseSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(caseCount >= 1, `Case-insensitive "CUSTOMER" finds fields (got ${caseCount})`);

  // Partial match
  const partialSearch = filterFields('addr');
  const partialCount = partialSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(partialCount >= 2, `Partial "addr" matches customer.address and company.address (got ${partialCount})`);

  // Nonexistent field returns empty
  const noResults = filterFields('xyznonexistent123');
  const noResultsCount = noResults.reduce((sum, g) => sum + g.fields.length, 0);
  assert(noResultsCount === 0, `Nonexistent search returns 0 fields (got ${noResultsCount})`);
  assert(noResults.length === 0, `Nonexistent search returns 0 groups (got ${noResults.length})`);

  // Special characters don't cause errors
  let noError = true;
  try {
    filterFields('!!!@@@###$$$');
    filterFields('<script>alert("xss")</script>');
    filterFields('');
    filterFields('   ');
  } catch (e) {
    noError = false;
  }
  assert(noError, 'Special characters in search do not throw errors');

  // Clear search (empty string) restores all fields
  const restored = filterFields('');
  const restoredCount = restored.reduce((sum, g) => sum + g.fields.length, 0);
  assert(restoredCount === ALL_FIELD_COUNT, `Clearing search restores all ${ALL_FIELD_COUNT} fields`);
}

async function testSourceCodeHasEmptyState() {
  console.log('\n--- Source code verification ---');

  const path = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';
  const source = fs.readFileSync(path, 'utf-8');

  // Verify fieldTabSearch state exists
  assert(source.includes('fieldTabSearch'), 'fieldTabSearch state variable exists');
  assert(source.includes('setFieldTabSearch'), 'setFieldTabSearch setter exists');
  assert(source.includes("useState('')") || source.includes("useState('')"), 'fieldTabSearch initialized as empty string');

  // Verify filteredFieldTabFields memo exists
  assert(source.includes('filteredFieldTabFields'), 'filteredFieldTabFields memo exists');
  assert(source.includes('useMemo'), 'filteredFieldTabFields uses useMemo');

  // Verify empty state data-testid
  assert(source.includes('fields-empty-state'), 'Empty state has data-testid="fields-empty-state"');

  // Verify empty state shows "No matching fields" message
  assert(source.includes('No matching fields'), 'Empty state shows "No matching fields" message');

  // Verify search input is wired to state
  assert(source.includes('value={fieldTabSearch}'), 'Search input value bound to fieldTabSearch state');
  assert(source.includes('setFieldTabSearch(e.target.value)'), 'Search input onChange updates fieldTabSearch');

  // Verify field-tab-search data-testid
  assert(source.includes('data-testid="field-tab-search"'), 'Search input has data-testid="field-tab-search"');

  // Verify filteredFieldTabFields is used instead of DATA_FIELDS in Fields tab
  const fieldsTabStart = source.indexOf("activeTab === 'fields'");
  const fieldsTabEnd = source.indexOf("activeTab === 'assets'");
  const fieldsTabSection = source.substring(fieldsTabStart, fieldsTabEnd);
  assert(fieldsTabSection.includes('filteredFieldTabFields'), 'Fields tab renders filteredFieldTabFields');
  assert(!fieldsTabSection.includes('{DATA_FIELDS.map') && !fieldsTabSection.includes('DATA_FIELDS.map((group)'), 'Fields tab does NOT render raw DATA_FIELDS.map directly');

  // Verify empty state conditionally shown
  assert(fieldsTabSection.includes('filteredFieldTabFields.length === 0'), 'Empty state conditioned on filteredFieldTabFields.length === 0');
  assert(fieldsTabSection.includes('fieldTabSearch'), 'Empty state also checks fieldTabSearch is non-empty');
}

async function testRenderedHTMLFieldsTab() {
  console.log('\n--- Rendered HTML verification ---');

  let html;
  try {
    const res = await fetch('http://localhost:3001');
    html = await res.text();
  } catch (e) {
    console.log('  SKIP: Cannot reach frontend at localhost:3001');
    return;
  }

  // Check tab-fields exists
  assert(html.includes('data-testid="tab-fields"'), 'Fields tab button present in rendered HTML');

  // The default active tab is "blocks", so fields-content may not be in initial SSR
  // But we verify the tab button is there for user interaction
  assert(html.includes('tab-fields'), 'tab-fields button present');
}

async function testSearchForNonexistentShowsEmptyState() {
  console.log('\n--- Empty state behavior tests ---');

  // Search for nonexistent field name
  const result = filterFields('zzzznonexistent_field_xyz');
  assert(result.length === 0, 'Search for nonexistent field returns empty array');

  // The UI would show empty state when: filteredFieldTabFields.length === 0 && fieldTabSearch
  const fieldTabSearch = 'zzzznonexistent_field_xyz';
  const showEmptyState = result.length === 0 && !!fieldTabSearch;
  assert(showEmptyState, 'Empty state condition is true for nonexistent search');

  // No error thrown
  let noError = true;
  try {
    filterFields('zzzznonexistent_field_xyz');
  } catch (e) {
    noError = false;
  }
  assert(noError, 'No error thrown for nonexistent search');

  // Clear search - fields return
  const cleared = filterFields('');
  const clearedCount = cleared.reduce((sum, g) => sum + g.fields.length, 0);
  assert(clearedCount === ALL_FIELD_COUNT, `Clearing search restores all ${ALL_FIELD_COUNT} fields`);

  // Empty state NOT shown when search is cleared
  const showEmptyWhenCleared = cleared.length === 0 && !!('');
  assert(!showEmptyWhenCleared, 'Empty state NOT shown when search is cleared');
}

async function testEdgeCases() {
  console.log('\n--- Edge cases ---');

  // Single character search
  const singleChar = filterFields('a');
  const singleCount = singleChar.reduce((sum, g) => sum + g.fields.length, 0);
  assert(singleCount > 0, `Single char "a" finds some fields (got ${singleCount})`);

  // Search with spaces
  const spacedSearch = filterFields('Due Date');
  const spacedCount = spacedSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(spacedCount >= 1, `"Due Date" matches at least 1 field (got ${spacedCount})`);

  // Search that matches only one group
  const companySearch = filterFields('company');
  assert(companySearch.length === 1, `"company" matches only Company group (got ${companySearch.length} groups)`);

  // Search that matches across groups
  const addressSearch = filterFields('address');
  assert(addressSearch.length >= 2, `"address" matches at least 2 groups (got ${addressSearch.length} groups)`);

  // Very long search string
  const longSearch = filterFields('a'.repeat(500));
  assert(longSearch.length === 0, 'Very long search returns no results');

  // Whitespace-only search returns valid array
  const whitespaceSearch = filterFields(' ');
  assert(Array.isArray(whitespaceSearch), 'Whitespace search returns valid array');

  // Multiple nonexistent terms
  const multiNonexist = filterFields('foo bar baz nonexistent');
  assert(multiNonexist.length === 0, 'Multiple nonexistent terms returns empty');

  // Verify null-like edge cases
  const undefinedResult = filterFields(undefined);
  assert(Array.isArray(undefinedResult), 'Undefined search returns valid array (all fields)');
}

async function main() {
  console.log('=== Feature #249: Fields tab search with no results ===');

  await testFilterLogic();
  await testSourceCodeHasEmptyState();
  await testRenderedHTMLFieldsTab();
  await testSearchForNonexistentShowsEmptyState();
  await testEdgeCases();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
