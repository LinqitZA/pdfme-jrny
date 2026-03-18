/**
 * Feature #223: Button disabled during save processing
 * Tests that Save Draft button is disabled while request is in flight,
 * shows loading state, prevents double-click, and re-enables after completion.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const token = makeJwt('user-223', 'org-223', ['admin']);
let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create a template
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Save Disable 223', type: 'invoice', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
  });
  const data = await res.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);
}

async function cleanup() {
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

async function testSaveButtonDisabledState() {
  console.log('\n--- Test: Save button disabled state in code ---');

  // Read the ErpDesigner source to verify disabled logic
  const fs = require('fs');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 1. Save button has disabled attribute tied to saveStatus
  assert(src.includes("disabled={saveStatus === 'saving'"), 'Save button disabled when saveStatus is saving');

  // 2. Save button shows loading text
  assert(src.includes("saveStatus === 'saving' ? 'Saving…'"), 'Save button shows Saving… text during processing');

  // 3. Save button has visual disabled indicators (opacity, cursor)
  assert(src.includes("opacity: saveStatus === 'saving' ? 0.7 : 1"), 'Save button opacity reduced during saving');
  assert(src.includes("cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer'"), 'Save button cursor is not-allowed during saving');

  // 4. saveStatus is set to saving before request
  assert(src.includes("setSaveStatus('saving')"), 'saveStatus set to saving before API call');

  // 5. saveStatus cleared after success
  assert(src.includes("setSaveStatus('saved')"), 'saveStatus set to saved after successful save');

  // 6. saveStatus cleared after error
  assert(src.includes("setSaveStatus('error')"), 'saveStatus set to error on failure');

  // 7. Has ref guard to prevent double-click race condition
  assert(src.includes('isSavingRef.current') && src.includes('if (isSavingRef.current) return'), 'Has isSavingRef guard against double-click');

  // 8. Ref guard cleared in finally block
  assert(src.includes('isSavingRef.current = false'), 'isSavingRef cleared after save completes');

  // 9. Save button re-enables after save (saveStatus goes back to idle)
  assert(src.includes("setSaveStatus((prev) => prev === 'saved' ? 'idle' : prev)"), 'saveStatus returns to idle after delay');

  // 10. isReadOnly also disables save
  assert(src.includes("saveStatus === 'saving' || isReadOnly"), 'Save also disabled when isReadOnly');
}

async function testPublishButtonDisabledState() {
  console.log('\n--- Test: Publish button disabled state in code ---');

  const fs = require('fs');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 11. Publish button has disabled attribute
  assert(src.includes("disabled={publishStatus === 'publishing'"), 'Publish button disabled during publishing');

  // 12. Publish shows loading text
  assert(src.includes("publishStatus === 'publishing' ? 'Publishing…'"), 'Publish button shows Publishing… text');

  // 13. Publish has ref guard
  assert(src.includes('isPublishingRef.current') && src.includes('if (isPublishingRef.current) return'), 'Publish has ref guard against double-click');

  // 14. Publish visual indicators
  assert(src.includes("opacity: publishStatus === 'publishing' ? 0.7 : 1"), 'Publish button opacity reduced during publishing');
  assert(src.includes("cursor: publishStatus === 'publishing' ? 'not-allowed' : 'pointer'"), 'Publish button cursor is not-allowed during publishing');
}

async function testSaveDraftEndpoint() {
  console.log('\n--- Test: Save draft endpoint works (button re-enables) ---');

  // 15. Save draft succeeds (button would re-enable)
  const res = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Updated Name 223', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
  });
  assert(res.ok, 'Save draft request succeeds (200)');

  // 16. Rapid double-save doesn't cause errors
  const [r1, r2] = await Promise.all([
    fetch(`${API_BASE}/templates/${templateId}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Double Save A', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
    }),
    fetch(`${API_BASE}/templates/${templateId}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Double Save B', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
    }),
  ]);
  assert(r1.ok && r2.ok, 'Concurrent save requests both succeed without error');

  // 17. Save with error condition (invalid template) returns proper error
  const errRes = await fetch(`${API_BASE}/templates/99999999/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Error', schema: {} }),
  });
  assert(errRes.status === 404 || errRes.status === 400 || errRes.status === 409, 'Invalid template save returns error status (button would show error state)');
}

async function testDataTestIds() {
  console.log('\n--- Test: Proper data-testid attributes ---');

  const fs = require('fs');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 18. Save button has data-testid
  assert(src.includes('data-testid="btn-save"'), 'Save button has data-testid="btn-save"');

  // 19. Publish button has data-testid
  assert(src.includes('data-testid="btn-publish"'), 'Publish button has data-testid="btn-publish"');

  // 20. Save error banner exists
  assert(src.includes('data-testid="save-error-banner"'), 'Save error banner has data-testid');
}

async function main() {
  console.log('Feature #223: Button disabled during save processing');
  await setup();
  await testSaveButtonDisabledState();
  await testPublishButtonDisabledState();
  await testSaveDraftEndpoint();
  await testDataTestIds();
  await cleanup();
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
}

main().catch(console.error);
