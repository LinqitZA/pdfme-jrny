/**
 * Feature #58: Canvas rulers display and scale
 * Rulers along edges scale with zoom
 *
 * Steps:
 * 1. Horizontal ruler visible
 * 2. Vertical ruler visible
 * 3. Zoom - ruler adjusts
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
  console.log('\n🧪 Feature #58: Canvas rulers display and scale\n');

  const html = await fetchPage(FRONTEND_URL);
  const src = fs.readFileSync(
    path.resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx'),
    'utf8'
  );

  // ─── Step 1: Horizontal ruler visible ───
  console.log('Step 1: Horizontal ruler visible');

  test('horizontal ruler element exists', () => {
    assert(html.includes('data-testid="ruler-horizontal"'), 'ruler-horizontal not found');
  });

  test('horizontal ruler has aria-label', () => {
    assert(html.includes('aria-label="Horizontal ruler"'), 'Horizontal ruler aria-label missing');
  });

  test('horizontal ruler has data-zoom attribute', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*data-zoom="(\d+)"/);
    assert(match, 'ruler-horizontal data-zoom not found');
    assert(match[1] === '100', `Initial zoom should be 100, got ${match[1]}`);
  });

  test('horizontal ruler width matches page width at zoom', () => {
    // At 100% zoom with A4 (595pt), ruler width should be 595px
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('width:595px') || match[1].includes('width: 595px'),
      'Horizontal ruler width should match page width (595px at 100%)');
  });

  test('horizontal ruler has fixed height of 20px', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('height:20px') || match[1].includes('height: 20px'),
      'Ruler height should be 20px');
  });

  test('horizontal ruler has tick marks (mm labels)', () => {
    // Check that mm values (0, 10, 20...) appear in ruler
    // At A4 width (595pt ≈ 210mm), we should have ticks at 0, 10, 20, ... 200
    assert(html.includes('>0</span>') || html.includes('>10</span>') || html.includes('>20</span>'),
      'Ruler should have mm tick mark labels');
  });

  test('horizontal ruler has background color', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('background-color'), 'Ruler should have background color');
  });

  test('horizontal ruler has bottom border', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('border-bottom'), 'Ruler should have bottom border');
  });

  test('horizontal ruler is not selectable', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('user-select:none') || match[1].includes('user-select: none'),
      'Ruler text should not be selectable');
  });

  // ─── Step 2: Vertical ruler visible ───
  console.log('\nStep 2: Vertical ruler visible');

  test('vertical ruler element exists', () => {
    assert(html.includes('data-testid="ruler-vertical"'), 'ruler-vertical not found');
  });

  test('vertical ruler has aria-label', () => {
    assert(html.includes('aria-label="Vertical ruler"'), 'Vertical ruler aria-label missing');
  });

  test('vertical ruler has data-zoom attribute', () => {
    const match = html.match(/data-testid="ruler-vertical"[^>]*data-zoom="(\d+)"/);
    assert(match, 'ruler-vertical data-zoom not found');
    assert(match[1] === '100', `Initial zoom should be 100, got ${match[1]}`);
  });

  test('vertical ruler height matches page height at zoom', () => {
    // At 100% zoom with A4 (842pt), ruler height should be 842px
    const match = html.match(/data-testid="ruler-vertical"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-vertical style not found');
    assert(match[1].includes('height:842px') || match[1].includes('height: 842px'),
      'Vertical ruler height should match page height (842px at 100%)');
  });

  test('vertical ruler has fixed width of 20px', () => {
    const match = html.match(/data-testid="ruler-vertical"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-vertical style not found');
    assert(match[1].includes('width:20px') || match[1].includes('width: 20px'),
      'Ruler width should be 20px');
  });

  test('vertical ruler has right border', () => {
    const match = html.match(/data-testid="ruler-vertical"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-vertical style not found');
    assert(match[1].includes('border-right'), 'Vertical ruler should have right border');
  });

  test('vertical ruler is not selectable', () => {
    const match = html.match(/data-testid="ruler-vertical"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-vertical style not found');
    assert(match[1].includes('user-select:none') || match[1].includes('user-select: none'),
      'Ruler text should not be selectable');
  });

  test('ruler container wraps both rulers and page', () => {
    assert(html.includes('data-testid="canvas-ruler-container"'), 'canvas-ruler-container not found');
  });

  // ─── Step 3: Zoom - ruler adjusts ───
  console.log('\nStep 3: Zoom - ruler adjusts (source code verification)');

  test('ruler width uses zoom multiplication', () => {
    assert(
      src.includes('(PAGE_SIZE_DIMENSIONS[pageSize]?.width || 595) * (zoom / 100)'),
      'Horizontal ruler width should scale with zoom'
    );
  });

  test('ruler height uses zoom multiplication', () => {
    assert(
      src.includes('(PAGE_SIZE_DIMENSIONS[pageSize]?.height || 842) * (zoom / 100)'),
      'Vertical ruler height should scale with zoom'
    );
  });

  test('ruler tick positions use zoom multiplication for horizontal ticks', () => {
    assert(
      src.includes('ptPos * scale') || src.includes('px = ptPos * scale'),
      'Horizontal tick positions should scale with zoom'
    );
  });

  test('ruler tick positions use zoom multiplication for vertical ticks', () => {
    // Source uses same pattern for both
    assert(
      src.includes('midPt * scale'),
      'Mid-tick positions should scale with zoom'
    );
  });

  test('zoom selector is available in toolbar', () => {
    assert(html.includes('data-testid="zoom-selector"'), 'Zoom selector not found');
  });

  test('zoom levels include standard values', () => {
    assert(
      src.includes('ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200]'),
      'Standard zoom levels should be available in ZOOM_LEVELS'
    );
  });

  test('rulers use mm units for tick labels', () => {
    assert(
      src.includes('MM_TO_PT') || src.includes('mm = Math.round(ptPos / MM_TO_PT)'),
      'Rulers should convert points to mm for labels'
    );
  });

  test('rulers have major ticks every 10mm', () => {
    assert(
      src.includes('mmStep = 10'),
      'Major tick marks should be every 10mm'
    );
  });

  test('rulers have minor ticks every 5mm', () => {
    assert(
      src.includes('ptStep / 2') || src.includes('midPt = ptPos + (ptStep / 2)'),
      'Minor tick marks should be at 5mm intervals (midpoint of 10mm)'
    );
  });

  test('ruler data-zoom attribute reflects current zoom state', () => {
    assert(
      src.includes('data-zoom={zoom}'),
      'Rulers should have data-zoom={zoom} attribute'
    );
  });

  test('horizontal ruler has marginLeft for vertical ruler alignment', () => {
    const match = html.match(/data-testid="ruler-horizontal"[^>]*style="([^"]*)"/);
    assert(match, 'ruler-horizontal style not found');
    assert(match[1].includes('margin-left:20px') || match[1].includes('margin-left: 20px'),
      'Horizontal ruler should be offset by vertical ruler width (20px)');
  });

  test('rulers positioned inside canvas-ruler-container', () => {
    // Verify structural relationship
    const containerIdx = html.indexOf('canvas-ruler-container');
    const hRulerIdx = html.indexOf('ruler-horizontal');
    const vRulerIdx = html.indexOf('ruler-vertical');
    const pageIdx = html.indexOf('canvas-page');
    assert(containerIdx < hRulerIdx, 'Horizontal ruler should be inside container');
    assert(containerIdx < vRulerIdx, 'Vertical ruler should be inside container');
    assert(hRulerIdx < vRulerIdx, 'Horizontal ruler should come before vertical');
    assert(vRulerIdx < pageIdx, 'Vertical ruler should come before page');
  });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
