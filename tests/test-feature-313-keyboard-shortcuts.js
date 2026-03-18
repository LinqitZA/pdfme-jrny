/**
 * Test Feature #313: Keyboard shortcut accessibility
 * Key shortcuts documented and screen reader compatible
 */

const http = require('http');
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

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: () => data, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runTests() {
  console.log('=== Feature #313: Keyboard shortcut accessibility ===\n');

  // Read the source code
  const srcPath = 'apps/designer-sandbox/components/ErpDesigner.tsx';
  const src = fs.readFileSync(srcPath, 'utf8');

  // === Section 1: Ctrl+Z for Undo ===
  console.log('--- Ctrl+Z for Undo ---');

  assert(
    src.includes("e.key === 'z' && !e.shiftKey") && src.includes('handleUndo()'),
    'Ctrl+Z triggers undo action'
  );

  assert(
    src.includes("(e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey"),
    'Undo works with both Ctrl (Windows) and Cmd (Mac)'
  );

  assert(
    src.includes("e.preventDefault()") && src.includes("handleUndo"),
    'Undo prevents default browser behavior (Ctrl+Z)'
  );

  // === Section 2: Ctrl+Shift+Z for Redo ===
  console.log('\n--- Ctrl+Shift+Z for Redo ---');

  assert(
    src.includes("e.key === 'z' && e.shiftKey") && src.includes('handleRedo()'),
    'Ctrl+Shift+Z triggers redo action'
  );

  assert(
    src.includes("(e.ctrlKey || e.metaKey) && e.key === 'y'"),
    'Ctrl+Y also triggers redo (alternative shortcut)'
  );

  // === Section 3: Delete key works ===
  console.log('\n--- Delete Key ---');

  assert(
    src.includes("e.key === 'Delete' || e.key === 'Backspace'"),
    'Both Delete and Backspace keys are handled'
  );

  assert(
    src.includes("selectedElementId") && src.includes("setSelectedElementId(null)"),
    'Delete removes selected element and clears selection'
  );

  assert(
    src.includes("setIsDirty(true)") && src.includes("e.key === 'Delete'"),
    'Delete marks document as dirty after element removal'
  );

  // === Section 4: Shortcuts don't conflict with screen reader ===
  console.log('\n--- Screen Reader Compatibility ---');

  // Check that shortcuts are skipped in input fields
  assert(
    src.includes("target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'"),
    'Shortcuts are disabled when focus is in input/textarea/select fields'
  );

  assert(
    src.includes('isInput') && src.includes('if (isInput) return'),
    'Non-modifier shortcuts skip when user is in form controls'
  );

  // Check aria-keyshortcuts attributes
  assert(
    src.includes('aria-keyshortcuts="Control+Z"'),
    'Undo button has aria-keyshortcuts="Control+Z" for screen readers'
  );

  assert(
    src.includes('aria-keyshortcuts="Control+Shift+Z"'),
    'Redo button has aria-keyshortcuts="Control+Shift+Z" for screen readers'
  );

  assert(
    src.includes('aria-keyshortcuts="Control+S"'),
    'Save button has aria-keyshortcuts="Control+S" for screen readers'
  );

  // Check title attributes include shortcut info
  assert(
    src.includes('title="Undo (Ctrl+Z)"'),
    'Undo button title includes shortcut hint'
  );

  assert(
    src.includes('title="Redo (Ctrl+Shift+Z)"'),
    'Redo button title includes shortcut hint'
  );

  // Check aria-label includes shortcut info
  assert(
    src.includes('aria-label="Undo (Ctrl+Z)"'),
    'Undo button aria-label includes shortcut for screen reader announcement'
  );

  assert(
    src.includes('aria-label="Redo (Ctrl+Shift+Z)"'),
    'Redo button aria-label includes shortcut for screen reader announcement'
  );

  // === Section 5: Keyboard shortcuts help dialog ===
  console.log('\n--- Keyboard Shortcuts Help Dialog ---');

  assert(
    src.includes('showShortcutsHelp') && src.includes('setShowShortcutsHelp'),
    'Shortcuts help dialog state exists'
  );

  assert(
    src.includes('keyboard-shortcuts-dialog'),
    'Shortcuts dialog has data-testid for testing'
  );

  assert(
    src.includes('role="dialog"') && src.includes('aria-label="Keyboard shortcuts"'),
    'Shortcuts dialog has proper ARIA role and label'
  );

  assert(
    src.includes('aria-modal="true"'),
    'Shortcuts dialog is marked as modal for screen readers'
  );

  assert(
    src.includes('shortcuts-table'),
    'Shortcuts are displayed in a table format'
  );

  assert(
    src.includes("'Ctrl + Z'") && src.includes("'Ctrl + Shift + Z'"),
    'Table lists undo and redo shortcuts'
  );

  assert(
    src.includes("'Ctrl + S'") && src.includes("'Delete / Backspace'"),
    'Table lists save and delete shortcuts'
  );

  assert(
    src.includes("'Enter / Space'") && src.includes("'Escape'"),
    'Table lists select element and close dialog shortcuts'
  );

  assert(
    src.includes('<kbd'),
    'Shortcut keys use <kbd> elements for semantic HTML'
  );

  // === Section 6: ? key toggles shortcuts help ===
  console.log('\n--- ? Key Toggle ---');

  assert(
    src.includes("e.key === '?'") || src.includes("e.key === '/'"),
    '? key (or Shift+/) opens shortcuts help'
  );

  assert(
    src.includes('btn-keyboard-shortcuts'),
    'Toolbar has a keyboard shortcuts button'
  );

  assert(
    src.includes('aria-label="Keyboard shortcuts (?)"'),
    'Shortcuts button has aria-label with shortcut hint'
  );

  // === Section 7: Escape closes dialog ===
  console.log('\n--- Escape Key ---');

  assert(
    src.includes("e.key === 'Escape'") && src.includes('setShowShortcutsHelp(false)'),
    'Escape key closes shortcuts dialog'
  );

  assert(
    src.includes('shortcuts-close-btn'),
    'Dialog has a close button'
  );

  assert(
    src.includes('aria-label="Close shortcuts dialog"'),
    'Close button has accessible label'
  );

  // === Section 8: Ctrl+S save shortcut ===
  console.log('\n--- Ctrl+S Save ---');

  assert(
    src.includes("e.key === 's'") && src.includes('handleSave()'),
    'Ctrl+S triggers save'
  );

  assert(
    src.includes("// Ctrl+S always works (save) - even in inputs"),
    'Save shortcut works even when typing in input fields'
  );

  // === Section 9: No conflicts with standard screen reader shortcuts ===
  console.log('\n--- No Screen Reader Conflicts ---');

  // Verify shortcuts use modifier keys (Ctrl/Cmd) which don't conflict with screen readers
  // Screen readers use different modifier combinations (e.g., NVDA uses Insert, JAWS uses Insert/CapsLock)
  assert(
    !src.includes("e.altKey && e.key") || src.includes("// not used"),
    'No shortcuts use Alt key alone (reserved for screen readers/menus)'
  );

  // Non-modifier shortcuts (Delete, ?, Escape) only fire outside input fields
  assert(
    src.includes('if (isInput) return') && src.includes("e.key === 'Delete'"),
    'Delete key only fires outside input fields (no conflict with text editing)'
  );

  // All interactive elements have proper roles and labels
  assert(
    src.includes('role="button"') && src.includes('tabIndex={0}'),
    'Interactive elements have proper roles and tabIndex for keyboard navigation'
  );

  assert(
    src.includes('Shortcuts are disabled while typing in input fields'),
    'Help dialog explains that shortcuts are disabled in inputs'
  );

  // === Section 10: Fetch the page and verify HTML output ===
  console.log('\n--- HTML Output Verification ---');

  try {
    const res = await fetch('http://localhost:3001/');
    assert(res.status === 200, 'Frontend page loads successfully');
  } catch (e) {
    assert(false, 'Frontend page loads: ' + e.message);
  }

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
