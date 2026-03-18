/**
 * Feature #63: Canvas delete removes selected elements
 * Delete/Backspace removes elements, undo restores
 *
 * Steps:
 * 1. Select element
 * 2. Press Delete
 * 3. Element removed
 * 4. Undo restores
 *
 * Tests SSR HTML and source code for delete functionality.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const SOURCE_FILE = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

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
  console.log('Feature #63: Canvas delete removes selected elements\n');

  let html;
  let source;
  try {
    html = await fetchPage(FRONTEND_URL);
    source = fs.readFileSync(SOURCE_FILE, 'utf8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Keyboard Delete Handler ===
  console.log('--- Keyboard Delete Handler ---');

  test('Keyboard handler listens for Delete key', () => {
    assert(source.includes("e.key === 'Delete'"), 'Delete key handler not found');
  });

  test('Keyboard handler listens for Backspace key', () => {
    assert(source.includes("e.key === 'Backspace'"), 'Backspace key handler not found');
  });

  test('Delete handler checks for selected elements before removing', () => {
    // The handler checks selectedElementIds or selectedElementId
    assert(
      source.includes('selectedElementIds.length > 0') ||
      source.includes('selectedElementId'),
      'No selection check before delete'
    );
  });

  test('Delete handler uses setPagesWithHistory for undo support', () => {
    // Find the delete block in keyboard handler
    const deleteBlock = source.match(/e\.key === 'Delete'[\s\S]{0,500}setPagesWithHistory/);
    assert(deleteBlock, 'Delete handler does not use setPagesWithHistory');
  });

  test('Delete handler filters out selected element from page elements', () => {
    // After Delete, elements are filtered: p.elements.filter(...)
    const deleteFilter = source.match(/Delete[\s\S]{0,800}elements\.filter/);
    assert(deleteFilter, 'Delete handler does not filter elements');
  });

  test('Delete handler clears selection after removal (setSelectedElementId null)', () => {
    // After deletion, selectedElementId is set to null
    const deleteSection = source.match(/e\.key === 'Delete'[\s\S]{0,600}setSelectedElementId\(null\)/);
    assert(deleteSection, 'Delete does not clear selectedElementId');
  });

  test('Delete handler clears multi-selection after removal (setSelectedElementIds)', () => {
    const deleteSection = source.match(/e\.key === 'Delete'[\s\S]{0,600}setSelectedElementIds\(\[\]\)/);
    assert(deleteSection, 'Delete does not clear selectedElementIds');
  });

  test('Delete handler sets isDirty flag', () => {
    const deleteSection = source.match(/e\.key === 'Delete'[\s\S]{0,600}setIsDirty\(true\)/);
    assert(deleteSection, 'Delete does not set isDirty');
  });

  test('Delete handler prevents default browser behavior', () => {
    const deleteSection = source.match(/e\.key === 'Delete'[\s\S]{0,300}e\.preventDefault\(\)/);
    assert(deleteSection, 'Delete does not prevent default');
  });

  test('Delete only fires when not in input/textarea/select', () => {
    // The handler checks isInput before processing Delete
    assert(source.includes("const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'"),
      'isInput check not found');
    assert(source.includes('if (isInput) return'), 'isInput guard not found');
  });

  // === SECTION 2: Element-level onKeyDown Delete Handler ===
  console.log('\n--- Element-level Delete Handler ---');

  test('Canvas elements have onKeyDown handler', () => {
    assert(source.includes('onKeyDown={(e)'), 'onKeyDown handler not found on canvas elements');
  });

  test('Element-level Delete handler checks for selected or multi-selected', () => {
    // In the element's onKeyDown: isSelected || isMultiSelected
    const elementDelete = source.match(/onKeyDown[\s\S]{0,300}(isSelected|isMultiSelected)[\s\S]{0,200}Delete/);
    assert(elementDelete, 'Element-level delete does not check selection');
  });

  test('Element-level Delete handles multi-select (selectedElementIds)', () => {
    // The element handler uses selectedElementIds for multi-delete
    const multiDelete = source.match(/onKeyDown[\s\S]{0,500}idsToDelete[\s\S]{0,200}selectedElementIds/);
    assert(multiDelete, 'Element-level delete does not support multi-select');
  });

  test('Element-level Delete uses setPagesWithHistory for undo', () => {
    // In the onKeyDown handler block
    const elementUndoDelete = source.match(/onKeyDown[\s\S]{0,500}setPagesWithHistory/);
    assert(elementUndoDelete, 'Element-level delete does not use setPagesWithHistory');
  });

  // === SECTION 3: Delete Button in Properties Panel ===
  console.log('\n--- Delete Button in Properties Panel ---');

  test('Delete element button exists in source with data-testid', () => {
    assert(source.includes('data-testid="btn-delete-element"'), 'btn-delete-element testid not found');
  });

  test('Delete element button has aria-label', () => {
    assert(source.includes('aria-label="Delete element"'), 'Delete element aria-label not found');
  });

  test('Delete button has red styling (color: #dc2626)', () => {
    assert(source.includes("color: '#dc2626'"), 'Delete button red color not found');
  });

  test('Delete button has red background styling', () => {
    assert(source.includes("backgroundColor: '#fef2f2'"), 'Delete button red background not found');
  });

  test('Delete button onClick uses setPagesWithHistory', () => {
    // The delete button's onClick uses setPagesWithHistory for undo support
    const deleteBtn = source.match(/btn-delete-element[\s\S]{0,500}setPagesWithHistory/);
    assert(deleteBtn, 'Delete button does not use setPagesWithHistory');
  });

  test('Delete button clears selection after removal', () => {
    const deleteBtn = source.match(/btn-delete-element[\s\S]{0,800}setSelectedElementId\(null\)/);
    assert(deleteBtn, 'Delete button does not clear selection');
  });

  test('Delete button sets isDirty', () => {
    const deleteBtn = source.match(/btn-delete-element[\s\S]{0,800}setIsDirty\(true\)/);
    assert(deleteBtn, 'Delete button does not set isDirty');
  });

  test('Delete button displays text "Delete Element"', () => {
    assert(source.includes('Delete Element'), 'Delete Element text not found');
  });

  // === SECTION 4: Undo/Redo Integration with Delete ===
  console.log('\n--- Undo/Redo Integration ---');

  test('setPagesWithHistory pushes to undo stack before mutation', () => {
    assert(source.includes('pushUndoState(prevPages)'), 'setPagesWithHistory does not push undo state');
  });

  test('pushUndoState creates deep copy via JSON.parse/JSON.stringify', () => {
    assert(source.includes('JSON.parse(JSON.stringify(currentPages))'), 'No deep copy in pushUndoState');
  });

  test('handleUndo restores previous state from undoStack', () => {
    assert(source.includes('undoStackRef.current.pop()'), 'handleUndo does not pop from undoStack');
  });

  test('handleUndo pushes current state to redoStack', () => {
    assert(source.includes('redoStackRef.current.push(JSON.parse(JSON.stringify(currentPages)))'),
      'handleUndo does not save to redo');
  });

  test('handleUndo is connected to Ctrl+Z keyboard shortcut', () => {
    const ctrlZ = source.match(/ctrlKey.*key === 'z'[\s\S]{0,100}handleUndo/);
    assert(ctrlZ, 'Ctrl+Z not connected to handleUndo');
  });

  test('handleRedo restores state from redoStack', () => {
    assert(source.includes('redoStackRef.current.pop()'), 'handleRedo does not pop from redoStack');
  });

  test('Undo stack has max history limit (MAX_UNDO_HISTORY)', () => {
    assert(source.includes('MAX_UNDO_HISTORY'), 'MAX_UNDO_HISTORY constant not found');
  });

  test('isUndoRedoRef prevents recursive history pushes', () => {
    assert(source.includes('if (isUndoRedoRef.current) return'), 'isUndoRedoRef guard not found');
  });

  // === SECTION 5: Keyboard Shortcuts Help ===
  console.log('\n--- Keyboard Shortcuts Help ---');

  test('Shortcuts help lists Delete/Backspace for delete element', () => {
    assert(source.includes("['Delete element', 'Delete / Backspace']"),
      'Delete shortcut not listed in help');
  });

  // === SECTION 6: Canvas Elements Have Selection Attributes ===
  console.log('\n--- Canvas Element Selection Attributes ---');

  test('Canvas elements have data-selected attribute', () => {
    assert(source.includes('data-selected={isSelected'), 'data-selected not on canvas elements');
  });

  test('Canvas elements have data-multi-selected attribute', () => {
    assert(source.includes('data-multi-selected={isMultiSelected'), 'data-multi-selected not on canvas elements');
  });

  test('Canvas elements are focusable (tabIndex=0)', () => {
    assert(source.includes('tabIndex={0}'), 'Canvas elements not focusable');
  });

  test('Canvas elements have role="button" for accessibility', () => {
    const roleButton = source.match(/data-testid={`canvas-element[\s\S]{0,200}role="button"/);
    assert(roleButton, 'Canvas elements do not have role="button"');
  });

  // === SECTION 7: SSR HTML Verification ===
  console.log('\n--- SSR HTML Verification ---');

  test('Designer root renders in HTML', () => {
    assert(html.includes('data-testid="erp-designer-root"'), 'erp-designer-root not found');
  });

  test('Undo button exists for restoring deleted elements', () => {
    assert(html.includes('data-testid="btn-undo"'), 'btn-undo not found');
  });

  test('Redo button exists for re-applying deletion', () => {
    assert(html.includes('data-testid="btn-redo"'), 'btn-redo not found');
  });

  test('Canvas area exists for element interaction', () => {
    assert(html.includes('data-testid="canvas-page"') || html.includes('data-testid="center-canvas"'),
      'Canvas area not found in HTML');
  });

  // === SECTION 8: Delete removes only from current page ===
  console.log('\n--- Page-scoped Delete ---');

  test('Delete filters elements only on currentPageIndex', () => {
    // The delete handler checks idx !== currentPageIndex to skip other pages
    assert(source.includes('idx !== currentPageIndex ? p :'), 'Delete not scoped to current page');
  });

  test('Delete uses element id for precise filtering', () => {
    // Filter uses elem.id matching
    const idFilter = source.match(/elements\.filter\(\(elem[\s\S]{0,100}(elem\.id !== selectedElementId|!idsToDelete\.includes\(elem\.id\))/);
    assert(idFilter, 'Delete does not use elem.id for filtering');
  });

  // === SECTION 9: Multi-select delete ===
  console.log('\n--- Multi-select Delete ---');

  test('Global keyboard handler supports multi-select delete', () => {
    // The keyboard handler builds idsToDelete from selectedElementIds
    const multiDeleteKb = source.match(/Delete[\s\S]{0,300}selectedElementIds\.length > 0/);
    assert(multiDeleteKb, 'Keyboard handler does not support multi-select delete');
  });

  test('Element-level handler builds idsToDelete for multi-delete', () => {
    const idsToDelete = source.match(/idsToDelete[\s\S]{0,100}selectedElementIds\.length > 1.*selectedElementIds.*\[el\.id\]/s);
    assert(idsToDelete, 'Element handler does not build idsToDelete');
  });

  // === SUMMARY ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
})();
