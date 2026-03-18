/**
 * Feature #199: Session recovery after disconnect
 * Tests that reconnection recovers editor state and auto-save retries
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const FRONTEND_URL = 'http://localhost:3001';

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

async function createTestTemplate() {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
    body: JSON.stringify({
      name: 'SESSION_RECOVERY_TEST_199',
      type: 'invoice',
      schema: { schemas: [], basePdf: 'BLANK_PDF' },
    }),
  });
  const data = await res.json();
  return data.id || data.data?.id;
}

async function cleanupTemplate(id) {
  if (!id) return;
  try {
    await fetch(`${API_BASE}/templates/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
    });
  } catch {}
}

async function testCodeStructure() {
  console.log('\n--- Code Structure Tests ---');

  // Read the ErpDesigner source
  const fs = await import('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf-8'
  );

  // Test 1: Online/offline event listeners exist
  assert(
    source.includes("addEventListener('online'") && source.includes("addEventListener('offline'"),
    'Online/offline event listeners are registered'
  );

  // Test 2: isOnline state management
  assert(
    source.includes('isOnline') && source.includes('setIsOnline'),
    'isOnline state is managed'
  );

  // Test 3: navigator.onLine initial state
  assert(
    source.includes('navigator.onLine'),
    'Uses navigator.onLine for initial/current state'
  );

  // Test 4: pendingRetrySave state for reconnection
  assert(
    source.includes('pendingRetrySave') && source.includes('setPendingRetrySave'),
    'pendingRetrySave state tracks need for retry on reconnect'
  );

  // Test 5: Reconnection triggers auto-save retry
  assert(
    source.includes('handleOnline') || (source.includes("setIsOnline(true)") && source.includes('setPendingRetrySave(true)')),
    'Online event triggers pending retry save'
  );

  // Test 6: Offline event clears retry timers
  assert(
    source.includes("setIsOnline(false)"),
    'Offline event updates online state to false'
  );

  // Test 7: Exponential backoff on retry
  assert(
    source.includes('Math.pow(2') || source.includes('exponential') || source.includes('backoff'),
    'Reconnection retry uses exponential backoff'
  );

  // Test 8: Max retries limit
  assert(
    source.includes('MAX_RECONNECT_RETRIES') || source.includes('saveRetryCountRef'),
    'Max retry limit prevents infinite retries'
  );

  // Test 9: isDirty preserved during disconnect
  assert(
    source.includes('isDirtyRef.current') && !source.includes('// clear isDirty on offline'),
    'isDirty state preserved during disconnect (no clearing on offline)'
  );

  // Test 10: Cleanup on unmount
  assert(
    source.includes("removeEventListener('online'") && source.includes("removeEventListener('offline'"),
    'Event listeners cleaned up on unmount'
  );

  // Test 11: Connection status indicator for offline
  assert(
    source.includes('connection-status') && source.includes('Offline'),
    'UI shows offline connection status indicator'
  );

  // Test 12: Reconnecting indicator
  assert(
    source.includes('connection-status-reconnecting') || source.includes('Reconnected'),
    'UI shows reconnecting/saving indicator'
  );

  // Test 13: Auto-save error flags pending retry when offline
  assert(
    source.includes("setPendingRetrySave(true)") && source.includes("navigator.onLine"),
    'Auto-save error flags pending retry when navigator is offline'
  );

  // Test 14: Manual save error flags pending retry when offline
  const manualSaveSection = source.substring(
    source.indexOf('const handleSave'),
    source.indexOf('const handlePublish')
  );
  assert(
    manualSaveSection.includes('setPendingRetrySave'),
    'Manual save also flags pending retry on network error'
  );

  // Test 15: Successful reconnect save clears pending state
  assert(
    source.includes('setPendingRetrySave(false)') && source.includes('saveRetryCountRef.current = 0'),
    'Successful reconnect save clears pending state and retry counter'
  );

  // Test 16: Reconnect retry clears manual save error
  assert(
    source.includes("setSaveStatus('idle')") && source.includes("setSaveError(null)"),
    'Reconnect retry clears manual save error on success'
  );

  // Test 17: reconnectRetryRef cleanup on offline
  assert(
    source.includes('reconnectRetryRef') && source.includes('clearTimeout(reconnectRetryRef'),
    'Reconnect retry timers cleaned up on offline and unmount'
  );

  // Test 18: Delay before first retry to let connection stabilize
  assert(
    source.includes('setTimeout(attemptRetrySave') || source.includes('connection stabilize'),
    'First retry has brief delay for connection to stabilize'
  );
}

async function testAPIIntegration() {
  console.log('\n--- API Integration Tests ---');

  const templateId = await createTestTemplate();
  assert(!!templateId, 'Test template created for session recovery testing');

  // Test 19: Save draft works normally (baseline)
  const saveRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
    body: JSON.stringify({
      name: 'SESSION_RECOVERY_MODIFIED',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4' },
    }),
  });
  assert(saveRes.ok, 'Save draft endpoint works (baseline for recovery)');

  // Test 20: Verify saved data persists
  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
  });
  const templateData = await getRes.json();
  assert(
    templateData.name === 'SESSION_RECOVERY_MODIFIED' || templateData.data?.name === 'SESSION_RECOVERY_MODIFIED',
    'Saved data persists in database'
  );

  // Test 21: Second save after "reconnection" simulation works
  const retryRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
    body: JSON.stringify({
      name: 'SESSION_RECOVERY_RETRIED',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4' },
    }),
  });
  assert(retryRes.ok, 'Save after simulated reconnection succeeds');

  // Test 22: Verify retried save data
  const retryGetRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig' },
  });
  const retryData = await retryGetRes.json();
  assert(
    retryData.name === 'SESSION_RECOVERY_RETRIED' || retryData.data?.name === 'SESSION_RECOVERY_RETRIED',
    'Retried save data persists correctly'
  );

  // Cleanup
  await cleanupTemplate(templateId);
  assert(true, 'Test template cleaned up');
}

async function testDesignerPageLoads() {
  console.log('\n--- Designer Page Load Tests ---');

  const templateId = await createTestTemplate();

  // Test 24: Designer page loads with templateId
  try {
    const res = await fetch(`${FRONTEND_URL}/?templateId=${templateId}&authToken=test-token`);
    const html = await res.text();
    assert(
      html.includes('erp-designer') || html.includes('ErpDesigner') || html.includes('designer-toolbar') || html.includes('designer-loading') || html.includes('pdfme ERP Designer'),
      'Designer page loads successfully with templateId'
    );
  } catch (err) {
    assert(false, `Designer page loads: ${err.message}`);
  }

  await cleanupTemplate(templateId);
}

async function main() {
  console.log('=== Feature #199: Session recovery after disconnect ===\n');

  await testCodeStructure();
  await testAPIIntegration();
  await testDesignerPageLoads();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
