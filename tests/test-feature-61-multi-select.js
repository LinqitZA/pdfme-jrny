/**
 * Feature #61: Canvas multi-select with modifier key
 * Multiple elements selected
 *
 * Steps:
 * 1. Click first element
 * 2. Cmd/Ctrl+click second
 * 3. Both selected
 * 4. Click empty - deselected
 *
 * Tests verify source code has multi-select logic and data attributes.
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
  console.log('Feature #61: Canvas multi-select with modifier key\n');

  const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Multi-select state ===
  console.log('--- Multi-select State ---');

  test('selectedElementIds state array is defined', () => {
    assert(src.includes('selectedElementIds'), 'selectedElementIds not found');
    assert(src.includes('setSelectedElementIds'), 'setSelectedElementIds not found');
  });

  test('selectedElementIds initialized as empty array', () => {
    assert(src.includes("useState<string[]>([])"), 'selectedElementIds init not found');
  });

  test('handleElementClick function exists', () => {
    assert(src.includes('handleElementClick'), 'handleElementClick not found');
  });

  // === SECTION 2: Modifier key detection ===
  console.log('\n--- Modifier Key Detection ---');

  test('Ctrl key detected for multi-select', () => {
    assert(src.includes('e.ctrlKey'), 'ctrlKey check not found');
  });

  test('Meta key (Cmd) detected for multi-select', () => {
    assert(src.includes('e.metaKey'), 'metaKey check not found');
  });

  test('Modifier check combines ctrlKey and metaKey', () => {
    assert(src.includes('e.ctrlKey || e.metaKey'), 'ctrlKey || metaKey not found');
  });

  test('isModifier variable captures modifier state', () => {
    assert(src.includes('const isModifier = e.ctrlKey || e.metaKey'), 'isModifier variable not found');
  });

  // === SECTION 3: Multi-select toggle behavior ===
  console.log('\n--- Multi-select Toggle ---');

  test('Modifier+click toggles element in selection', () => {
    assert(src.includes('if (isModifier)'), 'isModifier branch not found');
  });

  test('Can add element to multi-selection', () => {
    assert(src.includes('[...currentIds, elementId]'), 'Add to selection not found');
  });

  test('Can remove element from multi-selection (toggle off)', () => {
    assert(src.includes('currentIds.filter((id) => id !== elementId)'), 'Remove from selection not found');
  });

  test('Single click (no modifier) selects only one element', () => {
    assert(src.includes('setSelectedElementIds([elementId])'), 'Single select reset not found');
  });

  test('Primary selectedElementId updated on multi-select', () => {
    // When adding, primary becomes the new element; when removing, last remaining
    assert(src.includes('setSelectedElementId(elementId)'), 'Primary selection update not found');
  });

  // === SECTION 4: Deselect all ===
  console.log('\n--- Deselect All ---');

  test('handleCanvasBackgroundClick deselects all', () => {
    assert(src.includes('handleCanvasBackgroundClick'), 'handleCanvasBackgroundClick not found');
  });

  test('Background click clears selectedElementId', () => {
    // The function should clear both selectedElementId and selectedElementIds
    const bgClickFn = src.match(/handleCanvasBackgroundClick\s*=\s*useCallback\(\(\)\s*=>\s*\{[^}]+\}/);
    assert(bgClickFn, 'Background click handler not found');
    const handler = bgClickFn[0];
    assert(handler.includes('setSelectedElementId(null)'), 'Background click does not clear selectedElementId');
  });

  test('Background click clears selectedElementIds', () => {
    const bgClickFn = src.match(/handleCanvasBackgroundClick\s*=\s*useCallback\(\(\)\s*=>\s*\{[^}]+\}/);
    const handler = bgClickFn[0];
    assert(handler.includes('setSelectedElementIds([])'), 'Background click does not clear selectedElementIds');
  });

  test('Canvas onClick uses handleCanvasBackgroundClick', () => {
    assert(src.includes('onClick={handleCanvasBackgroundClick}'), 'Canvas onClick not using background handler');
  });

  // === SECTION 5: Visual feedback for multi-select ===
  console.log('\n--- Multi-select Visual Feedback ---');

  test('data-multi-selected attribute on elements', () => {
    assert(src.includes('data-multi-selected={isMultiSelected'), 'data-multi-selected attr not found');
  });

  test('data-selected attribute on elements', () => {
    assert(src.includes("data-selected={isSelected ? 'true' : 'false'}"), 'data-selected attr not found');
  });

  test('isMultiSelected computed from selectedElementIds', () => {
    assert(src.includes('selectedElementIds.includes(el.id)'), 'isMultiSelected not computed');
  });

  test('Multi-selected elements get blue border', () => {
    assert(src.includes('isSelected || isMultiSelected'), 'Multi-select border logic not found');
  });

  test('Multi-selected non-primary elements get subtle background', () => {
    assert(src.includes('isMultiSelected && !isSelected'), 'Multi-select background logic not found');
    assert(src.includes('rgba(59, 130, 246, 0.05)'), 'Multi-select background color not found');
  });

  test('Selection handles shown for multi-selected elements', () => {
    // Selection handles should appear for both isSelected and isMultiSelected
    assert(src.includes('{(isSelected || isMultiSelected) && ('), 'Multi-select handles not shown');
  });

  test('aria-selected reflects multi-select state', () => {
    assert(src.includes('aria-selected={isSelected || isMultiSelected}'), 'aria-selected not multi-select aware');
  });

  // === SECTION 6: Multi-select indicator ===
  console.log('\n--- Multi-select Indicator ---');

  test('Multi-select indicator rendered when multiple selected', () => {
    assert(src.includes('data-testid="multi-select-indicator"'), 'multi-select-indicator not found');
  });

  test('Indicator shows count of selected elements', () => {
    assert(src.includes('data-selected-count={selectedElementIds.length}'), 'selected count not in indicator');
  });

  test('Indicator text shows N selected', () => {
    assert(src.includes('{selectedElementIds.length} selected'), 'N selected text not found');
  });

  test('Indicator only shown when 2+ elements selected', () => {
    assert(src.includes('selectedElementIds.length > 1'), 'Multi-select threshold check not found');
  });

  // === SECTION 7: Delete multi-selected elements ===
  console.log('\n--- Multi-select Delete ---');

  test('Delete key removes all multi-selected elements', () => {
    // In the keyboard handler, delete should use selectedElementIds
    assert(src.includes('selectedElementIds.length > 0 ? selectedElementIds'), 'Multi-select delete not found');
  });

  test('Delete clears both selection states', () => {
    // After delete, both should be cleared
    assert(src.includes("setSelectedElementIds([])"), 'selectedElementIds not cleared after delete');
  });

  // === SECTION 8: Arrow nudge with multi-select ===
  console.log('\n--- Arrow Nudge Multi-select ---');

  test('Arrow keys nudge all multi-selected elements', () => {
    assert(src.includes('for (const id of idsToNudge)'), 'Multi-select nudge loop not found');
  });

  test('idsToNudge falls back to selectedElementId if no multi-select', () => {
    const nudgeLogic = src.includes("selectedElementIds.length > 0 ? selectedElementIds : (selectedElementId ? [selectedElementId] : [])");
    assert(nudgeLogic, 'Nudge fallback logic not found');
  });

  // === SECTION 9: Click handler on elements ===
  console.log('\n--- Element Click Handler ---');

  test('onClick uses handleElementClick', () => {
    assert(src.includes('onClick={(e) => handleElementClick(e, el.id)'), 'handleElementClick not bound to onClick');
  });

  test('onKeyDown Enter/Space selects element and sets selectedElementIds', () => {
    assert(src.includes("setSelectedElementIds([el.id])"), 'Key select does not update selectedElementIds');
  });

  // === SECTION 10: Page load ===
  console.log('\n--- Page Load ---');

  test('Page loads successfully', () => {
    assert(html.length > 1000, 'Page HTML too short');
  });

  test('ErpDesigner reference in HTML', () => {
    assert(html.includes('erp-designer'), 'erp-designer not found');
  });

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();
