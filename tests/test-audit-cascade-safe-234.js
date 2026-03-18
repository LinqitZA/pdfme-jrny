/**
 * Feature #234: Audit log entries cascade-safe
 *
 * Archiving an entity (template) must NOT delete its audit entries.
 * All historical audit log entries (created, updated, archived) must persist.
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-audit-234', 'org-audit-234', ['template:edit', 'template:publish', 'template:delete']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE.replace('/api/pdfme', ''));
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
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
  console.log('Feature #234: Audit log entries cascade-safe');
  console.log('============================================\n');

  // Step 1: Create a template (generates template.created audit entry)
  console.log('Step 1: Create a template');
  const createRes = await request('POST', `${API_BASE}/templates`, {
    name: 'AUDIT_CASCADE_TEST_234',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', content: 'Audit test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
  });
  assert(createRes.status === 201, `Template created (status=${createRes.status})`);
  const templateId = createRes.body.id;
  console.log(`  Template ID: ${templateId}\n`);

  // Step 2: Publish the template (generates template.published audit entry)
  console.log('Step 2: Publish the template');
  const publishRes = await request('POST', `${API_BASE}/templates/${templateId}/publish`, {});
  assert(publishRes.status === 200 || publishRes.status === 201, `Template published (status=${publishRes.status})`);

  // Wait briefly for audit logs to be written
  await new Promise(r => setTimeout(r, 200));

  // Step 3: Query audit log BEFORE archiving - should have created + published entries
  console.log('\nStep 3: Query audit log before archiving');
  const auditBefore = await request('GET', `${API_BASE}/audit?entityId=${templateId}&entityType=template&limit=100`, null);
  assert(auditBefore.status === 200, `Audit query successful (status=${auditBefore.status})`);

  const entriesBefore = auditBefore.body.data || [];
  console.log(`  Found ${entriesBefore.length} audit entries before archiving`);

  const actionsBeforeSet = new Set(entriesBefore.map(e => e.action));
  assert(actionsBeforeSet.has('template.created'), 'template.created entry exists before archive');
  assert(actionsBeforeSet.has('template.published'), 'template.published entry exists before archive');

  const countBefore = entriesBefore.length;

  // Step 4: Archive the template (generates template.archived audit entry)
  console.log('\nStep 4: Archive the template');
  const archiveRes = await request('DELETE', `${API_BASE}/templates/${templateId}`, null);
  assert(archiveRes.status === 200, `Template archived (status=${archiveRes.status})`);

  // Wait briefly for audit log to be written
  await new Promise(r => setTimeout(r, 200));

  // Step 5: Query audit log AFTER archiving - all entries should be preserved
  console.log('\nStep 5: Query audit log after archiving');
  const auditAfter = await request('GET', `${API_BASE}/audit?entityId=${templateId}&entityType=template&limit=100`, null);
  assert(auditAfter.status === 200, `Audit query successful after archive (status=${auditAfter.status})`);

  const entriesAfter = auditAfter.body.data || [];
  console.log(`  Found ${entriesAfter.length} audit entries after archiving`);

  // Verify all pre-archive entries still exist
  assert(entriesAfter.length >= countBefore, `Entry count preserved or increased (was ${countBefore}, now ${entriesAfter.length})`);

  const actionsAfterSet = new Set(entriesAfter.map(e => e.action));
  assert(actionsAfterSet.has('template.created'), 'template.created entry preserved after archive');
  assert(actionsAfterSet.has('template.published'), 'template.published entry preserved after archive');
  assert(actionsAfterSet.has('template.archived'), 'template.archived entry present after archive');

  // Step 6: Verify all pre-archive entry IDs still exist
  console.log('\nStep 6: Verify individual entry IDs preserved');
  const afterIds = new Set(entriesAfter.map(e => e.id));
  let allPreserved = true;
  for (const entry of entriesBefore) {
    if (!afterIds.has(entry.id)) {
      allPreserved = false;
      console.log(`  ❌ Entry ${entry.id} (${entry.action}) was deleted!`);
    }
  }
  assert(allPreserved, 'All pre-archive entry IDs preserved');

  // Step 7: Verify entry data integrity
  console.log('\nStep 7: Verify entry data integrity');
  const createdEntry = entriesAfter.find(e => e.action === 'template.created');
  const publishedEntry = entriesAfter.find(e => e.action === 'template.published');
  const archivedEntry = entriesAfter.find(e => e.action === 'template.archived');

  assert(createdEntry && createdEntry.entityId === templateId, 'Created entry has correct entityId');
  assert(createdEntry && createdEntry.entityType === 'template', 'Created entry has correct entityType');
  assert(publishedEntry && publishedEntry.entityId === templateId, 'Published entry has correct entityId');
  assert(archivedEntry && archivedEntry.entityId === templateId, 'Archived entry has correct entityId');
  assert(archivedEntry && archivedEntry.entityType === 'template', 'Archived entry has correct entityType');

  // Step 8: Verify chronological order
  console.log('\nStep 8: Verify chronological order');
  if (createdEntry && publishedEntry && archivedEntry) {
    const createdTime = new Date(createdEntry.createdAt).getTime();
    const publishedTime = new Date(publishedEntry.createdAt).getTime();
    const archivedTime = new Date(archivedEntry.createdAt).getTime();
    assert(createdTime <= publishedTime, 'Created before or at published time');
    assert(publishedTime <= archivedTime, 'Published before or at archived time');
  }

  // Step 9: Verify metadata preserved
  console.log('\nStep 9: Verify metadata preserved');
  if (createdEntry && createdEntry.metadata) {
    assert(createdEntry.metadata.name === 'AUDIT_CASCADE_TEST_234', 'Created entry metadata has template name');
    assert(createdEntry.metadata.type === 'invoice', 'Created entry metadata has template type');
  }
  if (archivedEntry && archivedEntry.metadata) {
    assert(archivedEntry.metadata.name === 'AUDIT_CASCADE_TEST_234', 'Archived entry metadata has template name');
  }

  // Step 10: Query audit log again to double-check nothing was cleaned up async
  console.log('\nStep 10: Final verification - entries still present');
  await new Promise(r => setTimeout(r, 500));
  const auditFinal = await request('GET', `${API_BASE}/audit?entityId=${templateId}&entityType=template&limit=100`, null);
  assert(auditFinal.body.data && auditFinal.body.data.length === entriesAfter.length,
    `Final count matches (${auditFinal.body.data?.length} === ${entriesAfter.length})`);

  // Summary
  console.log(`\n============================================`);
  console.log(`Results: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.log(`FAILED: ${failed} tests`);
    process.exit(1);
  } else {
    console.log('All tests passed! ✅');
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
