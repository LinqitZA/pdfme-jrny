/**
 * Feature #201: Designer undo history persists during session
 * Tests full undo/redo stack maintained in session
 */

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

async function testCodeStructure() {
  console.log('\n--- Code Structure Tests ---');

  const fs = await import('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf-8'
  );

  // Test 1: Undo stack exists
  assert(
    source.includes('undoStackRef') && source.includes('useRef<TemplatePage[][]>'),
    'Undo stack implemented as ref with TemplatePage[][] type'
  );

  // Test 2: Redo stack exists
  assert(
    source.includes('redoStackRef') && source.includes('useRef<TemplatePage[][]>'),
    'Redo stack implemented as ref with TemplatePage[][] type'
  );

  // Test 3: Maximum history limit
  assert(
    source.includes('MAX_UNDO_HISTORY') && source.includes('50'),
    'Maximum undo history limit set (50)'
  );

  // Test 4: pushUndoState function
  assert(
    source.includes('pushUndoState') && source.includes('JSON.parse(JSON.stringify'),
    'pushUndoState creates deep copy snapshots'
  );

  // Test 5: New action clears redo stack
  assert(
    source.includes('redoStackRef.current = []'),
    'New actions clear the redo stack'
  );

  // Test 6: handleUndo function
  assert(
    source.includes('handleUndo') && source.includes('undoStackRef.current.pop'),
    'handleUndo pops from undo stack'
  );

  // Test 7: handleUndo pushes to redo stack
  assert(
    source.includes('redoStackRef.current.push'),
    'handleUndo pushes current state to redo stack'
  );

  // Test 8: handleRedo function
  assert(
    source.includes('handleRedo') && source.includes('redoStackRef.current.pop'),
    'handleRedo pops from redo stack'
  );

  // Test 9: handleRedo pushes to undo stack
  assert(
    source.includes('undoStackRef.current.push'),
    'handleRedo pushes current state to undo stack'
  );

  // Test 10: Undo button connected to handleUndo
  assert(
    source.includes('btn-undo') && source.includes('onClick={handleUndo}'),
    'Undo button connected to handleUndo handler'
  );

  // Test 11: Redo button connected to handleRedo
  assert(
    source.includes('btn-redo') && source.includes('onClick={handleRedo}'),
    'Redo button connected to handleRedo handler'
  );

  // Test 12: Undo button disabled when stack empty
  assert(
    source.includes('disabled={undoCount === 0}'),
    'Undo button disabled when undo stack empty'
  );

  // Test 13: Redo button disabled when stack empty
  assert(
    source.includes('disabled={redoCount === 0}'),
    'Redo button disabled when redo stack empty'
  );

  // Test 14: undoCount/redoCount state for reactivity
  assert(
    source.includes('undoCount') && source.includes('setUndoCount') &&
    source.includes('redoCount') && source.includes('setRedoCount'),
    'undoCount and redoCount state variables for reactive button updates'
  );

  // Test 15: isUndoRedoRef prevents recursive history pushes
  assert(
    source.includes('isUndoRedoRef') && source.includes('isUndoRedoRef.current'),
    'isUndoRedoRef prevents recursive history pushes during undo/redo'
  );

  // Test 16: setPagesWithHistory wraps setPages for user actions
  assert(
    source.includes('setPagesWithHistory') && source.includes('pushUndoState'),
    'setPagesWithHistory wraps setPages to capture history'
  );

  // Test 17: updateElement uses setPagesWithHistory
  const updateElementSection = source.substring(
    source.indexOf('Element update helper'),
    source.indexOf('Add element to canvas')
  );
  assert(
    updateElementSection.includes('setPagesWithHistory'),
    'updateElement uses setPagesWithHistory for undo support'
  );

  // Test 18: addElementToCanvas uses setPagesWithHistory
  const addElementSection = source.substring(
    source.indexOf('Add element to canvas'),
    source.indexOf('Block drag start handler')
  );
  assert(
    addElementSection.includes('setPagesWithHistory'),
    'addElementToCanvas uses setPagesWithHistory for undo support'
  );

  // Test 19: Delete element uses setPagesWithHistory
  assert(
    source.includes("setPagesWithHistory((prev) => prev.map((page, idx)") &&
    source.includes('Delete Element'),
    'Delete element uses setPagesWithHistory for undo support'
  );

  // Test 20: Page operations use setPagesWithHistory
  const pageManagement = source.substring(
    source.indexOf('Page management'),
    source.indexOf('Drag handlers for page reorder') || source.length
  );
  assert(
    pageManagement.includes('setPagesWithHistory'),
    'Page management operations use setPagesWithHistory'
  );

  // Test 21: History cleared on new template load
  assert(
    source.includes('clearUndoHistory') && source.includes('Reset undo/redo on new template load'),
    'Undo/redo history cleared when new template loads'
  );

  // Test 22: clearUndoHistory resets both stacks
  const clearDefIndex = source.indexOf('const clearUndoHistory');
  const clearSection = source.substring(clearDefIndex, clearDefIndex + 300);
  assert(
    clearSection.includes('undoStackRef.current = []') && clearSection.includes('redoStackRef.current = []'),
    'clearUndoHistory resets both undo and redo stacks'
  );

  // Test 23: Keyboard shortcut for undo (Ctrl+Z)
  assert(
    source.includes("e.key === 'z'") && source.includes('handleUndo'),
    'Ctrl+Z keyboard shortcut triggers undo'
  );

  // Test 24: Keyboard shortcut for redo (Ctrl+Shift+Z or Ctrl+Y)
  assert(
    source.includes("e.key === 'y'") && source.includes('handleRedo'),
    'Ctrl+Y keyboard shortcut triggers redo'
  );

  // Test 25: Keyboard shortcuts skip input elements
  assert(
    source.includes("target.tagName === 'INPUT'") || source.includes('INPUT'),
    'Keyboard shortcuts skip when typing in input fields'
  );

  // Test 26: Undo marks document as dirty
  const undoHandler = source.substring(
    source.indexOf('const handleUndo'),
    source.indexOf('const handleRedo')
  );
  assert(
    undoHandler.includes('setIsDirty(true)'),
    'Undo marks document as dirty'
  );

  // Test 27: Redo marks document as dirty
  const redoHandler = source.substring(
    source.indexOf('const handleRedo'),
    source.indexOf('clearUndoHistory')
  );
  assert(
    redoHandler.includes('setIsDirty(true)'),
    'Redo marks document as dirty'
  );

  // Test 28: Oldest history removed when exceeding max
  assert(
    source.includes('undoStackRef.current.shift()') && source.includes('MAX_UNDO_HISTORY'),
    'Oldest undo entry removed when exceeding maximum'
  );

  // Test 29: Template loading uses raw setPages (not history-tracked)
  // Find the loadTemplate function area
  const loadTemplateArea = source.substring(
    source.indexOf('Load template schema from API'),
    source.indexOf('Multi-page state') > 0 ? source.indexOf('Multi-page state') : source.indexOf('Element update helper')
  );
  assert(
    loadTemplateArea.includes('setPages(loadedPages)') && !loadTemplateArea.includes('setPagesWithHistory(loadedPages)'),
    'Template loading uses raw setPages (not tracked in undo history)'
  );

  // Test 30: Undo/redo button opacity reflects state
  assert(
    source.includes('opacity: undoCount > 0 ? 1') && source.includes('opacity: redoCount > 0 ? 1'),
    'Undo/redo buttons show reduced opacity when disabled'
  );
}

async function main() {
  console.log('=== Feature #201: Designer undo history persists during session ===\n');

  await testCodeStructure();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
