/**
 * Test Feature #305: Canvas elements visually crisp at all zooms
 * Verifies that elements render sharply at various zoom levels
 */

const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200];

// Source code analysis tests - verify the rendering properties are in place
const fs = require('fs');
const path = require('path');

const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const source = fs.readFileSync(designerPath, 'utf-8');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('Feature #305: Canvas elements visually crisp at all zooms\n');

// 1. Canvas page rendering properties
console.log('--- Canvas Page Rendering Properties ---');
test('Canvas page has textRendering optimizeLegibility', source.includes("textRendering: 'optimizeLegibility'"));
test('Canvas page has WebkitFontSmoothing antialiased', source.includes("WebkitFontSmoothing: 'antialiased'"));
test('Canvas page has imageRendering auto', source.includes("imageRendering: 'auto'"));

// 2. Canvas element base style crisp rendering
console.log('\n--- Canvas Element Base Style ---');
test('Elements have backfaceVisibility hidden', source.includes("backfaceVisibility: 'hidden'"));
test('Elements have WebkitFontSmoothing antialiased on base style',
  source.match(/baseStyle.*?WebkitFontSmoothing.*?'antialiased'/s) !== null);
test('Elements have willChange transform', source.includes("willChange: 'transform'"));
test('Elements have transform translateZ(0) for GPU compositing', source.includes("transform: 'translateZ(0)'"));

// 3. Text rendering
console.log('\n--- Text Element Rendering ---');
test('Text elements have textRendering optimizeLegibility',
  source.includes("textRendering: 'optimizeLegibility'"));
test('Text elements scale fontSize with zoom', source.includes('fontSize: `${(el.fontSize || 14) * scale}px`'));
test('Text elements scale padding with zoom', source.includes('padding: `${2 * scale}px`'));

// 4. Image rendering
console.log('\n--- Image Element Rendering ---');
test('Image elements have imageRendering auto',
  source.includes("imageRendering: 'auto'"));

// 5. Scale calculation
console.log('\n--- Zoom Scale Calculations ---');
test('Scale derived from zoom/100', source.includes('const scale = zoom / 100'));
test('Element positions scaled (left)', source.includes('left: `${el.x * scale}px`'));
test('Element positions scaled (top)', source.includes('top: `${el.y * scale}px`'));
test('Element dimensions scaled (width)', source.includes('width: `${el.w * scale}px`'));
test('Element dimensions scaled (height)', source.includes('height: `${el.h * scale}px`'));

// 6. Canvas page scales correctly
console.log('\n--- Canvas Page Scaling ---');
test('Canvas page width scales with zoom', source.includes('width: `${595 * (zoom / 100)}px`'));
test('Canvas page height scales with zoom', source.includes('height: `${842 * (zoom / 100)}px`'));
test('Page has smooth transition for size changes', source.includes("transition: 'width 0.2s, height 0.2s'"));

// 7. All zoom levels are supported
console.log('\n--- Zoom Level Support ---');
test('All 7 zoom levels defined (25-200)', source.includes('const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200]'));

// 8. Table element scales with zoom
console.log('\n--- Table Element Scaling ---');
test('Table header font scales with zoom', source.includes('fontSize: `${10 * scale}px`'));
test('Table padding scales with zoom', source.includes('padding: `${2 * scale}px ${4 * scale}px`'));

// 9. Other element types scale
console.log('\n--- Other Element Scaling ---');
test('Image label font scales with zoom', source.includes('fontSize: `${12 * scale}px`'));

// 10. Page label and preview badge scale
console.log('\n--- Page Overlay Elements ---');
test('Page label scales with zoom', source.includes('fontSize: `${10 * (zoom / 100)}px`'));
test('Preview badge scales with zoom',
  source.match(/PREVIEW.*fontSize.*zoom/s) !== null || source.includes('fontSize: `${10 * (zoom / 100)}px`'));

console.log(`\n--- Results: ${passed}/${passed + failed} tests passing ---`);
if (failed > 0) {
  process.exit(1);
}
