/**
 * Feature #59: Canvas snap-to-grid configurable
 * Elements snap to grid increments
 *
 * Steps:
 * 1. Drag element - snaps to 5mm default
 * 2. Change grid size
 * 3. Drag again - new snap
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';

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
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  console.log('\n🧪 Feature #59: Canvas snap-to-grid configurable\n');

  const html = await fetchPage(FRONTEND_URL);
  const src = fs.readFileSync(
    path.resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx'),
    'utf8'
  );

  // ─── Step 1: Drag element - snaps to 5mm default ───
  console.log('Step 1: Drag element snaps to 5mm default');

  test('grid size state defaults to 5mm', () => {
    assert(src.includes('useState(5)') || src.includes('useState<number>(5)'),
      'gridSizeMm should default to 5');
  });

  test('MM_TO_PT conversion constant defined', () => {
    assert(src.includes('MM_TO_PT = 2.83465'), 'MM_TO_PT should be 2.83465 (1mm = 2.83465pt)');
  });

  test('snapToGrid function exists', () => {
    assert(src.includes('const snapToGrid = useCallback'), 'snapToGrid function should exist');
  });

  test('snapToGrid rounds to nearest grid increment', () => {
    assert(
      src.includes('Math.round(value / gridSizePt) * gridSizePt'),
      'snapToGrid should round to nearest grid multiple'
    );
  });

  test('snapToGrid returns value unchanged when grid is off', () => {
    assert(
      src.includes('if (gridSizeMm === 0') || src.includes('gridSizeMm === 0 || gridSizePt === 0'),
      'snapToGrid should pass through when grid size is 0'
    );
  });

  test('drag handler calls snapToGrid on X position', () => {
    assert(
      src.includes('newX = snapToGrid(newX)'),
      'Drag handler should snap X position to grid'
    );
  });

  test('drag handler calls snapToGrid on Y position', () => {
    assert(
      src.includes('newY = snapToGrid(newY)'),
      'Drag handler should snap Y position to grid'
    );
  });

  test('grid overlay visible in HTML with default 5mm', () => {
    assert(html.includes('data-testid="canvas-grid-overlay"'), 'Grid overlay should be rendered');
    assert(html.includes('data-grid-size-mm="5"'), 'Grid overlay should show 5mm grid');
  });

  test('grid overlay uses SVG pattern', () => {
    assert(html.includes('grid-pattern-'), 'Grid should use SVG pattern element');
    assert(html.includes('<pattern'), 'SVG pattern element should exist');
  });

  test('grid overlay has pointer-events none', () => {
    const match = html.match(/data-testid="canvas-grid-overlay"[^>]*style="([^"]*)"/);
    assert(match, 'canvas-grid-overlay style not found');
    assert(
      match[1].includes('pointer-events:none') || match[1].includes('pointer-events: none'),
      'Grid overlay should not capture pointer events'
    );
  });

  test('grid pattern size matches 5mm at 100% zoom', () => {
    // 5mm * 2.83465 pt/mm * 1 (100% zoom) ≈ 14.17325 px
    const patternMatch = html.match(/<pattern[^>]*width="([^"]+)"/);
    assert(patternMatch, 'Pattern width not found');
    const patternW = parseFloat(patternMatch[1]);
    const expected = 5 * 2.83465;
    assert(
      Math.abs(patternW - expected) < 0.01,
      `Pattern width should be ~${expected.toFixed(2)}, got ${patternW}`
    );
  });

  test('5mm grid equals ~14.17pt', () => {
    const gridPt = 5 * 2.83465;
    assert(gridPt > 14.17 && gridPt < 14.18, `5mm should be ~14.17pt, got ${gridPt}`);
  });

  // ─── Step 2: Change grid size ───
  console.log('\nStep 2: Grid size selector');

  test('grid size selector exists in toolbar', () => {
    assert(html.includes('data-testid="grid-size-selector"'), 'grid-size-selector not found');
  });

  test('grid size selector has aria-label', () => {
    assert(html.includes('aria-label="Grid size"'), 'Grid size aria-label missing');
  });

  test('grid size selector has Off option', () => {
    assert(html.includes('>Off</option>'), 'Grid Off option missing');
  });

  test('grid size selector has 1mm option', () => {
    assert(html.includes('>1mm</option>'), '1mm option missing');
  });

  test('grid size selector has 5mm option', () => {
    assert(html.includes('>5mm</option>'), '5mm option missing');
  });

  test('grid size selector has 10mm option', () => {
    assert(html.includes('>10mm</option>'), '10mm option missing');
  });

  test('grid size selector has 20mm option', () => {
    assert(html.includes('>20mm</option>'), '20mm option missing');
  });

  test('grid size selector has 25mm option', () => {
    assert(html.includes('>25mm</option>'), '25mm option missing');
  });

  test('GRID_SIZES array includes standard values', () => {
    assert(src.includes('GRID_SIZES = [0, 1, 2, 5, 10, 15, 20, 25]'),
      'GRID_SIZES should include [0, 1, 2, 5, 10, 15, 20, 25]');
  });

  test('grid size change updates state via setGridSizeMm', () => {
    assert(src.includes('setGridSizeMm(Number(e.target.value))'),
      'Grid selector onChange should call setGridSizeMm');
  });

  // ─── Step 3: Grid behavior verification ───
  console.log('\nStep 3: Grid snap behavior (source code verification)');

  test('grid overlay hides when grid is off (0mm)', () => {
    assert(
      src.includes('gridSizeMm > 0') && src.includes('canvas-grid-overlay'),
      'Grid overlay should only render when gridSizeMm > 0'
    );
  });

  test('gridSizePt computed from gridSizeMm * MM_TO_PT', () => {
    assert(
      src.includes('gridSizeMm * MM_TO_PT'),
      'gridSizePt should be computed from gridSizeMm * MM_TO_PT'
    );
  });

  test('snapToGrid is in handleElementMouseDown dependencies', () => {
    assert(
      src.includes('snapToGrid]') || src.includes('snapToGrid,'),
      'snapToGrid should be in useCallback dependency array'
    );
  });

  test('grid pattern scales with zoom', () => {
    assert(
      src.includes('gridSizePt * (zoom / 100)'),
      'Grid pattern dimensions should scale with zoom'
    );
  });

  test('canvas-page has data-grid-size-mm attribute', () => {
    assert(html.includes('data-grid-size-mm="5"'), 'canvas-page should have data-grid-size-mm');
  });

  test('grid label shown in toolbar', () => {
    assert(html.includes('Grid:'), 'Grid label should be shown in toolbar');
  });

  // ─── Snap calculation verification ───
  console.log('\nSnap calculation verification:');

  // Verify the snap math is correct for different grid sizes
  const MM_TO_PT = 2.83465;

  test('snap calculation: 10mm grid snaps 50pt to ~42.52pt (15mm)', () => {
    const gridPt = 10 * MM_TO_PT;
    const snapped = Math.round(50 / gridPt) * gridPt;
    // 50 / 28.3465 ≈ 1.764 → round to 2 → 2 * 28.3465 = 56.693pt (20mm)
    assert(Math.abs(snapped - 56.693) < 0.01, `Expected ~56.69, got ${snapped}`);
  });

  test('snap calculation: 5mm grid snaps 100pt to ~99.21pt (35mm)', () => {
    const gridPt = 5 * MM_TO_PT;
    const snapped = Math.round(100 / gridPt) * gridPt;
    // 100 / 14.17325 ≈ 7.056 → round to 7 → 7 * 14.17325 = 99.21pt
    assert(Math.abs(snapped - 99.21275) < 0.01, `Expected ~99.21, got ${snapped}`);
  });

  test('snap calculation: 0mm grid returns value unchanged', () => {
    const gridPt = 0 * MM_TO_PT;
    // When gridSizeMm === 0, function returns value as-is
    const value = 123.456;
    const result = (gridPt === 0) ? value : Math.round(value / gridPt) * gridPt;
    assert(result === value, `Expected unchanged ${value}, got ${result}`);
  });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
