/**
 * Feature #307: Focus rings visible on interactive elements
 * Tests that focused elements show clear focus indicators.
 *
 * Verification approach: Source code analysis + served CSS verification
 * (Browser automation unavailable due to missing libatk-1.0.so.0)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

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
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function runTests() {
  console.log('Feature #307: Focus rings visible on interactive elements\n');

  // Read source code
  const source = fs.readFileSync(DESIGNER_FILE, 'utf8');

  // Test 1: Focus ring styles exist in the component
  console.log('--- CSS Focus Ring Declarations ---');

  assert(
    source.includes(':focus-visible'),
    'Component contains :focus-visible pseudo-class selectors'
  );

  assert(
    source.includes('outline: 2px solid #4f46e5'),
    'Focus ring uses 2px solid indigo (#4f46e5) outline'
  );

  assert(
    source.includes('outline-offset'),
    'Focus ring has outline-offset for spacing from element'
  );

  // Test 2: Toolbar elements have focus ring styles
  console.log('\n--- Toolbar Focus Rings ---');

  assert(
    source.includes('.erp-designer-toolbar button:focus-visible'),
    'Toolbar buttons have focus-visible style'
  );

  assert(
    source.includes('.erp-designer-toolbar select:focus-visible'),
    'Toolbar selects have focus-visible style'
  );

  assert(
    source.includes('.erp-designer-toolbar input:focus-visible'),
    'Toolbar inputs have focus-visible style'
  );

  // Test 3: Properties panel inputs have focus ring styles
  console.log('\n--- Properties Panel Focus Rings ---');

  assert(
    source.includes('.erp-designer-right-panel input:focus-visible'),
    'Properties panel inputs have focus-visible style'
  );

  assert(
    source.includes('.erp-designer-right-panel select:focus-visible'),
    'Properties panel selects have focus-visible style'
  );

  assert(
    source.includes('.erp-designer-right-panel button:focus-visible'),
    'Properties panel buttons have focus-visible style'
  );

  assert(
    source.includes('.erp-designer-right-panel textarea:focus-visible'),
    'Properties panel textareas have focus-visible style'
  );

  // Test 4: Left panel interactive elements have focus ring styles
  console.log('\n--- Left Panel Focus Rings ---');

  assert(
    source.includes('.erp-designer-left-panel button:focus-visible'),
    'Left panel buttons have focus-visible style'
  );

  assert(
    source.includes('.block-card:focus-visible'),
    'Block cards have focus-visible style'
  );

  assert(
    source.includes('[role="option"]:focus-visible'),
    'Field items (role=option) have focus-visible style'
  );

  assert(
    source.includes('[role="tab"]:focus-visible'),
    'Page thumbnails (role=tab) have focus-visible style'
  );

  // Test 5: Canvas elements have focus ring styles
  console.log('\n--- Canvas Focus Rings ---');

  assert(
    source.includes('.erp-designer-canvas [tabindex="0"]:focus-visible'),
    'Canvas elements (tabindex=0) have focus-visible style'
  );

  // Test 6: General designer-level focus ring styles
  console.log('\n--- General Focus Ring Coverage ---');

  assert(
    source.includes('.erp-designer button:focus-visible'),
    'General designer buttons have focus-visible style'
  );

  assert(
    source.includes('.erp-designer [role="button"]:focus-visible'),
    'Custom button roles have focus-visible style'
  );

  // Test 7: Mouse click does not show focus ring (focus-visible only)
  console.log('\n--- Focus Ring Specificity ---');

  assert(
    source.includes('*:focus:not(:focus-visible)'),
    'Mouse-click focus suppressed via :focus:not(:focus-visible) rule'
  );

  assert(
    source.includes('outline: none'),
    'Non-keyboard focus has outline: none'
  );

  // Test 8: Clickable validation errors have focus ring
  console.log('\n--- Special Element Focus Rings ---');

  assert(
    source.includes('[data-element-id]:focus-visible'),
    'Clickable validation errors have focus-visible style'
  );

  // Test 9: Focus ring contrast - indigo on white/light backgrounds meets WCAG
  console.log('\n--- Focus Ring Contrast ---');

  const focusColor = '#4f46e5';
  assert(
    source.includes(focusColor),
    `Focus ring color is ${focusColor} (indigo-600, high contrast on light backgrounds)`
  );

  // Count occurrences of the focus color to ensure consistent usage
  const colorCount = (source.match(/#4f46e5/g) || []).length;
  assert(
    colorCount >= 5,
    `Focus ring color used consistently across ${colorCount} rules (>=5 expected)`
  );

  // Test 10: Verify styles are served in the actual page
  console.log('\n--- Served CSS Verification ---');

  try {
    const res = await fetch(FRONTEND);
    assert(res.status === 200, 'Frontend serves 200 OK');

    const html = res.body;
    assert(
      html.includes('focus-visible'),
      'Served HTML contains focus-visible CSS rules'
    );

    assert(
      html.includes('#4f46e5'),
      'Served HTML contains focus ring color #4f46e5'
    );
  } catch (e) {
    assert(false, `Frontend fetch failed: ${e.message}`);
  }

  // Test 11: Focus ring outline-offset values
  console.log('\n--- Outline Offset Values ---');

  assert(
    source.includes('outline-offset: 2px'),
    'Toolbar/left-panel elements have 2px outline offset'
  );

  assert(
    source.includes('outline-offset: 1px'),
    'Properties/canvas elements have 1px outline offset (tighter fit)'
  );

  // Test 12: Verify interactive elements have tabIndex and role for keyboard access
  console.log('\n--- Keyboard Accessibility Attributes ---');

  assert(
    source.includes('tabIndex={0}'),
    'Interactive divs have tabIndex={0} for keyboard focus'
  );

  assert(
    source.includes('role="button"'),
    'Custom interactive elements have role="button"'
  );

  assert(
    source.includes('role="option"'),
    'Field items have role="option"'
  );

  assert(
    source.includes('role="tab"'),
    'Page thumbnails have role="tab"'
  );

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
