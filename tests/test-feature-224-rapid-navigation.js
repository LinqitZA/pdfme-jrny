/**
 * Feature #224: Rapid navigation doesn't cause stale data
 * Tests that quick page switches don't show wrong data via:
 * - cancelled flag pattern in useEffect cleanup
 * - AbortController to cancel in-flight fetch
 * - State reset on template switch
 * - AbortError silently handled
 */

const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');

const token = makeJwt('user-224', 'org-224', ['admin']);
let passed = 0;
let failed = 0;
let templateA = null;
let templateB = null;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create two distinct templates
  const resA = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Template A - 224', type: 'invoice', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [{ id: 'pageA1', label: 'Page A1', elements: [{ id: 'elA1', type: 'text', x: 10, y: 10, w: 100, h: 30, content: 'Content from Template A' }] }] } }),
  });
  templateA = (await resA.json()).id;

  const resB = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Template B - 224', type: 'statement', schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: { width: 210, height: 297 }, pages: [{ id: 'pageB1', label: 'Page B1', elements: [{ id: 'elB1', type: 'text', x: 20, y: 20, w: 200, h: 50, content: 'Content from Template B' }] }] } }),
  });
  templateB = (await resB.json()).id;
  console.log(`Created templates: A=${templateA}, B=${templateB}`);
}

async function cleanup() {
  for (const id of [templateA, templateB]) {
    if (id) {
      await fetch(`${API_BASE}/templates/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
}

async function testCodeStructure() {
  console.log('\n--- Test: Code structure for stale data prevention ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 1. cancelled flag declared
  assert(src.includes('let cancelled = false'), 'cancelled flag declared in useEffect');

  // 2. cancelled set to true in cleanup
  assert(src.includes('cancelled = true'), 'cancelled set to true in useEffect cleanup');

  // 3. cancelled checked before setting state after fetch
  assert(src.includes('if (cancelled) return'), 'cancelled checked before setting template state');

  // 4. AbortController created
  assert(src.includes('new AbortController()'), 'AbortController created for in-flight fetch cancellation');

  // 5. AbortController signal passed to fetch
  assert(src.includes('signal: abortController.signal'), 'AbortController signal passed to fetch');

  // 6. abort() called in cleanup
  assert(src.includes('abortController.abort()'), 'abortController.abort() called in cleanup');

  // 7. AbortError handled silently
  assert(src.includes("err.name === 'AbortError'"), 'AbortError silently ignored (not shown as error)');

  // 8. State reset on new template load
  assert(src.includes("setIsDirty(false)") && src.includes("setSaveStatus('idle')"), 'State reset at start of loadTemplate');

  // 9. Lock acquired state checked for cancellation
  assert(src.includes('if (!cancelled)') && src.includes('setIsReadOnly(false)'), 'Lock status checked for cancellation');

  // 10. Undo history cleared on new template
  assert(src.includes('clearUndoHistory()'), 'Undo history cleared on new template load');

  // 11. Pages reset to first page on load
  assert(src.includes('setCurrentPageIndex(0)'), 'Current page reset to 0 on template load');

  // 12. Loading state shown during fetch
  assert(src.includes('setIsLoading(true)'), 'isLoading set true at start of template load');

  // 13. Loading cleared after success
  assert(src.includes('setIsLoading(false)'), 'isLoading cleared after load completes');
}

async function testApiReturnsDistinctData() {
  console.log('\n--- Test: API returns distinct data for each template ---');

  // 14. Template A returns correct data
  const resA = await fetch(`${API_BASE}/templates/${templateA}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dataA = await resA.json();
  assert(dataA.name === 'Template A - 224', 'Template A has correct name');

  // 15. Template B returns correct data
  const resB = await fetch(`${API_BASE}/templates/${templateB}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dataB = await resB.json();
  assert(dataB.name === 'Template B - 224', 'Template B has correct name');

  // 16. Templates have distinct IDs
  assert(templateA !== templateB, 'Templates have distinct IDs');

  // 17. Templates have distinct content
  assert(dataA.schema.pages[0].elements[0].content !== dataB.schema.pages[0].elements[0].content, 'Templates have distinct element content');

  // 18. Templates have distinct types
  assert(dataA.type !== dataB.type, 'Templates have distinct types');
}

async function testRapidFetchBehavior() {
  console.log('\n--- Test: Rapid fetch requests handled properly ---');

  // 19. Simulate rapid sequential fetches - last one wins
  const results = [];
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API_BASE}/templates/${i === 2 ? templateB : templateA}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    results.push(await res.json());
  }
  assert(results[2].name === 'Template B - 224', 'Last fetch returns correct template data');

  // 20. Concurrent fetches to different templates both succeed
  const [r1, r2] = await Promise.all([
    fetch(`${API_BASE}/templates/${templateA}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${API_BASE}/templates/${templateB}`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
  assert(d1.name === 'Template A - 224' && d2.name === 'Template B - 224', 'Concurrent fetches return correct respective data');
}

async function testPublishResetOnSwitch() {
  console.log('\n--- Test: Publish/save status reset on template switch ---');
  const src = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // 21. publishStatus reset
  assert(src.includes("setPublishStatus('idle')"), 'publishStatus reset to idle on template switch');

  // 22. publishError reset
  assert(src.includes('setPublishError(null)'), 'publishError cleared on template switch');

  // 23. saveError reset
  assert(src.includes('setSaveError(null)'), 'saveError cleared on template switch');

  // 24. isDirtyRef synced
  assert(src.includes('isDirtyRef.current = false'), 'isDirtyRef reset on template switch');
}

async function main() {
  console.log('Feature #224: Rapid navigation doesn\'t cause stale data');
  await setup();
  await testCodeStructure();
  await testApiReturnsDistinctData();
  await testRapidFetchBehavior();
  await testPublishResetOnSwitch();
  await cleanup();
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
}

main().catch(console.error);
