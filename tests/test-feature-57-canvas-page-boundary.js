/**
 * Feature #57: Canvas page boundary with shadow
 * Page boundary matches paper size
 *
 * Steps:
 * 1. A4 shows correct proportions
 * 2. Switch to Letter - updates
 * 3. Drop shadow visible
 */
const http = require('http');

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
  console.log('\n🧪 Feature #57: Canvas page boundary with shadow\n');

  const html = await fetchPage(FRONTEND_URL);

  // ─── Step 1: A4 shows correct proportions ───
  console.log('Step 1: A4 shows correct proportions');

  test('canvas-page element exists', () => {
    assert(html.includes('data-testid="canvas-page"'), 'No canvas-page found');
  });

  test('default page size is A4', () => {
    assert(html.includes('data-page-size="A4"'), 'Default page size should be A4');
  });

  test('A4 width is 595 points', () => {
    assert(html.includes('data-page-width="595"'), 'A4 width should be 595 points');
  });

  test('A4 height is 842 points', () => {
    assert(html.includes('data-page-height="842"'), 'A4 height should be 842 points');
  });

  test('A4 aspect ratio is correct (portrait)', () => {
    // A4 aspect ratio = 595/842 ≈ 0.7066
    const match = html.match(/data-aspect-ratio="([^"]+)"/);
    assert(match, 'No aspect-ratio attribute found');
    const ratio = parseFloat(match[1]);
    assert(ratio > 0.70 && ratio < 0.71, `A4 aspect ratio should be ~0.7067, got ${ratio}`);
  });

  test('canvas-page has correct A4 pixel width at 100% zoom', () => {
    // At 100% zoom, width should be 595px
    const match = html.match(/data-testid="canvas-page"[^>]*style="[^"]*width:\s*([0-9.]+)px/);
    assert(match, 'No width style found on canvas-page');
    const w = parseFloat(match[1]);
    assert(w === 595, `Width at 100% should be 595, got ${w}`);
  });

  test('canvas-page has correct A4 pixel height at 100% zoom', () => {
    const match = html.match(/data-testid="canvas-page"[^>]*style="[^"]*height:\s*([0-9.]+)px/);
    assert(match, 'No height style found on canvas-page');
    const h = parseFloat(match[1]);
    assert(h === 842, `Height at 100% should be 842, got ${h}`);
  });

  // ─── Step 2: Page size dimensions in source code ───
  console.log('\nStep 2: Letter and other sizes available');

  // Read source to verify dimensions for all page sizes
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx'),
    'utf8'
  );

  test('PAGE_SIZE_DIMENSIONS has A4', () => {
    assert(src.includes('A4: { width: 595, height: 842 }'), 'A4 dimensions missing');
  });

  test('PAGE_SIZE_DIMENSIONS has Letter', () => {
    assert(src.includes('Letter: { width: 612, height: 792 }'), 'Letter dimensions missing');
  });

  test('PAGE_SIZE_DIMENSIONS has Legal', () => {
    assert(src.includes('Legal: { width: 612, height: 1008 }'), 'Legal dimensions missing');
  });

  test('PAGE_SIZE_DIMENSIONS has A3', () => {
    assert(src.includes('A3: { width: 842, height: 1191 }'), 'A3 dimensions missing');
  });

  test('PAGE_SIZE_DIMENSIONS has A5', () => {
    assert(src.includes('A5: { width: 420, height: 595 }'), 'A5 dimensions missing');
  });

  test('page size selector is present', () => {
    assert(html.includes('data-testid="page-size-selector"'), 'page-size-selector not found');
  });

  test('page-size selector has A4 option', () => {
    assert(html.includes('value="A4"') && html.includes('>A4</option>'), 'A4 option missing');
  });

  test('page-size selector has Letter option', () => {
    assert(html.includes('<option value="Letter">Letter</option>'), 'Letter option missing');
  });

  test('canvas page uses pageSize for width calculation', () => {
    assert(
      src.includes('PAGE_SIZE_DIMENSIONS[pageSize]?.width'),
      'Canvas width should use PAGE_SIZE_DIMENSIONS[pageSize]'
    );
  });

  test('canvas page uses pageSize for height calculation', () => {
    assert(
      src.includes('PAGE_SIZE_DIMENSIONS[pageSize]?.height'),
      'Canvas height should use PAGE_SIZE_DIMENSIONS[pageSize]'
    );
  });

  test('Letter width differs from A4 (612 vs 595)', () => {
    // Verify the dimensions are correct
    const a4Match = src.match(/A4:\s*\{\s*width:\s*(\d+)/);
    const letterMatch = src.match(/Letter:\s*\{\s*width:\s*(\d+)/);
    assert(a4Match && letterMatch, 'Could not parse dimensions');
    assert(parseInt(a4Match[1]) !== parseInt(letterMatch[1]), 'A4 and Letter should have different widths');
  });

  test('canvas page dimensions update dynamically with zoom', () => {
    assert(
      src.includes('(zoom / 100)') && src.includes('PAGE_SIZE_DIMENSIONS[pageSize]'),
      'Width should be multiplied by zoom factor'
    );
  });

  // ─── Step 3: Drop shadow visible ───
  console.log('\nStep 3: Drop shadow visible');

  test('canvas-page has box-shadow style', () => {
    // Extract style from the canvas-page element
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    assert(pageMatch[1].includes('box-shadow'), 'box-shadow not found in canvas-page style');
  });

  test('drop shadow has multiple layers for depth', () => {
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    const style = pageMatch[1];
    // Multiple shadow layers separated by commas
    const shadowParts = style.match(/box-shadow:([^;]+)/);
    assert(shadowParts, 'box-shadow property not found');
    const shadows = shadowParts[1].split(',');
    assert(shadows.length >= 2, `Should have multiple shadow layers, got ${shadows.length}`);
  });

  test('canvas-page has border for crisp edge', () => {
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    assert(pageMatch[1].includes('border:'), 'Border not found for crisp page edge');
  });

  test('canvas-page has white background (paper)', () => {
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    assert(
      pageMatch[1].includes('background-color:#ffffff') || pageMatch[1].includes('background-color: #ffffff'),
      'Background should be white (#ffffff)'
    );
  });

  test('canvas background is gray (contrast with paper)', () => {
    const canvasMatch = html.match(/data-testid="center-canvas"[^>]*style="([^"]*)"/);
    assert(canvasMatch, 'center-canvas style not found');
    assert(
      canvasMatch[1].includes('background-color:#e2e8f0') || canvasMatch[1].includes('background-color: #e2e8f0'),
      'Canvas background should be gray (#e2e8f0)'
    );
  });

  test('canvas page has position relative for element placement', () => {
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    assert(pageMatch[1].includes('position:relative') || pageMatch[1].includes('position: relative'), 'Position should be relative');
  });

  test('data-aspect-ratio attribute present on canvas page', () => {
    assert(html.includes('data-aspect-ratio='), 'data-aspect-ratio attribute not found');
  });

  test('page transition animation for smooth size changes', () => {
    const pageMatch = html.match(/data-testid="canvas-page"[^>]*style="([^"]*)"/);
    assert(pageMatch, 'canvas-page style not found');
    assert(pageMatch[1].includes('transition'), 'Transition should be present for smooth size changes');
  });

  // ─── Source code verification ───
  console.log('\nSource code verification:');

  test('aspect ratio calculated from dimensions', () => {
    assert(
      src.includes('data-aspect-ratio='),
      'data-aspect-ratio should be calculated'
    );
  });

  test('page boundary wrapped in ruler container', () => {
    assert(
      src.includes('canvas-ruler-container'),
      'canvas-ruler-container wrapper should exist'
    );
  });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
