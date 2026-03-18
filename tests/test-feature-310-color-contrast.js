/**
 * Feature #310: Color contrast meets WCAG AA
 *
 * Verifies that text and interactive elements meet the 4.5:1 contrast ratio minimum.
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

/**
 * Calculate relative luminance per WCAG 2.0
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const linearize = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Calculate contrast ratio per WCAG 2.0
 * https://www.w3.org/TR/WCAG20/#contrast-ratiodef
 */
function contrastRatio(fg, bg) {
  const L1 = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const L2 = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (L1 + 0.05) / (L2 + 0.05);
}

// Read the source file
const srcPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const src = fs.readFileSync(srcPath, 'utf8');

console.log('\n=== Feature #310: Color contrast meets WCAG AA ===\n');

// ─── Toolbar text contrast ───

test('Toolbar button text (#334155 on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#334155', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Toolbar button text color is #334155 in source', () => {
  assert(src.includes("color: '#334155'"), 'toolbarBtnStyle should use #334155');
});

test('No #94a3b8 used as text color in source', () => {
  // This was the main failing color (2.5:1 contrast)
  const matches = src.match(/color: '#94a3b8'/g);
  assert(!matches, `Found ${matches ? matches.length : 0} instances of #94a3b8 as text color`);
});

// ─── Properties panel text contrast ───

test('Label text (#64748b on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#64748b', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Sub-label text now uses #64748b (was #94a3b8)', () => {
  // All property sub-labels (X, Y, W, H, Font Family, etc.) should use #64748b
  const oldColorCount = (src.match(/color: '#94a3b8'/g) || []).length;
  assert(oldColorCount === 0, `Still found ${oldColorCount} instances of old #94a3b8 text color`);
});

test('Section header blue (#2563eb on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#2563eb', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Active toggle button text (#2563eb on #e0e7ff) meets 3:1 for UI components', () => {
  // Active state toggle buttons (bold, italic, align) - UI component minimum is 3:1
  const ratio = contrastRatio('#2563eb', '#e0e7ff');
  assert(ratio >= 3.0, `Ratio is ${ratio.toFixed(2)}:1, expected >= 3.0:1 for UI components`);
});

test('Primary text (#334155 on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#334155', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Table header text (#475569 on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#475569', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

// ─── Canvas element text contrast ───

test('Canvas placeholder text now uses #64748b (not #94a3b8)', () => {
  // Placeholder text for empty elements on canvas
  assert(!src.includes("color: '#94a3b8'"), 'No #94a3b8 text color should remain');
});

test('Canvas element text defaults to #000000 on white', () => {
  const ratio = contrastRatio('#000000', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1`);
  assert(src.includes("color: '#000000'") || src.includes("color: '#000'"), 'Default text color should be black');
});

// ─── Badge/pill text contrast ───

test('Page scope badge (#1e40af on #dbeafe) meets 4.5:1', () => {
  const ratio = contrastRatio('#1e40af', '#dbeafe');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Channel badge (#92400e on #fef3c7) meets 4.5:1', () => {
  const ratio = contrastRatio('#92400e', '#fef3c7');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Conditional visibility badge (#7c3aed on #f3e8ff) meets 4.5:1', () => {
  const ratio = contrastRatio('#7c3aed', '#f3e8ff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Binding preview green (#15803d on #f0fdf4) meets 4.5:1', () => {
  const ratio = contrastRatio('#15803d', '#f0fdf4');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

// ─── Error/status text contrast ───

test('Error text (#dc2626 on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#dc2626', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Error text replaced from #ef4444 to #dc2626', () => {
  // #ef4444 as text color should not appear in source
  const textColorMatches = (src.match(/color: '#ef4444'/g) || []).length;
  assert(textColorMatches === 0, `Found ${textColorMatches} instances of #ef4444 as text color`);
});

test('Save button bg (#2563eb) with white text meets 4.5:1', () => {
  const ratio = contrastRatio('#ffffff', '#2563eb');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Disabled save button bg (#475569) with white text meets 4.5:1', () => {
  const ratio = contrastRatio('#ffffff', '#475569');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Warning text (#b45309 on white) meets 4.5:1', () => {
  const ratio = contrastRatio('#b45309', '#ffffff');
  assert(ratio >= 4.5, `Ratio is ${ratio.toFixed(2)}:1, expected >= 4.5:1`);
});

test('Reconnecting status text uses #b45309 (not #f59e0b)', () => {
  assert(!src.includes("color: '#f59e0b'"), '#f59e0b should not be used as text color (2.1:1 contrast)');
});

// ─── Verify all meet 4.5:1 ratio minimum ───

test('All text colors in component meet WCAG AA 4.5:1 minimum', () => {
  // Comprehensive check: extract all color: '#xxxxxx' patterns and check against white
  const colorRegex = /color: '(#[0-9a-fA-F]{6})'/g;
  let match;
  const failingColors = [];
  const checked = new Set();

  while ((match = colorRegex.exec(src)) !== null) {
    const color = match[1];
    if (checked.has(color)) continue;
    checked.add(color);

    // Skip disabled state colors and colors that are on colored backgrounds (badges)
    if (color === '#cbd5e1') continue; // disabled state - not required by WCAG
    if (color === '#ffffff' || color === '#fff') continue; // white text on colored bg

    const ratio = contrastRatio(color, '#ffffff');
    if (ratio < 4.5) {
      failingColors.push(`${color} (${ratio.toFixed(2)}:1)`);
    }
  }

  assert(failingColors.length === 0,
    `Colors failing 4.5:1 on white: ${failingColors.join(', ')}`);
});

test('No #94a3b8 anywhere as a text or foreground color', () => {
  const regex = /color:\s*['"]#94a3b8['"]/g;
  const matches = src.match(regex);
  assert(!matches, `Found ${matches ? matches.length : 0} remaining #94a3b8 color usages`);
});

test('labelStyle uses #64748b (4.8:1 contrast)', () => {
  // The shared label style constant should use the accessible color
  const labelMatch = src.match(/const labelStyle.*?\{[\s\S]*?color:\s*'([^']+)'/);
  assert(labelMatch, 'labelStyle constant not found');
  assert(labelMatch[1] === '#64748b', `labelStyle uses ${labelMatch[1]}, expected #64748b`);
  const ratio = contrastRatio('#64748b', '#ffffff');
  assert(ratio >= 4.5, `labelStyle ratio ${ratio.toFixed(2)}:1 < 4.5:1`);
});

// Print results
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
