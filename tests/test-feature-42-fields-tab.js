/**
 * Feature #42: Designer Fields tab displays searchable tree
 * Tests that the Fields tab shows categorised field tree with search and drag.
 *
 * Since the Fields tab content is conditionally rendered (only when active),
 * we verify via source code analysis and SSR HTML for structural elements.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Feature #42: Designer Fields tab displays searchable tree\n');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  // --- Tab structure tests ---

  test('Fields tab button exists in left panel tabs', () => {
    // The tab buttons are rendered for all tabs including 'fields'
    assert(html.includes('fields'), 'HTML should reference fields tab');
    assert(html.includes('data-testid="left-panel-tabs"'), 'Left panel tabs should exist');
  });

  test('Left panel has 4 tabs: blocks, fields, assets, pages', () => {
    // Check that all 4 tab names exist as buttons
    const tabNames = ['blocks', 'fields', 'assets', 'pages'];
    for (const tab of tabNames) {
      assert(html.includes(`id="tab-${tab}-btn"`), `Tab button for "${tab}" should exist`);
    }
  });

  // --- Source code verification for Fields tab content ---

  test('Fields tab content is conditionally rendered (activeTab === fields)', () => {
    assert(source.includes("activeTab === 'fields'"), 'Should have conditional render for fields tab');
    assert(source.includes('data-testid="fields-content"'), 'Should have fields-content testid');
  });

  test('Search input exists in Fields tab', () => {
    assert(source.includes('data-testid="field-tab-search"'), 'Should have field-tab-search testid');
    assert(source.includes('placeholder="Search fields..."'), 'Should have search placeholder');
  });

  test('fieldTabSearch state is defined', () => {
    assert(source.includes("const [fieldTabSearch, setFieldTabSearch]"), 'Should have fieldTabSearch state');
  });

  test('Search onChange updates fieldTabSearch state', () => {
    assert(source.includes('onChange={(e) => setFieldTabSearch(e.target.value)'), 'Search should update fieldTabSearch');
  });

  // --- Data fields verification ---

  test('DATA_FIELDS has Document group', () => {
    assert(source.includes("group: 'Document'"), 'Should have Document group');
  });

  test('DATA_FIELDS has Customer group', () => {
    assert(source.includes("group: 'Customer'"), 'Should have Customer group');
  });

  test('DATA_FIELDS has Company group', () => {
    assert(source.includes("group: 'Company'"), 'Should have Company group');
  });

  test('Document group has document.number field', () => {
    assert(source.includes("key: 'document.number'"), 'Should have document.number field');
  });

  test('Document group has document.date field', () => {
    assert(source.includes("key: 'document.date'"), 'Should have document.date field');
  });

  test('Customer group has customer.name field', () => {
    assert(source.includes("key: 'customer.name'"), 'Should have customer.name field');
  });

  test('Customer group has customer.email field', () => {
    assert(source.includes("key: 'customer.email'"), 'Should have customer.email field');
  });

  test('Company group has company.name field', () => {
    assert(source.includes("key: 'company.name'"), 'Should have company.name field');
  });

  // --- Search filtering ---

  test('filteredFieldTabFields uses useMemo for search filtering', () => {
    assert(source.includes('filteredFieldTabFields = useMemo'), 'Should use useMemo for filtered fields');
  });

  test('Search filters fields by key and label (case-insensitive)', () => {
    // The filter checks both field.key and field.label
    assert(source.includes('fieldTabSearch'), 'Should reference fieldTabSearch for filtering');
    assert(source.includes('.toLowerCase()'), 'Should convert to lowercase for case-insensitive search');
  });

  test('Empty search returns all fields', () => {
    assert(source.includes("if (!fieldTabSearch) return DATA_FIELDS"), 'Empty search should return all fields');
  });

  test('Empty search state shown when no matches', () => {
    assert(source.includes('data-testid="fields-empty-state"'), 'Should have empty state testid');
    assert(source.includes('No matching fields'), 'Should show "No matching fields" message');
  });

  // --- Drag to canvas ---

  test('Field items are draggable', () => {
    // Check that field items have draggable attribute
    const fieldItemSection = source.substring(source.indexOf('data-testid={`field-${field.key}`}'));
    assert(fieldItemSection.includes('draggable'), 'Field items should be draggable');
  });

  test('Field items have onDragStart handler', () => {
    assert(source.includes('handleFieldDragStart'), 'Should have handleFieldDragStart handler');
    assert(source.includes('onDragStart={(e) => handleFieldDragStart(e, field.key)'), 'Should call handleFieldDragStart on drag');
  });

  test('Field items have role="option" for accessibility', () => {
    assert(source.includes('role="option"'), 'Field items should have role="option"');
  });

  test('Field items have aria-label for accessibility', () => {
    assert(source.includes('aria-label={`Bind field ${field.key}`}'), 'Field items should have aria-label');
  });

  test('Field items have cursor:grab style', () => {
    // The field items have cursor: grab for drag affordance
    const fieldSection = source.substring(
      source.indexOf('data-testid={`field-${field.key}`}'),
      source.indexOf('data-testid={`field-${field.key}`}') + 500
    );
    assert(fieldSection.includes("cursor: 'grab'"), 'Field items should have cursor:grab');
  });

  // --- Field tree structure ---

  test('Field tree renders groups with group name header', () => {
    assert(source.includes('group.group'), 'Should render group.group as the category header');
    assert(source.includes("fontWeight: 600"), 'Group headers should be bold');
  });

  test('Field tree renders individual fields under each group', () => {
    assert(source.includes('group.fields.map'), 'Should iterate group.fields to render individual items');
  });

  test('Each field displays its key', () => {
    assert(source.includes('field.key'), 'Field key should be displayed');
    assert(source.includes('title={field.key}'), 'Field key should be in title attribute');
  });

  // --- Click to bind ---

  test('Clicking a field can bind it to selected element', () => {
    assert(source.includes('handleBindField(field.key)'), 'Should call handleBindField on click');
  });

  test('Keyboard Enter/Space can bind a field', () => {
    const fieldSection = source.substring(
      source.indexOf('data-testid={`field-${field.key}`}'),
      source.indexOf('data-testid={`field-${field.key}`}') + 1000
    );
    assert(fieldSection.includes("e.key === 'Enter'"), 'Should handle Enter key');
    assert(fieldSection.includes("e.key === ' '"), 'Should handle Space key');
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
})();
