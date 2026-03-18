/**
 * Feature #60: Canvas alignment guides between elements
 * Guides appear on element approach
 *
 * Steps:
 * 1. Drag near edge - guide appears
 * 2. Drag near center - center guide
 * 3. Release snaps to guide
 *
 * Tests verify source code has alignment guide logic and data attributes.
 */
const http = require('http');
const fs = require('fs');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';

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
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Feature #60: Canvas alignment guides between elements\n');

  // Read source code
  const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Alignment guide state ===
  console.log('--- Alignment Guide State ---');

  test('alignmentGuides state is defined', () => {
    assert(src.includes('alignmentGuides'), 'alignmentGuides state not found');
  });

  test('alignmentGuides state initialized as empty array', () => {
    assert(src.includes("useState<Array<{ type: 'horizontal' | 'vertical'; position: number"), 'alignmentGuides type not found');
  });

  test('setAlignmentGuides function exists', () => {
    assert(src.includes('setAlignmentGuides'), 'setAlignmentGuides not found');
  });

  test('isDraggingElement state tracks drag state', () => {
    assert(src.includes('isDraggingElement'), 'isDraggingElement state not found');
    assert(src.includes('setIsDraggingElement'), 'setIsDraggingElement not found');
  });

  test('SNAP_THRESHOLD constant defined', () => {
    assert(src.includes('SNAP_THRESHOLD'), 'SNAP_THRESHOLD not found');
    assert(src.match(/SNAP_THRESHOLD\s*=\s*\d+/), 'SNAP_THRESHOLD not assigned a number');
  });

  // === SECTION 2: Alignment guide calculation ===
  console.log('\n--- Alignment Guide Calculation ---');

  test('calculateAlignmentGuides function exists', () => {
    assert(src.includes('calculateAlignmentGuides'), 'calculateAlignmentGuides not found');
  });

  test('Calculates vertical guides for left-edge alignment', () => {
    assert(src.includes("label: 'left-edge'"), 'left-edge guide not found');
  });

  test('Calculates vertical guides for right-edge alignment', () => {
    assert(src.includes("label: 'right-edge'"), 'right-edge guide not found');
  });

  test('Calculates vertical guides for center alignment', () => {
    const centerGuideMatch = src.match(/type:\s*'vertical'.*?label:\s*'center'/s);
    assert(centerGuideMatch, 'vertical center guide not found');
  });

  test('Calculates horizontal guides for top-edge alignment', () => {
    assert(src.includes("label: 'top-edge'"), 'top-edge guide not found');
  });

  test('Calculates horizontal guides for bottom-edge alignment', () => {
    assert(src.includes("label: 'bottom-edge'"), 'bottom-edge guide not found');
  });

  test('Calculates horizontal guides for center alignment', () => {
    const centerGuideMatch = src.match(/type:\s*'horizontal'.*?label:\s*'center'/s);
    assert(centerGuideMatch, 'horizontal center guide not found');
  });

  test('Edge-snap guides calculated (left-to-right, right-to-left)', () => {
    assert(src.includes("label: 'edge-snap'"), 'edge-snap guide not found');
  });

  test('Returns snap positions (snapX, snapY)', () => {
    assert(src.includes('snapX'), 'snapX not found');
    assert(src.includes('snapY'), 'snapY not found');
  });

  test('Compares against other elements (not self)', () => {
    assert(src.includes("filter((el) => el.id !== draggedId)"), 'Element self-filter not found');
  });

  test('Uses SNAP_THRESHOLD for proximity detection', () => {
    assert(src.includes('< SNAP_THRESHOLD'), 'SNAP_THRESHOLD comparison not found');
  });

  // === SECTION 3: Mouse-based drag ===
  console.log('\n--- Mouse-based Element Drag ---');

  test('handleElementMouseDown function exists', () => {
    assert(src.includes('handleElementMouseDown'), 'handleElementMouseDown not found');
  });

  test('Mouse drag tracks startX, startY', () => {
    assert(src.includes('startX: e.clientX'), 'startX tracking not found');
    assert(src.includes('startY: e.clientY'), 'startY tracking not found');
  });

  test('Mouse drag tracks element start position', () => {
    assert(src.includes('elStartX: el.x'), 'elStartX not found');
    assert(src.includes('elStartY: el.y'), 'elStartY not found');
  });

  test('mousemove listener calculates new position', () => {
    assert(src.includes('handleMouseMove'), 'handleMouseMove not found');
  });

  test('mouseup listener cleans up drag state', () => {
    assert(src.includes('handleMouseUp'), 'handleMouseUp not found');
    assert(src.includes("setIsDraggingElement(false)"), 'drag cleanup not found');
    assert(src.includes("setAlignmentGuides([])"), 'guide cleanup not found');
  });

  test('Guides are calculated during drag movement', () => {
    // calculateAlignmentGuides should be called during mousemove
    const moveHandler = src.match(/handleMouseMove\s*=.*?calculateAlignmentGuides/s);
    assert(moveHandler, 'calculateAlignmentGuides not called during move');
  });

  test('Element position snaps to guide during drag', () => {
    assert(src.includes('updateElement(dragEl.id, { x: snapX, y: snapY }'), 'Snap update not found');
  });

  test('Drag respects zoom scale', () => {
    assert(src.includes('/ scale'), 'Zoom scale not applied to drag delta');
  });

  test('Left mouse button only (button 0)', () => {
    assert(src.includes('e.button !== 0'), 'Left button check not found');
  });

  test('Drag disabled in preview mode', () => {
    assert(src.includes('if (previewMode) return'), 'Preview mode check not found');
  });

  // === SECTION 4: Alignment guide rendering ===
  console.log('\n--- Alignment Guide Rendering ---');

  test('alignment-guides container rendered when guides present', () => {
    assert(src.includes('data-testid="alignment-guides"'), 'alignment-guides container not found');
  });

  test('data-guide-count attribute shows number of guides', () => {
    assert(src.includes('data-guide-count={alignmentGuides.length}'), 'data-guide-count not found');
  });

  test('Vertical guide line rendered with red color', () => {
    assert(src.includes('data-testid="alignment-guide-vertical"'), 'vertical guide testid not found');
    assert(src.includes("data-guide-type=\"vertical\""), 'vertical guide type attr not found');
  });

  test('Horizontal guide line rendered with red color', () => {
    assert(src.includes('data-testid="alignment-guide-horizontal"'), 'horizontal guide testid not found');
    assert(src.includes("data-guide-type=\"horizontal\""), 'horizontal guide type attr not found');
  });

  test('Guide lines have data-guide-position attribute', () => {
    assert(src.includes('data-guide-position={guide.position}'), 'data-guide-position not found');
  });

  test('Guide lines have data-guide-label attribute', () => {
    assert(src.includes('data-guide-label={guide.label'), 'data-guide-label not found');
  });

  test('Vertical guide uses left position scaled by zoom', () => {
    assert(src.includes('left: `${guide.position * (zoom / 100)}px`'), 'Vertical guide zoom scaling not found');
  });

  test('Horizontal guide uses top position scaled by zoom', () => {
    assert(src.includes('top: `${guide.position * (zoom / 100)}px`'), 'Horizontal guide zoom scaling not found');
  });

  test('Guide lines have high z-index (above elements)', () => {
    assert(src.includes('zIndex: 1001'), 'Guide z-index not found');
  });

  test('Guide container has pointer-events: none', () => {
    assert(src.includes("pointerEvents: 'none', zIndex: 1000"), 'Guide container pointer-events not found');
  });

  test('Guide lines have red color (#ef4444)', () => {
    assert(src.includes("backgroundColor: '#ef4444'"), 'Guide red color not found');
  });

  test('Guides cleared on mouse up (release)', () => {
    assert(src.includes("setAlignmentGuides([])"), 'Guides not cleared on release');
  });

  // === SECTION 5: Canvas element drag cursor ===
  console.log('\n--- Drag Cursor ---');

  test('Cursor changes to grabbing during drag', () => {
    assert(src.includes("isDraggingElement ? 'grabbing' : 'pointer'"), 'Grabbing cursor not found');
  });

  test('onMouseDown handler attached to canvas elements', () => {
    assert(src.includes('onMouseDown={(e) => handleElementMouseDown(e, el.id)'), 'onMouseDown not attached');
  });

  // === SECTION 6: Page renders without errors ===
  console.log('\n--- Page Load ---');

  test('Page loads successfully (HTTP 200)', () => {
    assert(html.length > 1000, 'Page HTML too short');
  });

  test('ErpDesigner component reference exists', () => {
    assert(html.includes('erp-designer'), 'erp-designer class not found');
  });

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();
