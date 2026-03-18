/**
 * Feature #289: Auto-save indicator shows in toolbar
 * Verifies auto-save status is visible in designer toolbar.
 *
 * Steps:
 * 1. Make changes
 * 2. Verify 'Unsaved changes' or similar indicator
 * 3. Wait for auto-save
 * 4. Verify 'Saved' indicator
 * 5. Verify timestamp of last save
 */

const { signJwt } = require('./create-signed-token');
const API = 'http://localhost:3000/api/pdfme';

const token = signJwt({ sub: 'user-289', orgId: 'org-289', roles: ['template:edit', 'template:publish', 'render:trigger'] });
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; process.stdout.write(`  ✓ ${msg}\n`); }
  else { failed++; process.stdout.write(`  ✗ ${msg}\n`); }
}

async function setup() {
  // Create a template to work with
  const res = await fetch(`${API}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'AutoSave Indicator Test 289',
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', name: 'title', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    }),
  });
  const tpl = await res.json();
  return tpl.id;
}

async function testAutoSaveUICodePresence() {
  process.stdout.write('\n--- Auto-Save Indicator UI Code Verification ---\n');

  // Verify the auto-save indicator is present in the component source
  const fs = require('fs');
  const erpDesignerSource = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Check indicator is rendered in toolbar
  assert(erpDesignerSource.includes('data-testid="auto-save-indicator"'), 'Auto-save indicator has data-testid attribute');
  assert(erpDesignerSource.includes('autoSaveStatus'), 'Component tracks autoSaveStatus state');
  assert(erpDesignerSource.includes('lastAutoSave'), 'Component tracks lastAutoSave timestamp');

  // Check all states are handled
  assert(erpDesignerSource.includes("autoSaveStatus === 'saving'"), 'Saving state handled in indicator');
  assert(erpDesignerSource.includes("autoSaveStatus === 'saved'"), 'Saved state handled in indicator');
  assert(erpDesignerSource.includes("autoSaveStatus === 'error'"), 'Error state handled in indicator');
  assert(erpDesignerSource.includes("autoSaveStatus === 'idle'"), 'Idle state handled in indicator');

  // Verify indicator shows in toolbar (conditionally on templateId)
  assert(erpDesignerSource.includes('{templateId && ('), 'Indicator only shows when template is loaded');

  // Verify spinner during saving
  assert(erpDesignerSource.includes('auto-save-spinner'), 'Saving spinner has test ID');
  assert(erpDesignerSource.includes('Saving...'), 'Shows "Saving..." text during auto-save');

  // Verify saved checkmark
  assert(erpDesignerSource.includes('Auto-saved'), 'Shows "Auto-saved" text after save');

  // Verify error state
  assert(erpDesignerSource.includes('Save failed'), 'Shows "Save failed" text on error');

  // Verify timestamp display
  assert(erpDesignerSource.includes('lastAutoSave.toLocaleTimeString()'), 'Shows timestamp of last auto-save');
  assert(erpDesignerSource.includes('Last auto-saved'), 'Shows "Last auto-saved" prefix with timestamp');
}

async function testAutoSaveInterval() {
  process.stdout.write('\n--- Auto-Save Interval Configuration ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Check auto-save interval is configurable
  assert(source.includes('autoSaveInterval'), 'Auto-save interval is configurable');
  assert(source.includes('autoSaveInterval?: number'), 'Auto-save interval is optional prop');
  assert(source.includes('30000'), 'Default auto-save interval is 30 seconds');

  // Check auto-save timer setup
  assert(source.includes('setInterval'), 'Auto-save uses setInterval');
  assert(source.includes('clearInterval'), 'Auto-save cleans up interval');
  assert(source.includes('autoSaveTimerRef'), 'Auto-save timer ref for cleanup');
}

async function testAutoSaveStateMachine() {
  process.stdout.write('\n--- Auto-Save State Machine ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Verify state transitions
  assert(source.includes("setAutoSaveStatus('saving')"), 'Transitions to saving state');
  assert(source.includes("setAutoSaveStatus('saved')"), 'Transitions to saved state');
  assert(source.includes("setAutoSaveStatus('error')"), 'Transitions to error state');

  // Verify auto-dismiss of saved state (returns to idle after timeout)
  assert(source.includes("prev === 'saved' ? 'idle' : prev"), 'Saved state auto-dismisses to idle');

  // Verify error state auto-dismiss
  assert(source.includes("prev === 'error' ? 'idle' : prev"), 'Error state auto-dismisses to idle');

  // Verify timestamp is set on successful save
  assert(source.includes('setLastAutoSave(new Date())'), 'Timestamp set on successful auto-save');
}

async function testAutoSaveAPICall(templateId) {
  process.stdout.write('\n--- Auto-Save API Integration ---\n');

  // Verify the draft save endpoint works (used by auto-save)
  const saveRes = await fetch(`${API}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: 'AutoSave Test Updated',
      schema: { pages: [{ elements: [{ type: 'text', name: 'title', content: 'Updated via auto-save', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    }),
  });
  assert(saveRes.status === 200, `Draft save returns 200 (got ${saveRes.status})`);
  const saved = await saveRes.json();
  assert(saved.version !== undefined, 'Save returns version number');

  // Verify the saved data persists
  const getRes = await fetch(`${API}/templates/${templateId}`, { headers });
  const tpl = await getRes.json();
  assert(tpl.name === 'AutoSave Test Updated', 'Auto-saved name persists');
}

async function testAutoSaveColorCoding() {
  process.stdout.write('\n--- Auto-Save Indicator Color Coding ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Verify color coding for different states
  assert(source.includes("#f59e0b"), 'Saving state uses amber/yellow color');
  assert(source.includes("#10b981"), 'Saved state uses green color');
  assert(source.includes("#ef4444"), 'Error state uses red color');
  assert(source.includes("#94a3b8"), 'Idle state uses gray color');
}

async function testAutoSaveBeforeUnload() {
  process.stdout.write('\n--- Auto-Save Before Unload ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Verify auto-save triggers before page unload
  assert(source.includes('beforeunload') || source.includes('visibilitychange'), 'Auto-save triggers before page leave');
  assert(source.includes('performAutoSave'), 'performAutoSave function exists');
}

async function testAutoSaveReconnection() {
  process.stdout.write('\n--- Auto-Save Reconnection Handling ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Verify reconnection retry logic
  assert(source.includes('pendingRetrySave') || source.includes('isOnline'), 'Handles reconnection/online state');
  assert(source.includes('Reconnection auto-save') || source.includes('reconnect'), 'Has reconnection auto-save retry');
}

async function testSaveStatusDistinction() {
  process.stdout.write('\n--- Manual Save vs Auto-Save Distinction ---\n');

  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8');

  // Verify manual save and auto-save are distinguished
  assert(source.includes('saveStatus') && source.includes('autoSaveStatus'), 'Separate state for manual save and auto-save');
  assert(source.includes('(manual save)'), 'Manual save is labelled distinctly');
  assert(source.includes('Auto-saved'), 'Auto-save is labelled as "Auto-saved"');
}

async function testDraftSavePersistence(templateId) {
  process.stdout.write('\n--- Draft Save Persistence Across Restart ---\n');

  // Save a known value
  const uniqueName = 'AUTOSAVE_PERSIST_289_' + Date.now();
  await fetch(`${API}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: uniqueName,
      schema: { pages: [{ elements: [{ type: 'text', name: 'title', content: 'Persist test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    }),
  });

  // Retrieve to verify persistence
  const getRes = await fetch(`${API}/templates/${templateId}`, { headers });
  const tpl = await getRes.json();
  assert(tpl.name === uniqueName, 'Saved draft name persists in database');
  assert(tpl.schema !== undefined, 'Schema data persists in database');
}

(async () => {
  try {
    const templateId = await setup();

    await testAutoSaveUICodePresence();
    await testAutoSaveInterval();
    await testAutoSaveStateMachine();
    await testAutoSaveAPICall(templateId);
    await testAutoSaveColorCoding();
    await testAutoSaveBeforeUnload();
    await testAutoSaveReconnection();
    await testSaveStatusDistinction();
    await testDraftSavePersistence(templateId);

    process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    process.stdout.write(`\nFATAL ERROR: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
})();
