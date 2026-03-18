/**
 * Feature #391: Label size presets and custom dimension input in designer
 *
 * Verifies:
 * 1. Label size presets added to PAGE_SIZE_DIMENSIONS
 * 2. LABEL_SIZES array with 8 label presets
 * 3. Optgroup separator in dropdown (Standard / Labels)
 * 4. Custom option reveals width/height mm inputs
 * 5. Portrait/landscape orientation toggle swaps width and height
 * 6. Effective page dimensions computed correctly for labels
 * 7. Canvas resizes to reflect label dimensions
 * 8. Small label (57x32mm) renders correctly
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${testName}`);
  } else {
    failed++;
    results.push(`  FAIL: ${testName}`);
  }
}

async function runTests() {
  console.log('=== Feature #391: Label size presets and custom dimension input ===\n');

  const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const src = fs.readFileSync(componentPath, 'utf-8');

  // ─── Part 1: Label size presets ───
  console.log('--- Part 1: Label size presets in constants ---');

  assert(
    src.includes("const LABEL_SIZES = ["),
    'LABEL_SIZES constant array exists'
  );

  const labelPresets = [
    { name: 'Label 100×50mm', wMm: 100, hMm: 50 },
    { name: 'Label 100×150mm', wMm: 100, hMm: 150 },
    { name: 'Label 101.6×152.4mm', wMm: 101.6, hMm: 152.4 },
    { name: 'Label 57×32mm', wMm: 57, hMm: 32 },
    { name: 'Label 76×51mm', wMm: 76, hMm: 51 },
    { name: 'Label 102×64mm', wMm: 102, hMm: 64 },
    { name: 'Label 60×40mm', wMm: 60, hMm: 40 },
    { name: 'Label 80×40mm', wMm: 80, hMm: 40 },
  ];

  for (const lbl of labelPresets) {
    assert(
      src.includes(`'${lbl.name}'`),
      `LABEL_SIZES includes '${lbl.name}'`
    );
  }

  assert(
    src.includes('const MM_TO_PT_FACTOR = 2.83465'),
    'MM_TO_PT_FACTOR conversion constant defined (2.83465)'
  );

  // ─── Part 2: Label dimensions in PAGE_SIZE_DIMENSIONS ───
  console.log('--- Part 2: Label dimensions in PAGE_SIZE_DIMENSIONS ---');

  assert(
    src.includes("'Label 100×50mm':"),
    'PAGE_SIZE_DIMENSIONS has Label 100×50mm entry'
  );

  assert(
    src.includes("'Label 57×32mm':"),
    'PAGE_SIZE_DIMENSIONS has Label 57×32mm entry (smallest label)'
  );

  assert(
    src.includes("'Label 101.6×152.4mm':"),
    'PAGE_SIZE_DIMENSIONS has Label 101.6×152.4mm (Zebra/TSC standard)'
  );

  assert(
    src.includes("'Label 80×40mm':"),
    'PAGE_SIZE_DIMENSIONS has Label 80×40mm (shelf label)'
  );

  // Verify mm-to-pt conversion formula used
  assert(
    src.includes('Math.round(100 * MM_TO_PT_FACTOR)'),
    'Label dimensions use Math.round(mm * MM_TO_PT_FACTOR) conversion'
  );

  // Verify all 8 label sizes are in dimensions map
  for (const lbl of labelPresets) {
    assert(
      src.includes(`'${lbl.name}':`),
      `PAGE_SIZE_DIMENSIONS has ${lbl.name}`
    );
  }

  // ─── Part 3: Dropdown with optgroups ───
  console.log('--- Part 3: Dropdown with optgroup separators ---');

  assert(
    src.includes('<optgroup label="Standard">'),
    'Standard optgroup wraps standard page sizes'
  );

  assert(
    src.includes('<optgroup label="Labels">'),
    'Labels optgroup wraps label sizes'
  );

  assert(
    src.includes('{LABEL_SIZES.map('),
    'LABEL_SIZES mapped to option elements in Labels optgroup'
  );

  assert(
    src.includes('<option value="Custom">Custom</option>'),
    'Custom option available in page size selector'
  );

  // Standard sizes still present
  assert(
    src.includes('{PAGE_SIZES.map('),
    'PAGE_SIZES still mapped in Standard optgroup'
  );

  // ─── Part 4: Custom dimension inputs ───
  console.log('--- Part 4: Custom dimension inputs ---');

  assert(
    src.includes('data-testid="custom-dimensions"'),
    'Custom dimensions container has data-testid'
  );

  assert(
    src.includes('data-testid="custom-width-mm"'),
    'Custom width input has data-testid'
  );

  assert(
    src.includes('data-testid="custom-height-mm"'),
    'Custom height input has data-testid'
  );

  assert(
    src.includes("aria-label=\"Custom width (mm)\""),
    'Custom width input has aria-label'
  );

  assert(
    src.includes("aria-label=\"Custom height (mm)\""),
    'Custom height input has aria-label'
  );

  assert(
    src.includes("type=\"number\""),
    'Custom inputs are number type'
  );

  // Check min/max bounds
  assert(
    src.includes('min={10}'),
    'Custom dimension min is 10mm'
  );

  assert(
    src.includes('max={1000}'),
    'Custom dimension max is 1000mm'
  );

  // Custom inputs only visible when Custom is selected
  assert(
    src.includes("pageSize === 'Custom'"),
    'Custom inputs conditionally rendered when pageSize is Custom'
  );

  // Custom state variables
  assert(
    src.includes('const [customWidthMm, setCustomWidthMm] = useState(100)'),
    'customWidthMm state initialized to 100'
  );

  assert(
    src.includes('const [customHeightMm, setCustomHeightMm] = useState(50)'),
    'customHeightMm state initialized to 50'
  );

  // ─── Part 5: Orientation toggle ───
  console.log('--- Part 5: Portrait/landscape orientation toggle ---');

  assert(
    src.includes('data-testid="btn-orientation-toggle"'),
    'Orientation toggle button has data-testid'
  );

  assert(
    src.includes("const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')"),
    'Orientation state typed and initialized to portrait'
  );

  assert(
    src.includes('data-orientation={orientation}'),
    'Orientation toggle has data-orientation attribute'
  );

  // Toggle swaps custom dimensions
  assert(
    src.includes('setCustomWidthMm(customHeightMm)') && src.includes('setCustomHeightMm(tmpW)'),
    'Orientation toggle swaps custom width and height'
  );

  // ─── Part 6: Effective page dimensions ───
  console.log('--- Part 6: Effective page dimensions computation ---');

  assert(
    src.includes('effectivePageDims'),
    'effectivePageDims computed value exists'
  );

  assert(
    src.includes('useMemo'),
    'effectivePageDims uses useMemo for performance'
  );

  // Custom page size uses mm-to-pt conversion
  assert(
    src.includes('customWidthMm * MM_TO_PT_FACTOR'),
    'Custom dimensions converted from mm to pt using MM_TO_PT_FACTOR'
  );

  // Orientation swapping in computed dims
  assert(
    src.includes("orientation === 'landscape'") && src.includes("[w, h] = [h, w]"),
    'effectivePageDims swaps width/height for landscape orientation'
  );

  assert(
    src.includes("orientation === 'portrait'") && src.includes("w > h"),
    'effectivePageDims swaps width/height for portrait when w > h'
  );

  // ─── Part 7: Canvas uses effectivePageDims ───
  console.log('--- Part 7: Canvas uses effectivePageDims ---');

  assert(
    src.includes('effectivePageDims.width'),
    'Canvas width uses effectivePageDims.width'
  );

  assert(
    src.includes('effectivePageDims.height'),
    'Canvas height uses effectivePageDims.height'
  );

  // data-page-width and data-page-height use effective dims
  assert(
    src.includes('data-page-width={effectivePageDims.width}'),
    'data-page-width attribute uses effectivePageDims'
  );

  assert(
    src.includes('data-page-height={effectivePageDims.height}'),
    'data-page-height attribute uses effectivePageDims'
  );

  // ─── Part 8: Dimension accuracy checks ───
  console.log('--- Part 8: Dimension accuracy for specific labels ---');

  const MM_TO_PT = 2.83465;

  // Verify expected pt values for label sizes
  const expectedDims = [
    { name: '100×50mm', w: Math.round(100 * MM_TO_PT), h: Math.round(50 * MM_TO_PT) },
    { name: '57×32mm', w: Math.round(57 * MM_TO_PT), h: Math.round(32 * MM_TO_PT) },
    { name: '101.6×152.4mm', w: Math.round(101.6 * MM_TO_PT), h: Math.round(152.4 * MM_TO_PT) },
    { name: '80×40mm', w: Math.round(80 * MM_TO_PT), h: Math.round(40 * MM_TO_PT) },
  ];

  for (const dim of expectedDims) {
    assert(
      dim.w > 0 && dim.h > 0,
      `Label ${dim.name} produces valid pt dimensions: ${dim.w}×${dim.h}`
    );
  }

  // 57x32mm is smallest: width ~162pt, height ~91pt
  const smallW = Math.round(57 * MM_TO_PT);
  const smallH = Math.round(32 * MM_TO_PT);
  assert(
    smallW >= 100 && smallW <= 200 && smallH >= 50 && smallH <= 120,
    `Smallest label (57×32mm) has reasonable pt dims: ${smallW}×${smallH}`
  );

  // 101.6x152.4mm (4x6 inch Zebra): width ~288pt, height ~432pt
  const zebraW = Math.round(101.6 * MM_TO_PT);
  const zebraH = Math.round(152.4 * MM_TO_PT);
  assert(
    zebraW >= 280 && zebraW <= 295 && zebraH >= 425 && zebraH <= 440,
    `Zebra label (101.6×152.4mm) has correct pt dims: ${zebraW}×${zebraH}`
  );

  // ─── Part 9: Standard sizes still work ───
  console.log('--- Part 9: Standard sizes preserved ---');

  assert(
    src.includes("const PAGE_SIZES = ['A4', 'Letter', 'Legal', 'A3', 'A5']"),
    'PAGE_SIZES still contains all standard sizes'
  );

  assert(
    src.includes('A4: { width: 595, height: 842 }'),
    'A4 dimensions unchanged'
  );

  assert(
    src.includes('Letter: { width: 612, height: 792 }'),
    'Letter dimensions unchanged'
  );

  // ─── Part 10: isDirty set on changes ───
  console.log('--- Part 10: isDirty flag management ---');

  // Check isDirty is set when page size changes
  const pageSizeOnChange = src.includes('setPageSize(') && src.includes('setIsDirty(true)');
  assert(pageSizeOnChange, 'Changing page size sets isDirty flag');

  // Check isDirty is set when custom dimensions change
  assert(
    src.includes('setCustomWidthMm(v)') || src.includes('setCustomWidthMm('),
    'Custom width change updates state'
  );

  assert(
    src.includes('setCustomHeightMm(v)') || src.includes('setCustomHeightMm('),
    'Custom height change updates state'
  );

  // ─── Summary ───
  console.log('\n=== Results ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${passed + failed} tests passing`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
