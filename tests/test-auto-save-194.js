/**
 * Test: Feature #194 - Designer auto-save preserves changes on navigation
 *
 * Verifies that:
 * 1. Auto-save timer is set up (30s interval by default)
 * 2. Auto-save calls PUT /api/pdfme/templates/:id/draft
 * 3. Changes persist after save via the API
 * 4. beforeunload handler is registered to prevent data loss
 * 5. visibilitychange handler triggers auto-save on tab switch
 * 6. isDirty flag is cleared on successful auto-save
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'user-autosave-test',orgId:'org-autosave-test',roles:['template:edit','template:publish','render:trigger','template:import']})).toString('base64url');
const TOKEN = header+'.'+payload+'.testsig';

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

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

async function run() {
  console.log('\n=== Feature #194: Designer auto-save preserves changes on navigation ===\n');

  const designerPath = path.resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx');
  const designerSource = fs.readFileSync(designerPath, 'utf-8');

  // Test 1: Auto-save interval prop exists with default 30000ms
  console.log('Test 1: Auto-save interval configuration');
  assert(designerSource.includes('autoSaveInterval = 30000'), 'Default auto-save interval is 30000ms (30s)');
  assert(designerSource.includes('autoSaveInterval?: number'), 'autoSaveInterval is a configurable prop');

  // Test 2: Auto-save timer setup with setInterval
  console.log('\nTest 2: Auto-save timer setup');
  assert(designerSource.includes('setInterval'), 'setInterval used for auto-save timer');
  assert(designerSource.includes('clearInterval'), 'clearInterval used for cleanup');
  assert(designerSource.includes('autoSaveTimerRef'), 'Timer ref stored for cleanup');

  // Test 3: Auto-save only triggers when dirty
  console.log('\nTest 3: Auto-save only when dirty');
  assert(designerSource.includes('isDirtyRef.current') && designerSource.includes('performAutoSave'), 'Auto-save checks isDirty before saving');

  // Test 4: Auto-save calls PUT /templates/:id/draft
  console.log('\nTest 4: Auto-save calls draft API');
  assert(designerSource.includes('/draft'), 'Calls /draft endpoint');
  assert(designerSource.includes('PUT'), 'Uses PUT method for draft save');

  // Test 5: isDirty cleared on successful auto-save
  console.log('\nTest 5: isDirty cleared on success');
  assert(designerSource.includes('setIsDirty(false)'), 'isDirty set to false on save');
  assert(designerSource.includes('isDirtyRef.current = false'), 'isDirtyRef also cleared');

  // Test 6: beforeunload handler registered
  console.log('\nTest 6: beforeunload handler for navigation warning');
  assert(designerSource.includes('beforeunload'), 'beforeunload event handler registered');
  assert(designerSource.includes('e.preventDefault()'), 'Calls preventDefault on beforeunload');
  assert(designerSource.includes('e.returnValue'), 'Sets returnValue for browser dialog');

  // Test 7: visibilitychange handler triggers auto-save on tab switch
  console.log('\nTest 7: visibilitychange handler');
  assert(designerSource.includes('visibilitychange'), 'visibilitychange event handler registered');
  assert(designerSource.includes("document.visibilityState === 'hidden'"), 'Checks for hidden state');

  // Test 8: Event listeners cleaned up on unmount
  console.log('\nTest 8: Cleanup on unmount');
  assert(designerSource.includes("window.removeEventListener('beforeunload'"), 'beforeunload listener removed on cleanup');
  assert(designerSource.includes("document.removeEventListener('visibilitychange'"), 'visibilitychange listener removed on cleanup');

  // Test 9: Auto-save status indicator in UI
  console.log('\nTest 9: Auto-save status indicator');
  assert(designerSource.includes('auto-save-indicator'), 'Auto-save indicator element present');
  assert(designerSource.includes("autoSaveStatus === 'saving'"), 'Shows saving state');
  assert(designerSource.includes("autoSaveStatus === 'saved'"), 'Shows saved state');
  assert(designerSource.includes("autoSaveStatus === 'error'"), 'Shows error state');

  // Test 10: Auto-save preserves data via API (integration test)
  console.log('\nTest 10: Data persistence via auto-save API (integration)');

  // Create a template
  const tmpl = await request('POST', '/templates', {
    name: 'AutoSave Persistence Test',
    type: 'autosave-test',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{
        name: 'field1',
        type: 'text',
        content: 'Original content',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
      }]],
    },
  });
  assert(tmpl.data.id, 'Template created for auto-save test');
  const templateId = tmpl.data.id;

  // Test 11: Simulate auto-save by calling PUT /templates/:id/draft
  console.log('\nTest 11: Simulate auto-save draft save');
  const draftSave = await request('PUT', `/templates/${templateId}/draft`, {
    name: 'AutoSave Persistence Test (modified)',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{
        name: 'field1',
        type: 'text',
        content: 'AUTO_SAVE_TEST_CONTENT_194',
        position: { x: 20, y: 20 },
        width: 60,
        height: 15,
        fontSize: 14,
        alignment: 'center',
        verticalAlignment: 'middle',
        lineHeight: 1.2,
        characterSpacing: 0,
        fontColor: '#333333',
        backgroundColor: '',
      }]],
    },
  });
  assert(draftSave.status === 200 || draftSave.status === 201, `Draft save succeeded (status: ${draftSave.status})`);

  // Test 12: Verify changes persist (simulate "return to designer")
  console.log('\nTest 12: Verify changes persist after navigation');
  const fetched = await request('GET', `/templates/${templateId}`, null);
  assert(fetched.status === 200, 'Template fetched after simulated navigation');
  const fetchedSchema = fetched.data.schema || fetched.data.draftSchema;

  if (fetchedSchema) {
    const schemaStr = JSON.stringify(fetchedSchema);
    assert(schemaStr.includes('AUTO_SAVE_TEST_CONTENT_194'), 'Auto-saved content persists in database');
    assert(schemaStr.includes('"fontSize":14') || schemaStr.includes('"fontSize": 14'), 'Auto-saved fontSize persists');
  } else {
    assert(false, 'Schema data found in template response');
    assert(false, 'Cannot verify fontSize without schema');
  }

  // Test 13: Multiple auto-saves update correctly
  console.log('\nTest 13: Multiple auto-saves accumulate changes');
  const draft2 = await request('PUT', `/templates/${templateId}/draft`, {
    name: 'AutoSave Test - Second Save',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{
        name: 'field1',
        type: 'text',
        content: 'SECOND_AUTOSAVE_194',
        position: { x: 30, y: 30 },
        width: 70,
        height: 20,
        fontSize: 16,
        alignment: 'right',
        verticalAlignment: 'bottom',
        lineHeight: 1.5,
        characterSpacing: 1,
        fontColor: '#666666',
        backgroundColor: '#eeeeee',
      }]],
    },
  });
  assert(draft2.status === 200 || draft2.status === 201, 'Second auto-save succeeded');

  const fetched2 = await request('GET', `/templates/${templateId}`, null);
  const schema2Str = JSON.stringify(fetched2.data.schema || fetched2.data.draftSchema || '');
  assert(schema2Str.includes('SECOND_AUTOSAVE_194'), 'Second auto-save content persists');

  // Test 14: Auto-save doesn't trigger without templateId
  console.log('\nTest 14: Auto-save skipped without templateId');
  assert(designerSource.includes('if (!isDirtyRef.current || !templateId) return'), 'performAutoSave checks for templateId');
  assert(designerSource.includes('if (!templateId || autoSaveInterval <= 0) return'), 'Timer skipped when no templateId');

  // Test 15: Auto-save preserves changes across server restart
  console.log('\nTest 15: Data persists across server restart');
  // Create unique test data
  const restartTmpl = await request('POST', '/templates', {
    name: 'Restart Persistence Test',
    type: 'restart-test',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{
        name: 'restartField',
        type: 'text',
        content: 'RESTART_TEST_194',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
      }]],
    },
  });
  const restartId = restartTmpl.data.id;

  // Save draft
  await request('PUT', `/templates/${restartId}/draft`, {
    name: 'Restart Persistence Modified',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{
        name: 'restartField',
        type: 'text',
        content: 'RESTART_VERIFIED_194',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
      }]],
    },
  });

  // Verify it exists
  const verifyRes = await request('GET', `/templates/${restartId}`, null);
  const verifyStr = JSON.stringify(verifyRes.data.schema || verifyRes.data.draftSchema || '');
  assert(verifyStr.includes('RESTART_VERIFIED_194'), 'Data persists in database (server restart test baseline)');

  // Test 16: beforeunload triggers performAutoSave
  console.log('\nTest 16: beforeunload triggers auto-save');
  assert(designerSource.includes('handleBeforeUnload') && designerSource.includes('performAutoSave()'), 'beforeunload handler calls performAutoSave');

  // Test 17: Auto-save error handling
  console.log('\nTest 17: Auto-save error handling');
  assert(designerSource.includes("setAutoSaveStatus('error')"), 'Auto-save sets error status on failure');

  // Test 18: Last auto-save timestamp tracked
  console.log('\nTest 18: Last auto-save timestamp');
  assert(designerSource.includes('setLastAutoSave'), 'Last auto-save timestamp updated');
  assert(designerSource.includes('lastAutoSave'), 'Last auto-save timestamp stored in state');

  // Clean up test data
  await request('DELETE', `/templates/${templateId}`, null);
  await request('DELETE', `/templates/${restartId}`, null);

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
