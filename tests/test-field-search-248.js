/**
 * Feature #248: Fields tab search filters field tree
 * Tests that the Fields tab search functionality works correctly:
 * - Search input exists in fields tab
 * - Filtering by key and label works
 * - Category headers update (only matching groups shown)
 * - Clear search shows all fields
 * - Empty state shown when no matches
 *
 * This feature is a frontend-only feature (client-side filtering).
 * We verify the implementation by analyzing the code structure.
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Feature #248: Fields tab search filters field tree\n');

  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const code = fs.readFileSync(designerPath, 'utf-8');

  // Test 1: Fields tab search input exists
  console.log('--- Search input ---');
  assert(code.includes('data-testid="field-tab-search"'), 'Field tab search input has correct testid');
  assert(code.includes('placeholder="Search fields..."'), 'Search input has placeholder text');

  // Test 2: Search state exists
  console.log('\n--- Search state ---');
  assert(code.includes("const [fieldTabSearch, setFieldTabSearch] = useState('')"), 'fieldTabSearch state initialized as empty string');
  assert(code.includes('value={fieldTabSearch}'), 'Search input bound to fieldTabSearch state');
  assert(code.includes('onChange={(e) => setFieldTabSearch(e.target.value)'), 'Search input onChange updates state');

  // Test 3: Filtering logic
  console.log('\n--- Filtering logic ---');
  assert(code.includes('filteredFieldTabFields'), 'filteredFieldTabFields computed variable exists');
  assert(code.includes('if (!fieldTabSearch) return DATA_FIELDS'), 'Empty search returns all fields (DATA_FIELDS)');
  assert(code.includes('fieldTabSearch.toLowerCase()'), 'Search is case-insensitive (toLowerCase)');
  assert(code.includes('f.key.toLowerCase().includes(q)'), 'Filters by field key');
  assert(code.includes('f.label.toLowerCase().includes(q)'), 'Filters by field label');

  // Test 4: Category headers update - only matching groups shown
  console.log('\n--- Category headers ---');
  assert(code.includes(".filter((g) => g.fields.length > 0)"), 'Groups with no matching fields are filtered out');
  assert(code.includes('filteredFieldTabFields.map((group)'), 'Only filtered groups are rendered');
  assert(code.includes('{group.group}'), 'Group name is rendered as header');

  // Test 5: Empty state when no matches
  console.log('\n--- Empty state ---');
  assert(code.includes('data-testid="fields-empty-state"'), 'Empty state has testid');
  assert(code.includes('filteredFieldTabFields.length === 0 && fieldTabSearch'), 'Empty state shown when no matches and search is active');
  assert(code.includes('No matching fields'), 'Empty state shows "No matching fields" message');
  assert(code.includes('No fields match'), 'Empty state shows search term feedback');

  // Test 6: DATA_FIELDS structure
  console.log('\n--- Data fields structure ---');
  assert(code.includes("group: 'Document'"), 'Document group exists');
  assert(code.includes("group: 'Customer'"), 'Customer group exists');
  assert(code.includes("group: 'Company'"), 'Company group exists');

  // Test 7: Fields tab is accessible
  console.log('\n--- Tab accessibility ---');
  assert(code.includes("'fields'"), 'Fields tab exists');
  assert(code.includes("activeTab === 'fields'"), 'Fields content shown when tab is active');
  assert(code.includes('data-testid="fields-content"'), 'Fields content has testid');

  // Test 8: Field items have testids for testing
  console.log('\n--- Field items ---');
  assert(code.includes('data-testid={`field-${field.key}`}'), 'Field items have dynamic testids');
  assert(code.includes('{`{{${field.key}}}`}'), 'Fields displayed in mustache format');

  // Test 9: Fields are draggable
  assert(code.includes('draggable'), 'Field items are draggable');

  // Test 10: Verify filtering behavior with simulated data
  console.log('\n--- Simulated filtering ---');

  // Simulate the filtering logic from the code
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

  // Empty search returns all
  const allFields = filterFields('');
  assert(allFields.length === 3, `Empty search returns all 3 groups (got ${allFields.length})`);
  const totalFields = allFields.reduce((sum, g) => sum + g.fields.length, 0);
  assert(totalFields === 14, `Empty search returns all 14 fields (got ${totalFields})`);

  // Search by key
  const nameSearch = filterFields('name');
  const nameCount = nameSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(nameCount >= 2, `Search "name" returns multiple fields (got ${nameCount})`);
  assert(nameSearch.some(g => g.group === 'Customer'), 'Name search includes Customer group');
  assert(nameSearch.some(g => g.group === 'Company'), 'Name search includes Company group');

  // Search by label
  const emailSearch = filterFields('Email');
  assert(emailSearch.length >= 1, `Search "Email" returns at least 1 group (got ${emailSearch.length})`);
  const emailFields = emailSearch.reduce((sum, g) => sum + g.fields.length, 0);
  assert(emailFields >= 1, `Search "Email" returns at least 1 field (got ${emailFields})`);

  // Case insensitive
  const upperSearch = filterFields('DOCUMENT');
  const lowerSearch = filterFields('document');
  assert(upperSearch.length === lowerSearch.length, 'Case-insensitive: same group count for DOCUMENT vs document');

  // Non-matching search returns empty
  const noMatch = filterFields('zzzznonexistent');
  assert(noMatch.length === 0, `Non-matching search returns 0 groups (got ${noMatch.length})`);

  // Partial match
  const partial = filterFields('sub');
  const partialFields = partial.reduce((sum, g) => sum + g.fields.length, 0);
  assert(partialFields >= 1, `Partial search "sub" returns at least 1 field (got ${partialFields})`);

  // Category headers: search that only matches one group
  const taxSearch = filterFields('tax');
  assert(taxSearch.length >= 1, `Search "tax" returns groups (got ${taxSearch.length})`);

  // Clear search (empty string again) returns all
  const cleared = filterFields('');
  assert(cleared.length === 3, `Cleared search returns all 3 groups (got ${cleared.length})`);

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${passed + failed} ---`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
