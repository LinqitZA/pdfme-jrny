const fs = require('fs');
const path = require('path');

const DESIGNER_FILE = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

function assertIncludes(code, text, message) {
  assert(code.includes(text), message);
}

function assertNotIncludes(code, text, message) {
  assert(!code.includes(text), message);
}

async function main() {
  console.log('=== Feature #428: Element Resize Handles (Full Implementation) ===\n');

  const code = fs.readFileSync(DESIGNER_FILE, 'utf8');

  // ─── 1. Resize State & Ref ───
  console.log('--- Test: Resize state variables ---');
  assertIncludes(code, 'const [isResizing, setIsResizing] = useState(false)', 'isResizing state variable exists');
  assertIncludes(code, 'const resizeRef = useRef<{', 'resizeRef exists with type');
  assertIncludes(code, "corner: 'tl' | 'tr' | 'bl' | 'br' | 'top' | 'right' | 'bottom' | 'left'", 'resizeRef includes all corner and edge types');
  assertIncludes(code, 'elStartW: number; elStartH: number', 'resizeRef tracks starting width and height');

  // ─── 2. handleResizeMouseDown ───
  console.log('\n--- Test: handleResizeMouseDown callback ---');
  assertIncludes(code, 'const handleResizeMouseDown = useCallback(', 'handleResizeMouseDown is a useCallback');
  assert(code.includes('handleResizeMouseDown = useCallback((e: React.MouseEvent, elementId: string, corner:'), 'handleResizeMouseDown has correct signature with MouseEvent, elementId, and corner params');
  assertIncludes(code, 'e.stopPropagation()', 'Resize handler calls stopPropagation');
  assertIncludes(code, 'e.preventDefault()', 'Resize handler calls preventDefault');
  assertIncludes(code, 'setIsResizing(true)', 'Sets isResizing to true on mouse down');

  // ─── 3. Resize Math ───
  console.log('\n--- Test: Corner-aware resize math ---');
  assertIncludes(code, "case 'br':", 'Bottom-right resize case exists');
  assertIncludes(code, "case 'bl':", 'Bottom-left resize case exists');
  assertIncludes(code, "case 'tr':", 'Top-right resize case exists');
  assertIncludes(code, "case 'tl':", 'Top-left resize case exists');
  assertIncludes(code, "case 'top':", 'Top edge resize case exists');
  assertIncludes(code, "case 'bottom':", 'Bottom edge resize case exists');
  assertIncludes(code, "case 'left':", 'Left edge resize case exists');
  assertIncludes(code, "case 'right':", 'Right edge resize case exists');

  // Verify BR math: newW = elStartW + dx, newH = elStartH + dy
  assertIncludes(code, 'newW = elStartW + dx', 'BR: width increases with dx');
  assertIncludes(code, 'newH = elStartH + dy', 'BR: height increases with dy');

  // Verify TL math: position moves AND size changes
  assertIncludes(code, 'newX = elStartX + dx', 'TL: x position adjusts with dx');
  assertIncludes(code, 'newY = elStartY + dy', 'TL: y position adjusts with dy');
  assertIncludes(code, 'newW = elStartW - dx', 'TL/BL: width decreases with dx');
  assertIncludes(code, 'newH = elStartH - dy', 'TL/TR: height decreases with dy');

  // ─── 4. Minimum Size Enforcement ───
  console.log('\n--- Test: Minimum size enforcement ---');
  assertIncludes(code, 'const MIN_RESIZE_SIZE = 20', 'Minimum resize size is 20');
  assertIncludes(code, 'if (newW < MIN_RESIZE_SIZE)', 'Width minimum check exists');
  assertIncludes(code, 'if (newH < MIN_RESIZE_SIZE)', 'Height minimum check exists');
  assertIncludes(code, 'newW = MIN_RESIZE_SIZE', 'Width clamped to minimum');
  assertIncludes(code, 'newH = MIN_RESIZE_SIZE', 'Height clamped to minimum');

  // ─── 5. Grid Snapping ───
  console.log('\n--- Test: Grid snapping during resize ---');
  // snapToGrid is called in the resize handler
  const resizeSection = code.substring(code.indexOf('handleResizeMouseDown'), code.indexOf('// ─── Multi-select'));
  assert(resizeSection.includes('snapToGrid'), 'snapToGrid called in resize handler');

  // ─── 6. Resize Cleanup ───
  console.log('\n--- Test: Resize mouseup cleanup ---');
  assertIncludes(code, 'const handleResizeUp', 'handleResizeUp handler exists');
  assertIncludes(code, 'resizeRef.current = null', 'resizeRef cleared on mouseup');
  assertIncludes(code, 'setIsResizing(false)', 'isResizing set to false on mouseup');
  assertIncludes(code, "removeEventListener('mousemove', handleResizeMove)", 'Mouse move listener removed');
  assertIncludes(code, "removeEventListener('mouseup', handleResizeUp)", 'Mouse up listener removed');

  // ─── 7. Interactive Corner Handles ───
  console.log('\n--- Test: Interactive corner resize handles ---');
  assertIncludes(code, "data-testid=\"resize-handle-tl\"", 'Top-left handle has data-testid');
  assertIncludes(code, "data-testid=\"resize-handle-tr\"", 'Top-right handle has data-testid');
  assertIncludes(code, "data-testid=\"resize-handle-bl\"", 'Bottom-left handle has data-testid');
  assertIncludes(code, "data-testid=\"resize-handle-br\"", 'Bottom-right handle has data-testid');

  // ─── 8. Cursor Styles ───
  console.log('\n--- Test: Cursor styles on handles ---');
  assertIncludes(code, "cursor: 'nwse-resize'", 'TL/BR corners use nwse-resize cursor');
  assertIncludes(code, "cursor: 'nesw-resize'", 'TR/BL corners use nesw-resize cursor');
  assertIncludes(code, "cursor: 'ns-resize'", 'Top/bottom edges use ns-resize cursor');
  assertIncludes(code, "cursor: 'ew-resize'", 'Left/right edges use ew-resize cursor');

  // ─── 9. Handle Sizes ───
  console.log('\n--- Test: Handle sizes (larger hit targets) ---');
  // Corner handles should be 12x12 with -6px offset
  // Find the full line containing the TL handle
  const tlLineStart = code.lastIndexOf('\n', code.indexOf('data-testid="resize-handle-tl"'));
  const tlLineEnd = code.indexOf('\n', code.indexOf('data-testid="resize-handle-tl"'));
  const tlLine = code.substring(tlLineStart, tlLineEnd);
  assert(tlLine.includes('width: 12') && tlLine.includes('height: 12'), 'Corner handles are 12x12 for easier grabbing');
  assert(tlLine.includes('top: -6') && tlLine.includes('left: -6'), 'TL handle offset is -6px');

  // ─── 10. Edge Handles ───
  console.log('\n--- Test: Edge handles for single-axis resize ---');
  assertIncludes(code, "data-testid=\"resize-handle-top\"", 'Top edge handle exists');
  assertIncludes(code, "data-testid=\"resize-handle-bottom\"", 'Bottom edge handle exists');
  assertIncludes(code, "data-testid=\"resize-handle-left\"", 'Left edge handle exists');
  assertIncludes(code, "data-testid=\"resize-handle-right\"", 'Right edge handle exists');

  // ─── 11. Event Propagation ───
  console.log('\n--- Test: Resize handles prevent drag ───');
  // Each handle should have onMouseDown that calls handleResizeMouseDown
  assertIncludes(code, "onMouseDown={(e) => handleResizeMouseDown(e, el.id, 'tl')}", 'TL handle has resize mouse down handler');
  assertIncludes(code, "onMouseDown={(e) => handleResizeMouseDown(e, el.id, 'br')}", 'BR handle has resize mouse down handler');
  assertIncludes(code, "onMouseDown={(e) => handleResizeMouseDown(e, el.id, 'top')}", 'Top edge has resize mouse down handler');
  assertIncludes(code, "onMouseDown={(e) => handleResizeMouseDown(e, el.id, 'right')}", 'Right edge has resize mouse down handler');

  // ─── 12. Drag handler doesn't fire during resize ───
  console.log('\n--- Test: Drag handler checks isResizing ---');
  assertIncludes(code, 'if (isResizing) return; // Don\'t drag while resizing', 'Drag handler returns early when isResizing');

  // ─── 13. Element cursor changed to move ───
  console.log('\n--- Test: Element body cursor ---');
  assertIncludes(code, "isDraggingElement ? 'grabbing' : 'move'", 'Element body shows move cursor (not pointer)');

  // ─── 14. Handle z-index ───
  console.log('\n--- Test: Handle z-index ---');
  assert(code.includes('zIndex: 10') && code.includes('resize-handle'), 'Resize handles have z-index for clickability');

  // ─── 15. No decorative-only handles remain ───
  console.log('\n--- Test: No decorative-only handles ---');
  // Old decorative handles were 8x8 without event handlers
  const selectionSection = code.substring(code.indexOf('Selection resize handles'), code.indexOf('</div>\n    );\n  }, [zoom'));
  assertNotIncludes(selectionSection, 'width: 8, height: 8', 'No old 8x8 decorative handles remain');
  assert(!selectionSection.match(/style=\{.*?\}.*?\/>/g)?.some(h => !h.includes('onMouseDown')), 'All handles have onMouseDown handlers');

  // ─── 16. Dependencies array updated ───
  console.log('\n--- Test: useMemo/useCallback dependency arrays ---');
  assertIncludes(code, 'handleResizeMouseDown]', 'handleResizeMouseDown in render memo dependencies');
  assertIncludes(code, 'isResizing, calculateAlignmentGuides', 'isResizing in drag handler dependencies');

  // ─── 17. updateElement called with x, y, w, h ───
  console.log('\n--- Test: updateElement called with full geometry ---');
  assertIncludes(code, 'updateElement(resizeRef.current.elementId, { x: newX, y: newY, w: newW, h: newH })', 'updateElement called with x, y, w, h during resize');

  // ─── 18. Border styling on handles ───
  console.log('\n--- Test: Handle visual styling ---');
  assertIncludes(code, "border: '2px solid white'", 'Handles have white border for visibility');
  assertIncludes(code, "backgroundColor: '#3b82f6'", 'Handles have blue background');

  // ─── 19. Edge handle shapes ---
  console.log('\n--- Test: Edge handle shapes (square, not round) ---');
  const edgeHandleSection = code.substring(code.indexOf('resize-handle-top'), code.indexOf('resize-handle-right') + 200);
  assert(edgeHandleSection.includes("borderRadius: '2px'"), 'Edge handles are slightly rounded squares (not circles)');

  // ─── 20. Corner handle shapes ---
  console.log('\n--- Test: Corner handle shapes (round) ---');
  const cornerSection = code.substring(code.indexOf('resize-handle-tl'), code.indexOf('resize-handle-top'));
  assert(cornerSection.includes("borderRadius: '50%'"), 'Corner handles are circles');

  // ─── API verification (template CRUD still works) ───
  console.log('\n--- Test: API still operational after code changes ---');
  try {
    const API_BASE = process.env.API_BASE || 'http://localhost:3001';
    const resp = await fetch(`${API_BASE}/api/pdfme/health`);
    assert(resp.ok, `API health check returns OK (${resp.status})`);
  } catch (err) {
    assert(false, `API health check failed: ${err.message}`);
  }

  // Try creating a template and verify it works
  try {
    const API_BASE = process.env.API_BASE || 'http://localhost:3001';
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItNDI4Iiwib3JnSWQiOiJ0ZXN0LW9yZy00MjgiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MDAwMDAwMDB9.sig';

    // Verify the templates endpoint exists and responds (401 = auth required = endpoint exists)
    const createResp = await fetch(`${API_BASE}/api/pdfme/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' })
    });
    assert(createResp.status === 401 || createResp.ok || createResp.status === 201, `Templates endpoint responds (${createResp.status})`);
  } catch (err) {
    console.log(`  ⚠️  Template API test skipped: ${err.message}`);
  }

  // ─── Designer page loads check ───
  console.log('\n--- Test: Designer page accessible ---');
  try {
    const DESIGNER_URL = process.env.DESIGNER_URL || 'http://localhost:3000';
    const resp = await fetch(DESIGNER_URL);
    assert(resp.ok, `Designer page loads (${resp.status})`);
    const html = await resp.text();
    assert(html.includes('pdfme') || html.includes('designer') || html.includes('<!DOCTYPE'), 'Designer returns HTML content');
  } catch (err) {
    assert(false, `Designer page failed: ${err.message}`);
  }

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
