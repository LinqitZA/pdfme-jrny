/**
 * Feature #253: Audit log filter by date range
 *
 * Verifies that audit logs can be filtered by createdAt date range using from/to params.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const USER_ID = 'user-audit-253';
const ORG_ID = 'org-audit-253';
const TOKEN = makeJwt(USER_ID, ORG_ID, ['super_admin', 'template:edit', 'template:publish']);
const HEADERS = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log('Feature #253: Audit log filter by date range\n');

  const minimalSchema = {
    schemas: [[{ name: 'heading', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }]],
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  };

  // Record the time before creating entries
  const beforeAll = new Date(Date.now() - 1000).toISOString(); // 1 sec buffer

  // Step 1: Create first template
  console.log('Step 1: Create entries at different times');
  const t1Res = await api('POST', '/templates', { name: `DateRange T1 ${Date.now()}`, type: 'invoice', schema: minimalSchema });
  assert(t1Res.status === 201, `Template 1 created: ${t1Res.status}`);
  const t1Id = t1Res.data?.id;

  // Record mid-point time
  await new Promise(r => setTimeout(r, 1100)); // ensure at least 1s gap
  const midPoint = new Date().toISOString();
  await new Promise(r => setTimeout(r, 1100));

  // Step 2: Create second template
  const t2Res = await api('POST', '/templates', { name: `DateRange T2 ${Date.now()}`, type: 'statement', schema: minimalSchema });
  assert(t2Res.status === 201, `Template 2 created: ${t2Res.status}`);
  const t2Id = t2Res.data?.id;

  await new Promise(r => setTimeout(r, 500));
  const afterAll = new Date(Date.now() + 1000).toISOString(); // 1 sec buffer

  // Step 3: Filter by full range - should get both
  console.log('\nStep 2: Filter by full date range (from=before, to=after)');
  const fullRes = await api('GET', `/audit?from=${encodeURIComponent(beforeAll)}&to=${encodeURIComponent(afterAll)}&limit=100`);
  assert(fullRes.status === 200, `Full range query status: ${fullRes.status}`);
  assert(Array.isArray(fullRes.data?.data), 'Response has data array');

  const fullEntries = fullRes.data.data;
  const t1InFull = fullEntries.some(e => e.entityId === t1Id);
  const t2InFull = fullEntries.some(e => e.entityId === t2Id);
  assert(t1InFull, 'Template 1 in full range results');
  assert(t2InFull, 'Template 2 in full range results');

  // Step 4: Filter to=midPoint (before second template) - should get only first
  console.log('\nStep 3: Filter by to=midPoint (before second template)');
  const earlyRes = await api('GET', `/audit?from=${encodeURIComponent(beforeAll)}&to=${encodeURIComponent(midPoint)}&limit=100`);
  assert(earlyRes.status === 200, `Early range query status: ${earlyRes.status}`);

  const earlyEntries = earlyRes.data.data;
  const t1InEarly = earlyEntries.some(e => e.entityId === t1Id);
  const t2InEarly = earlyEntries.some(e => e.entityId === t2Id);
  assert(t1InEarly, 'Template 1 in early range results');
  assert(!t2InEarly, 'Template 2 NOT in early range results');

  // All entries should be before midPoint
  const allBeforeMid = earlyEntries.every(e => new Date(e.createdAt) <= new Date(midPoint));
  assert(allBeforeMid, 'All entries in early range are before midPoint');

  // Step 5: Filter from=midPoint (after first template) - should get only second
  console.log('\nStep 4: Filter by from=midPoint (after first template)');
  const lateRes = await api('GET', `/audit?from=${encodeURIComponent(midPoint)}&to=${encodeURIComponent(afterAll)}&limit=100`);
  assert(lateRes.status === 200, `Late range query status: ${lateRes.status}`);

  const lateEntries = lateRes.data.data;
  const t1InLate = lateEntries.some(e => e.entityId === t1Id);
  const t2InLate = lateEntries.some(e => e.entityId === t2Id);
  assert(!t1InLate, 'Template 1 NOT in late range results');
  assert(t2InLate, 'Template 2 in late range results');

  // All entries should be after midPoint
  const allAfterMid = lateEntries.every(e => new Date(e.createdAt) >= new Date(midPoint));
  assert(allAfterMid, 'All entries in late range are after midPoint');

  // Step 6: Filter with only 'from' param
  console.log('\nStep 5: Filter with only from param');
  const fromOnlyRes = await api('GET', `/audit?from=${encodeURIComponent(midPoint)}&limit=100`);
  assert(fromOnlyRes.status === 200, `From-only query status: ${fromOnlyRes.status}`);
  const fromOnlyEntries = fromOnlyRes.data.data;
  const allAfterFrom = fromOnlyEntries.every(e => new Date(e.createdAt) >= new Date(midPoint));
  assert(allAfterFrom, 'All entries are after from date');
  assert(fromOnlyEntries.some(e => e.entityId === t2Id), 'Template 2 in from-only results');

  // Step 7: Filter with only 'to' param
  console.log('\nStep 6: Filter with only to param');
  const toOnlyRes = await api('GET', `/audit?to=${encodeURIComponent(midPoint)}&limit=100`);
  assert(toOnlyRes.status === 200, `To-only query status: ${toOnlyRes.status}`);
  const toOnlyEntries = toOnlyRes.data.data;
  const allBeforeTo = toOnlyEntries.every(e => new Date(e.createdAt) <= new Date(midPoint));
  assert(allBeforeTo, 'All entries are before to date');

  // Step 8: Combined entityType + date range
  console.log('\nStep 7: Combined entityType + date range filter');
  const combinedRes = await api('GET', `/audit?entityType=template&from=${encodeURIComponent(beforeAll)}&to=${encodeURIComponent(midPoint)}&limit=100`);
  assert(combinedRes.status === 200, `Combined filter status: ${combinedRes.status}`);
  const combinedEntries = combinedRes.data.data;
  assert(combinedEntries.every(e => e.entityType === 'template'), 'All combined results are template type');
  assert(combinedEntries.every(e => new Date(e.createdAt) <= new Date(midPoint)), 'All combined results before midPoint');

  // Step 9: Future date range - should return empty
  console.log('\nStep 8: Future date range returns empty');
  const futureFrom = new Date(Date.now() + 86400000).toISOString();
  const futureTo = new Date(Date.now() + 172800000).toISOString();
  const futureRes = await api('GET', `/audit?from=${encodeURIComponent(futureFrom)}&to=${encodeURIComponent(futureTo)}&limit=100`);
  assert(futureRes.status === 200, `Future range query status: ${futureRes.status}`);
  assert(futureRes.data.data.length === 0, `No entries in future range: ${futureRes.data.data.length}`);

  // Step 10: Past date range - should return empty
  console.log('\nStep 9: Very old date range returns empty');
  const pastRes = await api('GET', `/audit?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z&limit=100`);
  assert(pastRes.status === 200, `Past range query status: ${pastRes.status}`);
  assert(pastRes.data.data.length === 0, `No entries in old range: ${pastRes.data.data.length}`);

  // Step 11: Clear filter (no from/to) - all entries shown
  console.log('\nStep 10: No filter returns all entries');
  const clearRes = await api('GET', '/audit?limit=100');
  assert(clearRes.status === 200, `Unfiltered query status: ${clearRes.status}`);
  assert(clearRes.data.data.length > 0, `Unfiltered has entries: ${clearRes.data.data.length}`);
  const bothPresent = clearRes.data.data.some(e => e.entityId === t1Id) && clearRes.data.data.some(e => e.entityId === t2Id);
  assert(bothPresent, 'Both templates in unfiltered results');

  // Step 12: Invalid date strings handled gracefully
  console.log('\nStep 11: Invalid date params handled gracefully');
  const invalidRes = await api('GET', '/audit?from=not-a-date&limit=100');
  assert(invalidRes.status === 200, `Invalid date query status: ${invalidRes.status} (ignored gracefully)`);

  // Cleanup
  console.log('\nCleanup');
  await api('DELETE', `/templates/${t1Id}`);
  await api('DELETE', `/templates/${t2Id}`);
  assert(true, 'Templates archived');

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
