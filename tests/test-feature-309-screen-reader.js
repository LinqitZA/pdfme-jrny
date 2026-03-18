/**
 * Feature #309: Screen reader reads element properties
 * Tests that the properties panel is readable by screen readers.
 *
 * Verification approach: Source code analysis of ARIA attributes
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const FRONTEND = 'http://localhost:3001';
const DESIGNER_FILE = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.log(`  \u274c ${msg}`);
  }
}

async function runTests() {
  console.log('Feature #309: Screen reader reads element properties\n');

  const source = fs.readFileSync(DESIGNER_FILE, 'utf8');

  // --- Properties panel as a landmark region ---
  console.log('--- Properties Panel Region ---');

  assert(
    source.includes('role="complementary"') && source.includes('aria-label="Element properties panel"'),
    'Properties panel has role="complementary" and aria-label'
  );

  assert(
    source.includes('role="region"') && source.includes('element properties'),
    'Properties content area has role="region" with descriptive aria-label'
  );

  // --- Element type announced ---
  console.log('\n--- Element Type Announced ---');

  assert(
    source.includes('role="heading"') && source.includes('aria-level={2}'),
    'Element type header has role="heading" with aria-level for screen reader announcement'
  );

  assert(
    source.includes('getElementTypeLabel(selectedElement.type)'),
    'Element type label function provides human-readable type names'
  );

  // Verify all element types have labels
  const typeLabels = [
    "'text': 'Text'",
    "'rich-text': 'Rich Text'",
    "'calculated': 'Calculated Field'",
    "'image': 'Image'",
    "'erp-image': 'ERP Image'",
    "'signature': 'Signature Block'",
    "'drawn-signature': 'Drawn Signature'",
    "'line-items': 'Line Items Table'",
    "'grouped-table': 'Grouped Table'",
    "'qr-barcode': 'QR/Barcode'",
    "'watermark': 'Watermark'",
  ];
  typeLabels.forEach((label) => {
    assert(source.includes(label), `Element type label defined: ${label.split("'")[1]}`);
  });

  // --- Empty state screen reader accessible ---
  console.log('\n--- Empty State Accessibility ---');

  assert(
    source.includes('role="status"') && source.includes('aria-label="No element selected"'),
    'Empty properties state has role="status" and aria-label'
  );

  // --- Property labels readable by screen reader ---
  console.log('\n--- Position & Size Property Labels ---');

  assert(
    source.includes('aria-label="X position"'),
    'X position input has aria-label'
  );

  assert(
    source.includes('aria-label="Y position"'),
    'Y position input has aria-label'
  );

  assert(
    source.includes('aria-label="Width"'),
    'Width input has aria-label'
  );

  assert(
    source.includes('aria-label="Height"'),
    'Height input has aria-label'
  );

  // --- Typography property labels ---
  console.log('\n--- Typography Property Labels ---');

  assert(
    source.includes('aria-label="Font family"'),
    'Font family select has aria-label'
  );

  assert(
    source.includes('aria-label="Font size"'),
    'Font size input has aria-label'
  );

  assert(
    source.includes('aria-label="Line height"'),
    'Line height input has aria-label'
  );

  assert(
    source.includes('aria-label="Toggle bold"'),
    'Bold button has aria-label'
  );

  assert(
    source.includes('aria-label="Toggle italic"'),
    'Italic button has aria-label'
  );

  assert(
    source.includes('aria-label={`Align ${align}`}'),
    'Alignment buttons have dynamic aria-labels'
  );

  assert(
    source.includes('aria-label="Text color picker"'),
    'Color picker has aria-label'
  );

  assert(
    source.includes('aria-label="Text color hex value"'),
    'Color hex input has aria-label'
  );

  assert(
    source.includes('aria-label="Element content"'),
    'Content textarea has aria-label'
  );

  // --- Text overflow property ---
  console.log('\n--- Text Overflow Property Labels ---');

  assert(
    source.includes('aria-label="Text overflow strategy"'),
    'Text overflow select has aria-label'
  );

  // --- Image property labels ---
  console.log('\n--- Image Property Labels ---');

  assert(
    source.includes('aria-label="Image source URL"'),
    'Image source input has aria-label'
  );

  assert(
    source.includes('aria-label="Object fit"'),
    'Object fit select has aria-label'
  );

  assert(
    source.includes('aria-label="Opacity percentage"'),
    'Opacity input has aria-label'
  );

  // --- Table property labels ---
  console.log('\n--- Table Property Labels ---');

  assert(
    source.includes('aria-label="Show header row"'),
    'Show header checkbox has aria-label'
  );

  assert(
    source.includes('aria-label="Border style"'),
    'Border style select has aria-label'
  );

  assert(
    source.includes('aria-label={`Column ${colIdx + 1} key`}'),
    'Column key inputs have dynamic aria-labels'
  );

  assert(
    source.includes('aria-label={`Column ${colIdx + 1} header`}'),
    'Column header inputs have dynamic aria-labels'
  );

  assert(
    source.includes('aria-label={`Column ${colIdx + 1} width`}'),
    'Column width inputs have dynamic aria-labels'
  );

  assert(
    source.includes('aria-label="Add table column"'),
    'Add column button has aria-label'
  );

  // --- Data binding property labels ---
  console.log('\n--- Data Binding Property Labels ---');

  assert(
    source.includes('aria-label="Data binding field"'),
    'Binding input has aria-label'
  );

  assert(
    source.includes('aria-label="Open binding picker"'),
    'Binding picker button has aria-label'
  );

  // --- Page visibility property labels ---
  console.log('\n--- Page Visibility Property Labels ---');

  assert(
    source.includes('aria-label="Page scope"'),
    'Page scope select has aria-label'
  );

  // --- Output channel property labels ---
  console.log('\n--- Output Channel Property Labels ---');

  assert(
    source.includes('aria-label="Output channel"'),
    'Output channel select has aria-label'
  );

  // --- Conditional visibility property labels ---
  console.log('\n--- Conditional Visibility Property Labels ---');

  assert(
    source.includes('aria-label="Conditional visibility"'),
    'Conditional visibility select has aria-label'
  );

  assert(
    source.includes('aria-label="Visibility condition expression"'),
    'Visibility condition input has aria-label'
  );

  // --- Delete element ---
  console.log('\n--- Actions ---');

  assert(
    source.includes('aria-label="Delete element"'),
    'Delete element button has aria-label'
  );

  // --- Canvas element selection announcement ---
  console.log('\n--- Canvas Element Selection ---');

  // Canvas elements have aria-label with element type and binding info
  assert(
    source.includes('aria-label={`${getElementTypeLabel(el.type)} element'),
    'Canvas elements have aria-label with element type'
  );

  assert(
    source.includes('aria-selected={isSelected}'),
    'Canvas elements have aria-selected state for screen readers'
  );

  // --- Verify overall aria-label count in properties area ---
  console.log('\n--- Coverage Summary ---');

  const ariaLabelCount = (source.match(/aria-label=/g) || []).length;
  assert(
    ariaLabelCount >= 40,
    `Total aria-label attributes in component: ${ariaLabelCount} (>=40 expected)`
  );

  // Verify the page loads with aria attributes
  try {
    const res = await fetch(FRONTEND);
    assert(res.status === 200, 'Frontend serves page successfully');
    assert(
      res.body.includes('aria-label'),
      'Served HTML includes aria-label attributes'
    );
  } catch (e) {
    assert(false, `Frontend fetch failed: ${e.message}`);
  }

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
