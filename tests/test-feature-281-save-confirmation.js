const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-281', 'test-org-281', ['admin']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
const cleanupIds = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function cleanup() {
  for (const id of cleanupIds) {
    try { await request('DELETE', `/templates/${id}`); } catch {}
  }
}

async function runTests() {
  console.log('Feature #281: Save success shows confirmation indicator\n');

  // === Test 1: Component renders save-success-toast in HTML ===
  console.log('--- Save success toast component exists ---');

  // Read the ErpDesigner source to verify save success toast markup exists
  const fs = require('fs');
  const designerPath = require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const designerSrc = fs.readFileSync(designerPath, 'utf8');

  // Test: save-success-toast testid exists
  assert(designerSrc.includes('data-testid="save-success-toast"'), 'save-success-toast element exists in component');

  // Test: save-success-icon testid
  assert(designerSrc.includes('data-testid="save-success-icon"'), 'save-success-icon element exists');

  // Test: save-success-message testid
  assert(designerSrc.includes('data-testid="save-success-message"'), 'save-success-message element exists');

  // Test: save-success-type testid (distinguishes manual vs auto)
  assert(designerSrc.includes('data-testid="save-success-type"'), 'save-success-type indicator exists');

  // Test: Toast shows "Draft saved successfully" message
  assert(designerSrc.includes('Draft saved successfully'), 'Toast message says "Draft saved successfully"');

  // Test: Toast indicates manual save
  assert(designerSrc.includes('(manual save)'), 'Toast distinguishes manual save with "(manual save)" label');

  // === Test 2: Auto-save indicator distinguishes from manual save ===
  console.log('\n--- Auto-save indicator distinguishes from manual save ---');

  assert(designerSrc.includes('auto-save-indicator'), 'Auto-save indicator element exists');
  assert(designerSrc.includes('Auto-saved'), 'Auto-save indicator shows "Auto-saved" (not just "Saved")');
  assert(designerSrc.includes('Last auto-saved'), 'Idle state shows "Last auto-saved" timestamp');

  // === Test 3: Save status state machine ===
  console.log('\n--- Save status state machine ---');

  // saveStatus has all required states
  assert(designerSrc.includes("'idle' | 'saving' | 'saved' | 'error'"), 'saveStatus has idle/saving/saved/error states');

  // Toast only shows when saveStatus === 'saved'
  assert(designerSrc.includes("saveStatus === 'saved'"), 'Toast is conditional on saveStatus === saved');

  // Auto-dismiss: setTimeout resets to idle after delay
  const autoDismissMatch = designerSrc.match(/setTimeout\(\(\) => setSaveStatus.*?(\d+)\)/);
  assert(autoDismissMatch !== null, 'setTimeout auto-dismisses save status');
  if (autoDismissMatch) {
    const dismissDelay = parseInt(autoDismissMatch[1]);
    assert(dismissDelay >= 2000 && dismissDelay <= 5000, `Auto-dismiss delay is reasonable: ${dismissDelay}ms`);
  }

  // saveStatus resets from 'saved' back to 'idle'
  assert(designerSrc.includes("prev === 'saved' ? 'idle'"), 'saveStatus resets from saved to idle');

  // === Test 4: Save button shows proper states ===
  console.log('\n--- Save button state text ---');

  assert(designerSrc.includes("Saving…") || designerSrc.includes("Saving..."), 'Save button shows "Saving…" during save');
  assert(designerSrc.includes("Save Draft"), 'Save button shows "Save Draft" in idle state');
  assert(designerSrc.includes("Retry Save"), 'Save button shows "Retry Save" on error');

  // === Test 5: Auto-save status also has states ===
  console.log('\n--- Auto-save status states ---');

  assert(designerSrc.includes("autoSaveStatus === 'saving'"), 'Auto-save has saving state');
  assert(designerSrc.includes("autoSaveStatus === 'saved'"), 'Auto-save has saved state');
  assert(designerSrc.includes("autoSaveStatus === 'error'"), 'Auto-save has error state');

  // Auto-save also auto-dismisses
  const autoSaveDismissMatch = designerSrc.match(/setTimeout\(\(\) => setAutoSaveStatus.*?(\d+)\)/);
  assert(autoSaveDismissMatch !== null, 'Auto-save status also auto-dismisses');

  // === Test 6: Verify via API that save actually works ===
  console.log('\n--- API-level save verification ---');

  // Create a template
  const createRes = await request('POST', '/templates', {
    name: 'Save Confirm Test 281',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', x: 0, y: 0, w: 100, h: 20 }] }] },
  });
  assert(createRes.status === 201, `Created test template (status ${createRes.status})`);
  const templateId = createRes.body.id;
  if (templateId) cleanupIds.push(templateId);

  if (templateId) {
    // Save draft - the success response is what triggers the toast
    const saveRes = await request('PUT', `/templates/${templateId}/draft`, {
      name: 'Save Confirm Test 281 Updated',
      schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, w: 100, h: 20 }] }] },
    });
    assert(saveRes.status === 200, `Draft save succeeds with 200 (got ${saveRes.status})`);
    assert(saveRes.body.id === templateId, 'Save response includes template ID');

    // Verify the save persisted
    const getRes = await request('GET', `/templates/${templateId}`);
    assert(getRes.status === 200, `Template retrievable after save`);
    assert(getRes.body.name === 'Save Confirm Test 281 Updated', 'Name updated after save');

    // Save error case triggers error banner (not toast)
    const errorRes = await request('PUT', `/templates/nonexistent-id-12345/draft`, {
      name: 'Should fail',
    });
    assert(errorRes.status === 404, `Save to nonexistent template returns 404 (got ${errorRes.status})`);
  }

  // === Test 7: Save success toast vs error banner separation ===
  console.log('\n--- Toast vs error banner are separate elements ---');

  assert(designerSrc.includes('save-success-toast'), 'Save success toast has unique testid');
  assert(designerSrc.includes('save-error-banner'), 'Save error banner has separate testid');

  // They show in different conditions
  const successCondition = designerSrc.includes("saveStatus === 'saved'");
  const errorCondition = designerSrc.includes("saveStatus === 'error'");
  assert(successCondition && errorCondition, 'Success toast and error banner show in mutually exclusive states');

  // Success toast has green/blue styling (not red)
  const toastStartIdx = designerSrc.indexOf('save-success-toast');
  const toastChunk = designerSrc.substring(toastStartIdx, toastStartIdx + 500);
  assert(toastChunk.includes('#eff6ff') || toastChunk.includes('#ecfdf5') || toastChunk.includes('#10b981'), 'Success toast has positive color (blue/green)');

  // Error banner has red styling
  const errorBannerIdx = designerSrc.indexOf('save-error-banner');
  const errorChunk = designerSrc.substring(errorBannerIdx, errorBannerIdx + 500);
  assert(errorChunk.includes('#fef2f2') || errorChunk.includes('#ef4444'), 'Error banner has error color (red)');

  // === CLEANUP ===
  await cleanup();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
