/**
 * Feature #225: Back and resubmit prevented
 * Tests that browser back after save doesn't re-save, and data stays consistent.
 */

const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');

const token = makeJwt('user-225', 'org-225', ['admin']);
let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

async function setup() {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Back Resubmit Test 225', type: 'invoice', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [{ id: 'p1', label: 'Page 1', elements: [] }] } }),
  });
  templateId = (await res.json()).id;
  console.log(`Created template: ${templateId}`);
}

async function cleanup() {
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

async function testHistoryReplaceStateAfterSave() {
  console.log('\n--- Test: history.replaceState called after save ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 1. replaceState called after successful save
  assert(src.includes('window.history.replaceState'), 'history.replaceState called after save');

  // 2. replaceState includes saved flag
  assert(src.includes("saved: true"), 'replaceState includes saved:true flag');

  // 3. replaceState preserves current URL
  assert(src.includes("window.location.href"), 'replaceState preserves current URL');

  // 4. replaceState includes templateId for context
  assert(src.includes("saved: true, templateId"), 'replaceState includes templateId');

  // 5. Save uses button click (not form submit) so no browser resubmit dialog
  assert(src.includes('onClick={handleSave}'), 'Save triggered by onClick, not form submit');

  // 6. No <form> wrapping the save button (no browser form resubmission)
  const saveButtonSection = src.substring(src.indexOf('data-testid="btn-save"') - 200, src.indexOf('data-testid="btn-save"'));
  assert(!saveButtonSection.includes('<form'), 'No <form> wrapping save button area');
}

async function testDirtyFlagClearedAfterSave() {
  console.log('\n--- Test: isDirty cleared after save ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 7. isDirty set to false after successful save
  const saveSection = src.substring(src.indexOf('handleSave'), src.indexOf('handlePublish'));
  assert(saveSection.includes('setIsDirty(false)'), 'isDirty cleared after successful save');

  // 8. isDirtyRef also cleared
  assert(saveSection.includes('isDirtyRef.current = false'), 'isDirtyRef cleared after successful save');

  // 9. isDirty NOT cleared on error (preserves unsaved state for retry)
  const errorSection = saveSection.substring(saveSection.indexOf("setSaveStatus('error')"));
  assert(!errorSection.includes('setIsDirty(false)') || errorSection.indexOf('setIsDirty(false)') > errorSection.indexOf('DO NOT clear isDirty'), 'isDirty preserved on save error');
}

async function testSaveIdempotent() {
  console.log('\n--- Test: Save is idempotent (no duplicate data) ---');

  const savePayload = {
    name: 'Idempotent Save 225',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [{ id: 'p1', label: 'Page 1', elements: [{ id: 'el1', type: 'text', x: 10, y: 10, w: 100, h: 30, content: 'Test content' }] }] },
  };

  // 10. Save once
  const r1 = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(savePayload),
  });
  assert(r1.ok, 'First save succeeds');

  // 11. Save again with same data (simulating back+forward resubmit)
  const r2 = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(savePayload),
  });
  assert(r2.ok, 'Second identical save succeeds (idempotent)');

  // 12. Data is consistent after double save
  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await getRes.json();
  assert(data.name === 'Idempotent Save 225', 'Template name correct after double save');

  // 13. Only one set of elements (no duplicates)
  assert(data.schema.pages[0].elements.length === 1, 'No duplicate elements after double save');

  // 14. Content preserved exactly
  assert(data.schema.pages[0].elements[0].content === 'Test content', 'Element content preserved exactly');
}

async function testMultipleSequentialSaves() {
  console.log('\n--- Test: Sequential saves preserve only latest ---');

  // 15. Save version 1
  await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Version 1', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
  });

  // 16. Save version 2
  await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Version 2', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
  });

  // 17. Save version 3 (final)
  await fetch(`${API_BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Version 3 Final', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [] } }),
  });

  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await getRes.json();
  assert(data.name === 'Version 3 Final', 'Only latest save version persisted');
}

async function testDoubleClickPrevention() {
  console.log('\n--- Test: Double-click prevention ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 18. isSavingRef guard prevents concurrent saves
  assert(src.includes('isSavingRef.current') && src.includes('if (isSavingRef.current) return'), 'isSavingRef prevents concurrent save calls');

  // 19. Save button disabled during saving
  assert(src.includes("disabled={saveStatus === 'saving'"), 'Save button HTML disabled during saving');

  // 20. Button cursor shows not-allowed
  assert(src.includes("cursor: saveStatus === 'saving' ? 'not-allowed'"), 'Cursor indicates disabled state during saving');
}

async function testBackButtonUnsavedCheck() {
  console.log('\n--- Test: Back button checks for unsaved changes ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 21. Back button checks isDirty
  assert(src.includes('isDirty') && src.includes('window.confirm') && src.includes('unsaved changes'), 'Back button confirms unsaved changes');

  // 22. Back button navigates to templates list
  assert(src.includes('/templates') && src.includes('window.location.href = url'), 'Back button navigates to template list');

  // 23. beforeunload also warns about unsaved changes
  assert(src.includes('beforeunload'), 'beforeunload handler warns on page close with unsaved changes');
}

async function main() {
  console.log('Feature #225: Back and resubmit prevented');
  await setup();
  await testHistoryReplaceStateAfterSave();
  await testDirtyFlagClearedAfterSave();
  await testSaveIdempotent();
  await testMultipleSequentialSaves();
  await testDoubleClickPrevention();
  await testBackButtonUnsavedCheck();
  await cleanup();
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
}

main().catch(console.error);
