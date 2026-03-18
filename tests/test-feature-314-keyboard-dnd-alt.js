/**
 * Test Feature #314: Drag and drop has keyboard alternative
 * Elements can be placed without mouse drag
 */

const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function runTests() {
  console.log('=== Feature #314: Drag and drop has keyboard alternative ===\n');

  const srcPath = 'apps/designer-sandbox/components/ErpDesigner.tsx';
  const src = fs.readFileSync(srcPath, 'utf8');

  // === Section 1: Select block from Blocks tab via keyboard ===
  console.log('--- Block Cards Keyboard Accessible ---');

  assert(
    src.includes('block-card') && src.includes('tabIndex={0}'),
    'Block cards are keyboard focusable (tabIndex={0})'
  );

  assert(
    src.includes('role="button"') && src.includes('aria-label={`Add ${block.label} block`}'),
    'Block cards have role="button" and accessible labels'
  );

  assert(
    src.includes("onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addElementToCanvas(block.id); } }}"),
    'Block cards respond to Enter and Space keys to add element'
  );

  assert(
    src.includes('onClick={() => addElementToCanvas(block.id)'),
    'Block cards also respond to click as a fallback'
  );

  // === Section 2: Fields tab keyboard accessible ===
  console.log('\n--- Field Items Keyboard Accessible ---');

  assert(
    src.includes('role="option"') && src.includes('tabIndex={0}') && src.includes('aria-label={`Bind field ${field.key}`}'),
    'Field items have role="option", tabIndex, and accessible labels'
  );

  assert(
    src.includes("onKeyDown={(e) => {") && src.includes("handleBindField(field.key)"),
    'Field items respond to Enter/Space to bind fields via keyboard'
  );

  // === Section 3: Position adjustable via arrow keys ===
  console.log('\n--- Arrow Key Position Adjustment ---');

  assert(
    src.includes("e.key === 'ArrowUp'") && src.includes("e.key === 'ArrowDown'"),
    'Arrow Up and Down keys are handled'
  );

  assert(
    src.includes("e.key === 'ArrowLeft'") && src.includes("e.key === 'ArrowRight'"),
    'Arrow Left and Right keys are handled'
  );

  assert(
    src.includes('const step = e.shiftKey ? 10 : 1'),
    'Arrow keys move by 1px default, 10px with Shift held'
  );

  assert(
    src.includes('updateElement(selectedElementId,') && src.includes("selectedElement?.x"),
    'Arrow keys use updateElement to adjust position'
  );

  assert(
    src.includes("Math.max(0,") && src.includes("+ dx") && src.includes("+ dy"),
    'Position is clamped to prevent going below 0'
  );

  assert(
    src.includes("dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0"),
    'Horizontal delta calculated from ArrowLeft/ArrowRight'
  );

  assert(
    src.includes("dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0"),
    'Vertical delta calculated from ArrowUp/ArrowDown'
  );

  // === Section 4: No functionality requires mouse-only ===
  console.log('\n--- No Mouse-Only Functionality ---');

  // Block placement - keyboard works (Enter/Space on block card)
  assert(
    src.includes('addElementToCanvas(block.id)') && src.includes("e.key === 'Enter'"),
    'Block placement has keyboard alternative (Enter/Space on block card)'
  );

  // Element selection - keyboard works (Enter/Space on canvas element)
  assert(
    src.includes("if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedElementId(el.id); }"),
    'Element selection has keyboard alternative (Enter/Space on canvas element)'
  );

  // Element deletion - keyboard works (Delete key)
  assert(
    src.includes("e.key === 'Delete' || e.key === 'Backspace'") && src.includes('setSelectedElementId(null)'),
    'Element deletion has keyboard alternative (Delete/Backspace key)'
  );

  // Element positioning - keyboard works (Arrow keys)
  assert(
    src.includes("e.key === 'ArrowUp'") && src.includes('updateElement(selectedElementId'),
    'Element positioning has keyboard alternative (Arrow keys)'
  );

  // Canvas elements have tabIndex for keyboard navigation
  assert(
    src.includes('tabIndex={0}') && src.includes('role="button"'),
    'Canvas elements are keyboard navigable with tabIndex and role'
  );

  // Properties panel has number inputs for precise positioning
  assert(
    src.includes('properties-position-size') && src.includes("onChange={(e) => updateElement(selectedElement.id, { x:"),
    'Position/size adjustable via properties panel number inputs'
  );

  // Page thumbnails have keyboard support
  assert(
    src.includes('role="tab"') && src.includes('page-thumbnail-'),
    'Page thumbnails accessible via keyboard (role="tab")'
  );

  // Tab navigation works
  assert(
    src.includes("role=\"tab\""),
    'Tab navigation elements have proper ARIA roles'
  );

  // Shortcuts help documents arrow keys
  assert(
    src.includes("'Move element (1px)'") && src.includes("'Arrow Keys'"),
    'Arrow key shortcut documented in shortcuts help dialog'
  );

  assert(
    src.includes("'Move element (10px)'") && src.includes("'Shift + Arrow Keys'"),
    'Shift+Arrow shortcut documented in shortcuts help dialog'
  );

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
