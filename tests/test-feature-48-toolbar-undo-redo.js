/**
 * Feature #48: Toolbar undo redo buttons
 * Undo reverts, redo reapplies
 *
 * Steps:
 * 1. Add element
 * 2. Undo - removed
 * 3. Redo - reappears
 * 4. Verify disable states
 *
 * Tests SSR HTML for button presence, attributes, and initial states.
 * Tests the undo/redo logic by verifying the React component structure.
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Feature #48: Toolbar undo redo buttons\n');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Undo button exists and has correct attributes ===
  console.log('--- Undo Button ---');

  test('Undo button exists with data-testid="btn-undo"', () => {
    assert(html.includes('data-testid="btn-undo"'), 'btn-undo not found');
  });

  test('Undo button has title "Undo (Ctrl+Z)"', () => {
    assert(html.includes('title="Undo (Ctrl+Z)"'), 'Undo title not found');
  });

  test('Undo button has aria-label "Undo (Ctrl+Z)"', () => {
    assert(html.includes('aria-label="Undo (Ctrl+Z)"'), 'Undo aria-label not found');
  });

  test('Undo button has aria-keyshortcuts="Control+Z"', () => {
    assert(html.includes('aria-keyshortcuts="Control+Z"'), 'Undo keyshortcut not found');
  });

  test('Undo button uses ↩ icon (&#8617;)', () => {
    // The Unicode character ↩ (U+21A9) should be in the HTML
    assert(html.includes('↩') || html.includes('&#8617;'), 'Undo icon not found');
  });

  // === SECTION 2: Redo button exists and has correct attributes ===
  console.log('\n--- Redo Button ---');

  test('Redo button exists with data-testid="btn-redo"', () => {
    assert(html.includes('data-testid="btn-redo"'), 'btn-redo not found');
  });

  test('Redo button has title "Redo (Ctrl+Shift+Z)"', () => {
    assert(html.includes('title="Redo (Ctrl+Shift+Z)"'), 'Redo title not found');
  });

  test('Redo button has aria-label "Redo (Ctrl+Shift+Z)"', () => {
    assert(html.includes('aria-label="Redo (Ctrl+Shift+Z)"'), 'Redo aria-label not found');
  });

  test('Redo button has aria-keyshortcuts="Control+Shift+Z"', () => {
    assert(html.includes('aria-keyshortcuts="Control+Shift+Z"'), 'Redo keyshortcut not found');
  });

  test('Redo button uses ↪ icon (&#8618;)', () => {
    assert(html.includes('↪') || html.includes('&#8618;'), 'Redo icon not found');
  });

  // === SECTION 3: Initial disable states ===
  console.log('\n--- Initial Disable States ---');

  test('Undo button is initially disabled (no history)', () => {
    // Extract the undo button tag
    const match = html.match(/<button[^>]*data-testid="btn-undo"[^>]*>/);
    assert(match, 'btn-undo tag not found');
    assert(match[0].includes('disabled'), 'Undo button should be disabled initially');
  });

  test('Redo button is initially disabled (no history)', () => {
    const match = html.match(/<button[^>]*data-testid="btn-redo"[^>]*>/);
    assert(match, 'btn-redo tag not found');
    assert(match[0].includes('disabled'), 'Redo button should be disabled initially');
  });

  test('Undo button has opacity 0.4 when disabled', () => {
    const match = html.match(/<button[^>]*data-testid="btn-undo"[^>]*>/);
    assert(match, 'btn-undo tag not found');
    assert(match[0].includes('opacity:0.4'), 'Undo button should have opacity 0.4 when disabled');
  });

  test('Redo button has opacity 0.4 when disabled', () => {
    const match = html.match(/<button[^>]*data-testid="btn-redo"[^>]*>/);
    assert(match, 'btn-redo tag not found');
    assert(match[0].includes('opacity:0.4'), 'Redo button should have opacity 0.4 when disabled');
  });

  // === SECTION 4: Button styling ===
  console.log('\n--- Button Styling ---');

  test('Undo button has toolbar button styles', () => {
    const match = html.match(/<button[^>]*data-testid="btn-undo"[^>]*>/);
    assert(match, 'btn-undo tag not found');
    assert(match[0].includes('border-radius:6px'), 'Should have rounded border');
    assert(match[0].includes('cursor:pointer'), 'Should have pointer cursor');
  });

  test('Redo button has toolbar button styles', () => {
    const match = html.match(/<button[^>]*data-testid="btn-redo"[^>]*>/);
    assert(match, 'btn-redo tag not found');
    assert(match[0].includes('border-radius:6px'), 'Should have rounded border');
    assert(match[0].includes('cursor:pointer'), 'Should have pointer cursor');
  });

  // === SECTION 5: Toolbar layout (undo/redo are adjacent, separated by dividers) ===
  console.log('\n--- Toolbar Layout ---');

  test('Undo button appears before redo button in HTML', () => {
    const undoPos = html.indexOf('data-testid="btn-undo"');
    const redoPos = html.indexOf('data-testid="btn-redo"');
    assert(undoPos >= 0, 'Undo button not found');
    assert(redoPos >= 0, 'Redo button not found');
    assert(undoPos < redoPos, 'Undo should appear before redo in HTML');
  });

  test('Divider separator exists between page size and undo/redo group', () => {
    // There should be a divider (1px width, 24px height) before undo button
    const undoPos = html.indexOf('data-testid="btn-undo"');
    const precedingHtml = html.substring(Math.max(0, undoPos - 300), undoPos);
    assert(
      precedingHtml.includes('width:1px') || precedingHtml.includes('width: 1px'),
      'Divider should exist before undo button group'
    );
  });

  test('Divider separator exists after undo/redo group', () => {
    const redoPos = html.indexOf('data-testid="btn-redo"');
    // Find the next bit of HTML after the redo button close tag
    const followingHtml = html.substring(redoPos, redoPos + 400);
    assert(
      followingHtml.includes('width:1px') || followingHtml.includes('width: 1px'),
      'Divider should exist after undo/redo group'
    );
  });

  // === SECTION 6: Keyboard shortcuts documented ===
  console.log('\n--- Keyboard Shortcuts ---');

  test('Ctrl+Z keyboard shortcut listed for Undo', () => {
    // Help modal or shortcut docs should list Ctrl+Z for Undo
    assert(html.includes('Ctrl + Z') || html.includes('Ctrl+Z'), 'Ctrl+Z shortcut reference not found');
  });

  test('Ctrl+Shift+Z keyboard shortcut listed for Redo', () => {
    assert(
      html.includes('Ctrl + Shift + Z') || html.includes('Ctrl+Shift+Z'),
      'Ctrl+Shift+Z shortcut reference not found'
    );
  });

  test('Ctrl+Y alternate redo shortcut exists in source', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
      'utf-8'
    );
    assert(src.includes("e.key === 'y'"), 'Ctrl+Y handler not found in source');
    assert(src.includes("['Redo (alt)', 'Ctrl + Y']"), 'Ctrl+Y documented in shortcuts help');
  });

  // === SECTION 7: Source code verification of undo/redo logic ===
  console.log('\n--- Source Code Logic Verification ---');

  const fs = require('fs');
  const designerSrc = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf-8'
  );

  test('undoStackRef is defined for undo history', () => {
    assert(designerSrc.includes('undoStackRef'), 'undoStackRef not found');
  });

  test('redoStackRef is defined for redo history', () => {
    assert(designerSrc.includes('redoStackRef'), 'redoStackRef not found');
  });

  test('handleUndo pops from undo stack and pushes to redo stack', () => {
    assert(designerSrc.includes('undoStackRef.current.pop'), 'Undo does not pop from undo stack');
    assert(designerSrc.includes('redoStackRef.current.push'), 'Undo does not push to redo stack');
  });

  test('handleRedo pops from redo stack and pushes to undo stack', () => {
    assert(designerSrc.includes('redoStackRef.current.pop'), 'Redo does not pop from redo stack');
    assert(designerSrc.includes('undoStackRef.current.push'), 'Redo does not push to undo stack');
  });

  test('Undo handler early-returns when stack is empty', () => {
    assert(
      designerSrc.includes('if (undoStackRef.current.length === 0) return'),
      'handleUndo should guard against empty stack'
    );
  });

  test('Redo handler early-returns when stack is empty', () => {
    assert(
      designerSrc.includes('if (redoStackRef.current.length === 0) return'),
      'handleRedo should guard against empty stack'
    );
  });

  test('New actions clear redo stack (standard undo/redo behavior)', () => {
    assert(
      designerSrc.includes('redoStackRef.current = []'),
      'New actions should clear redo stack'
    );
  });

  test('Max undo history is bounded (prevents memory leaks)', () => {
    assert(
      designerSrc.includes('MAX_UNDO_HISTORY'),
      'Should have maximum undo history limit'
    );
    // Extract the value
    const match = designerSrc.match(/MAX_UNDO_HISTORY\s*=\s*(\d+)/);
    assert(match, 'MAX_UNDO_HISTORY should have a numeric value');
    const limit = parseInt(match[1]);
    assert(limit >= 10 && limit <= 200, `MAX_UNDO_HISTORY should be reasonable (got ${limit})`);
  });

  test('Oldest undo entries are removed when limit reached', () => {
    assert(
      designerSrc.includes('undoStackRef.current.shift()'),
      'Should shift oldest entry when max reached'
    );
  });

  test('isUndoRedoRef prevents recursive history pushes during undo/redo', () => {
    assert(designerSrc.includes('isUndoRedoRef'), 'isUndoRedoRef flag not found');
    assert(
      designerSrc.includes('if (isUndoRedoRef.current) return'),
      'Should guard against pushing during undo/redo'
    );
  });

  test('Undo/redo state snapshots use deep copy (JSON parse/stringify)', () => {
    assert(
      designerSrc.includes('JSON.parse(JSON.stringify'),
      'Should deep-clone state for snapshots'
    );
  });

  test('Undo marks document as dirty', () => {
    // handleUndo should call setIsDirty(true)
    const undoBlock = designerSrc.substring(
      designerSrc.indexOf('const handleUndo'),
      designerSrc.indexOf('const handleRedo')
    );
    assert(undoBlock.includes('setIsDirty(true)'), 'Undo should mark document as dirty');
  });

  test('Redo marks document as dirty', () => {
    const redoStart = designerSrc.indexOf('const handleRedo');
    const redoBlock = designerSrc.substring(
      redoStart,
      designerSrc.indexOf('const clearUndoHistory')
    );
    assert(redoBlock.includes('setIsDirty(true)'), 'Redo should mark document as dirty');
  });

  test('clearUndoHistory resets both stacks (for new template load)', () => {
    assert(designerSrc.includes('clearUndoHistory'), 'clearUndoHistory function not found');
    const clearBlock = designerSrc.substring(
      designerSrc.indexOf('const clearUndoHistory'),
      designerSrc.indexOf('const clearUndoHistory') + 300
    );
    assert(clearBlock.includes('undoStackRef.current = []'), 'Should clear undo stack');
    assert(clearBlock.includes('redoStackRef.current = []'), 'Should clear redo stack');
    assert(clearBlock.includes('setUndoCount(0)'), 'Should reset undo count');
    assert(clearBlock.includes('setRedoCount(0)'), 'Should reset redo count');
  });

  test('Undo button onClick calls handleUndo', () => {
    assert(
      designerSrc.includes('onClick={handleUndo}'),
      'Undo button should have onClick={handleUndo}'
    );
  });

  test('Redo button onClick calls handleRedo', () => {
    assert(
      designerSrc.includes('onClick={handleRedo}'),
      'Redo button should have onClick={handleRedo}'
    );
  });

  test('Undo button disabled state reflects undoCount', () => {
    assert(
      designerSrc.includes('disabled={undoCount === 0}'),
      'Undo button disabled state should depend on undoCount'
    );
  });

  test('Redo button disabled state reflects redoCount', () => {
    assert(
      designerSrc.includes('disabled={redoCount === 0}'),
      'Redo button disabled state should depend on redoCount'
    );
  });

  test('Undo opacity changes based on available undo actions', () => {
    assert(
      designerSrc.includes('opacity: undoCount > 0 ? 1 : 0.4'),
      'Undo opacity should change based on undoCount'
    );
  });

  test('Redo opacity changes based on available redo actions', () => {
    assert(
      designerSrc.includes('opacity: redoCount > 0 ? 1 : 0.4'),
      'Redo opacity should change based on redoCount'
    );
  });

  test('Ctrl+Z keyboard handler calls handleUndo', () => {
    // Find the keyboard handler section - look for the full block
    const kbStart = designerSrc.indexOf('Keyboard shortcuts');
    const kbSection = designerSrc.substring(kbStart, kbStart + 1200);
    assert(kbSection.includes('handleUndo()'), 'Ctrl+Z should call handleUndo()');
  });

  test('Ctrl+Shift+Z / Ctrl+Y keyboard handlers call handleRedo', () => {
    const kbStart = designerSrc.indexOf('Keyboard shortcuts');
    const kbSection = designerSrc.substring(kbStart, kbStart + 1200);
    assert(kbSection.includes('handleRedo()'), 'Ctrl+Shift+Z/Ctrl+Y should call handleRedo()');
  });

  test('setPagesWithHistory wraps setPages to capture undo state', () => {
    assert(
      designerSrc.includes('setPagesWithHistory'),
      'setPagesWithHistory wrapper function should exist'
    );
    assert(
      designerSrc.includes('pushUndoState(prevPages)'),
      'setPagesWithHistory should push to undo before applying update'
    );
  });

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
})();
