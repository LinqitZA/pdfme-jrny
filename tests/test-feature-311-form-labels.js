/**
 * Feature #311: Form inputs have associated labels
 *
 * Verifies that all form inputs in Properties panel have properly associated labels.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    results.push(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// Read the source file
const srcPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const src = fs.readFileSync(srcPath, 'utf8');

console.log('\n=== Feature #311: Form inputs have associated labels ===\n');

// ─── Position inputs ───

const positionInputs = [
  { id: 'prop-x', label: 'X' },
  { id: 'prop-y', label: 'Y' },
  { id: 'prop-w', label: 'W' },
  { id: 'prop-h', label: 'H' },
];

positionInputs.forEach(({ id, label }) => {
  test(`Position input "${label}" has label with htmlFor="${id}"`, () => {
    assert(src.includes(`htmlFor="${id}"`), `Missing htmlFor="${id}"`);
    assert(src.includes(`id="${id}"`), `Missing id="${id}" on input`);
  });
});

// ─── Typography inputs ───

test('Font Family select has label with htmlFor="prop-font-family"', () => {
  assert(src.includes('htmlFor="prop-font-family"'), 'Missing htmlFor');
  assert(src.includes('id="prop-font-family"'), 'Missing id on select');
});

test('Font Size input has label with htmlFor="prop-font-size"', () => {
  assert(src.includes('htmlFor="prop-font-size"'), 'Missing htmlFor');
  assert(src.includes('id="prop-font-size"'), 'Missing id on input');
});

test('Line Height input has label with htmlFor="prop-line-height"', () => {
  assert(src.includes('htmlFor="prop-line-height"'), 'Missing htmlFor');
  assert(src.includes('id="prop-line-height"'), 'Missing id on input');
});

// ─── Color picker ───

test('Color picker has label with htmlFor="prop-color"', () => {
  assert(src.includes('htmlFor="prop-color"'), 'Missing htmlFor for color picker');
  assert(src.includes('id="prop-color"'), 'Missing id on color input');
});

// ─── Content ───

test('Content textarea has label with htmlFor="prop-content"', () => {
  assert(src.includes('htmlFor="prop-content"'), 'Missing htmlFor');
  assert(src.includes('id="prop-content"'), 'Missing id on textarea');
});

// ─── Text Overflow ───

test('Overflow Strategy select has label with htmlFor="prop-text-overflow"', () => {
  assert(src.includes('htmlFor="prop-text-overflow"'), 'Missing htmlFor');
  assert(src.includes('id="prop-text-overflow"'), 'Missing id on select');
});

// ─── Image options ───

test('Source URL input has label with htmlFor="prop-src"', () => {
  assert(src.includes('htmlFor="prop-src"'), 'Missing htmlFor');
  assert(src.includes('id="prop-src"'), 'Missing id on input');
});

test('Object Fit select has label with htmlFor="prop-object-fit"', () => {
  assert(src.includes('htmlFor="prop-object-fit"'), 'Missing htmlFor');
  assert(src.includes('id="prop-object-fit"'), 'Missing id on select');
});

test('Opacity input has label with htmlFor="prop-opacity"', () => {
  assert(src.includes('htmlFor="prop-opacity"'), 'Missing htmlFor');
  assert(src.includes('id="prop-opacity"'), 'Missing id on input');
});

test('Alt Text input has label with htmlFor="prop-alt-text"', () => {
  assert(src.includes('htmlFor="prop-alt-text"'), 'Missing htmlFor');
  assert(src.includes('id="prop-alt-text"'), 'Missing id on input');
});

// ─── Table options ───

test('Border Style select has label with htmlFor="prop-border-style"', () => {
  assert(src.includes('htmlFor="prop-border-style"'), 'Missing htmlFor');
  assert(src.includes('id="prop-border-style"'), 'Missing id on select');
});

test('Show Header checkbox has label with htmlFor="prop-show-header"', () => {
  assert(src.includes('htmlFor="prop-show-header"'), 'Missing htmlFor');
  assert(src.includes('id="prop-show-header"'), 'Missing id on checkbox');
});

// ─── Data binding ───

test('Bound Field input has label with htmlFor="prop-binding"', () => {
  assert(src.includes('htmlFor="prop-binding"'), 'Missing htmlFor');
  assert(src.includes('id="prop-binding"'), 'Missing id on input');
});

// ─── Page visibility ───

test('Page Scope select has label with htmlFor="prop-page-scope"', () => {
  assert(src.includes('htmlFor="prop-page-scope"'), 'Missing htmlFor');
  assert(src.includes('id="prop-page-scope"'), 'Missing id on select');
});

// ─── Output channel ───

test('Channel select has label with htmlFor="prop-output-channel"', () => {
  assert(src.includes('htmlFor="prop-output-channel"'), 'Missing htmlFor');
  assert(src.includes('id="prop-output-channel"'), 'Missing id on select');
});

// ─── Conditional visibility ───

test('Visibility select has label with htmlFor="prop-conditional-visibility"', () => {
  assert(src.includes('htmlFor="prop-conditional-visibility"'), 'Missing htmlFor');
  assert(src.includes('id="prop-conditional-visibility"'), 'Missing id on select');
});

test('Condition Expression input has label with htmlFor="prop-visibility-condition"', () => {
  assert(src.includes('htmlFor="prop-visibility-condition"'), 'Missing htmlFor');
  assert(src.includes('id="prop-visibility-condition"'), 'Missing id on input');
});

// ─── Verify labels are proper <label> elements ───

test('Labels use <label> elements, not <span>', () => {
  // Check that none of the property field labels are still <span> elements
  // We look for the pattern: <span ... >Label</span> before an input
  const spanLabelPattern = /<span style=\{\{ fontSize: '11px'.*?\}\}>(?:X|Y|W|H|Font Family|Font Size|Line Height|Color|Content|Overflow Strategy|Source URL|Object Fit|Opacity|Alt Text|Border Style|Bound Field|Page Scope|Channel|Visibility|Condition Expression)<\/span>/g;
  const matches = src.match(spanLabelPattern);
  assert(!matches, `Found ${matches ? matches.length : 0} <span> labels that should be <label>: ${matches ? matches.map(m => m.slice(0, 60)).join(', ') : ''}`);
});

test('All labels use htmlFor (for/id association)', () => {
  // Count htmlFor attributes in the component
  const htmlForMatches = src.match(/htmlFor="/g) || [];
  // We expect at least 18 htmlFor attributes (for all form controls)
  assert(htmlForMatches.length >= 18, `Only found ${htmlForMatches.length} htmlFor attributes, expected >= 18`);
});

test('No orphaned aria-label without id on property inputs', () => {
  // Property inputs (data-testid="prop-*") should have id attributes
  const propInputRegex = /data-testid="(prop-[^"]+)"/g;
  let match;
  const missingIds = [];
  while ((match = propInputRegex.exec(src)) !== null) {
    const testId = match[1];
    // Skip prop-column-* (dynamic columns) and prop-color-hex (secondary input)
    if (testId.startsWith('prop-column-') || testId === 'prop-color-hex') continue;
    if (!src.includes(`id="${testId}"`)) {
      missingIds.push(testId);
    }
  }
  assert(missingIds.length === 0, `Inputs missing id attributes: ${missingIds.join(', ')}`);
});

// Print results
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
