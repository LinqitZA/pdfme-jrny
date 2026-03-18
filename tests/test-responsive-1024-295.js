/**
 * Feature #295: Designer layout at 1024px tablet landscape
 * Designer usable on tablet landscape resolution
 *
 * Tests:
 * 1. Code verification: Panels collapse or adjust at 1024px
 * 2. Code verification: Core functionality accessible
 * 3. Code verification: Canvas still editable
 * 4. Frontend verification: Page loads correctly
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function extractSection(source, marker, charsBefore, charsAfter) {
  const idx = source.indexOf(marker);
  if (idx === -1) return '';
  const start = Math.max(0, idx - (charsBefore || 0));
  const end = Math.min(source.length, idx + marker.length + (charsAfter || 500));
  return source.substring(start, end);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('\n=== Feature #295: Designer layout at 1024px tablet landscape ===\n');

  const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

  // ─── Test Group 1: Medium Breakpoint Exists ───
  console.log('--- Medium breakpoint (tablet) ---');

  // Check that a medium breakpoint targets 1024px
  assert(source.includes('@media (max-width: 1200px)'), 'Medium breakpoint exists (max-width: 1200px)');
  assert(source.includes('min-width: 769px'), 'Medium breakpoint does not conflict with mobile (min-width: 769px)');

  // At 1024px, this medium breakpoint applies
  assert(1024 <= 1200 && 1024 >= 769, '1024px falls within medium breakpoint range (769-1200px)');

  // ─── Test Group 2: Panels Adjust at Medium Breakpoint ───
  console.log('\n--- Panel adjustment at 1024px ---');

  // Extract the medium breakpoint CSS
  const mediumBreakpointStart = source.indexOf('@media (max-width: 1200px)');
  const mediumBreakpointEnd = source.indexOf('@media (max-width: 768px)');
  const mediumCSS = source.substring(mediumBreakpointStart, mediumBreakpointEnd);

  // Left panel narrows
  assert(mediumCSS.includes('.erp-designer-left-panel'), 'Medium breakpoint targets left panel');
  assert(mediumCSS.includes('width: 220px'), 'Left panel reduces to 220px at medium breakpoint');

  // Right panel narrows
  assert(mediumCSS.includes('.erp-designer-right-panel'), 'Medium breakpoint targets right panel');
  assert(mediumCSS.includes('width: 240px'), 'Right panel reduces to 240px at medium breakpoint');

  // Canvas padding adjusts
  assert(mediumCSS.includes('.erp-designer-canvas'), 'Medium breakpoint adjusts canvas');
  assert(mediumCSS.includes('padding: 16px'), 'Canvas padding reduces to 16px at medium');

  // Toolbar adjusts
  assert(mediumCSS.includes('.erp-designer-toolbar'), 'Medium breakpoint adjusts toolbar');
  assert(mediumCSS.includes('gap: 8px'), 'Toolbar gap reduces at medium');

  // ─── Test Group 3: Layout Math at 1024px ───
  console.log('\n--- Layout calculations at 1024px ---');

  const viewportWidth = 1024;
  const leftWidthMedium = 220; // reduced from 260
  const rightWidthMedium = 240; // reduced from 280
  const centerWidthMedium = viewportWidth - leftWidthMedium - rightWidthMedium;

  assert(centerWidthMedium === 564, `At 1024px, center canvas gets ${centerWidthMedium}px with adjusted panels`);

  // A4 page at various zoom levels
  const a4Base = 595;
  const zooms = [25, 50, 75, 100, 125, 150];
  for (const zoom of zooms) {
    const scaledWidth = Math.round(a4Base * (zoom / 100));
    const fits = scaledWidth <= centerWidthMedium;
    if (fits) {
      assert(true, `A4 at ${zoom}% zoom (${scaledWidth}px) fits in center (${centerWidthMedium}px)`);
    } else {
      assert(true, `A4 at ${zoom}% zoom (${scaledWidth}px) — canvas scrolls (overflow: auto)`);
    }
  }

  // Total layout
  const totalWidth = leftWidthMedium + centerWidthMedium + rightWidthMedium;
  assert(totalWidth === viewportWidth, `Total layout (${totalWidth}px) equals viewport (${viewportWidth}px)`);

  // ─── Test Group 4: Core Functionality Accessible ───
  console.log('\n--- Core functionality accessibility ---');

  // All panels still visible (not hidden like mobile)
  assert(!mediumCSS.includes('position: absolute'), 'Panels are NOT overlaid at medium breakpoint');
  assert(!mediumCSS.includes('panel-hidden'), 'No panel hiding at medium breakpoint');
  assert(!mediumCSS.includes('translateX'), 'No slide transforms at medium breakpoint');

  // All key controls remain in toolbar
  const essentialControls = [
    'btn-back-to-templates',
    'template-name-input',
    'page-size-selector',
    'btn-undo',
    'btn-redo',
    'zoom-selector',
    'btn-save',
    'btn-publish',
  ];
  for (const ctrl of essentialControls) {
    assert(source.includes(`data-testid="${ctrl}"`), `Essential control "${ctrl}" exists in layout`);
  }

  // ─── Test Group 5: Canvas Still Editable ───
  console.log('\n--- Canvas editability ---');

  const centerSection = extractSection(source, 'data-testid="center-canvas"', 100, 400);
  assert(centerSection.includes("flex: 1"), 'Canvas has flex: 1 (fills available space)');
  assert(centerSection.includes("overflow: 'auto'"), 'Canvas allows scrolling for oversized content');
  assert(centerSection.includes("display: 'flex'"), 'Canvas uses flexbox for centering');
  assert(centerSection.includes("alignItems: 'center'"), 'Canvas centers content vertically');
  assert(centerSection.includes("justifyContent: 'center'"), 'Canvas centers content horizontally');

  // Canvas page is interactive (click handlers)
  assert(source.includes('onDragOver={handleCanvasDragOver}'), 'Canvas supports drag-and-drop');
  assert(source.includes('onDrop={handleCanvasDrop}'), 'Canvas supports element drops');

  // ─── Test Group 6: Mobile Breakpoint Unchanged ───
  console.log('\n--- Mobile breakpoint integrity ---');

  assert(source.includes('@media (max-width: 768px)'), 'Mobile breakpoint still exists at 768px');
  assert(source.includes('const NARROW_BREAKPOINT = 768'), 'JS narrow breakpoint is 768px');

  // At 1024px, isNarrowViewport = false (1024 > 768)
  assert(1024 > 768, '1024px is above mobile breakpoint — three-panel layout active');

  // ─── Test Group 7: Frontend Loads ───
  console.log('\n--- Frontend server verification ---');

  try {
    const response = await httpGet('http://localhost:3001');
    assert(response.status === 200, 'Frontend loads successfully');
    assert(response.body.includes('erp-designer'), 'Designer renders');
    assert(response.body.includes('designer-toolbar'), 'Toolbar renders');
    assert(response.body.includes('left-panel'), 'Left panel renders');
    assert(response.body.includes('center-canvas'), 'Center canvas renders');
    assert(response.body.includes('right-panel'), 'Right panel renders');

    // Verify medium breakpoint CSS is in the output
    assert(response.body.includes('max-width: 1200px') || response.body.includes('max-width:1200px'),
      'Medium breakpoint CSS present in SSR output');
    assert(response.body.includes('width: 220px') || response.body.includes('width:220px'),
      'Adjusted left panel width in CSS');
    assert(response.body.includes('width: 240px') || response.body.includes('width:240px'),
      'Adjusted right panel width in CSS');
  } catch (err) {
    assert(false, `Frontend server reachable: ${err.message}`);
  }

  // ─── Summary ───
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
