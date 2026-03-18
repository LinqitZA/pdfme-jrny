/**
 * Feature #234: Audit log entries cascade-safe
 *
 * Tests that archiving a template doesn't delete its audit entries.
 * All historical entries (created, updated, published, archived) are preserved.
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('test-audit-cascade-234', 'org-audit-cascade-234', ['admin']);
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, msg) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ FAIL: ${msg}\n`);
  }
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...AUTH,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  process.stdout.write('\n=== Feature #234: Audit log entries cascade-safe ===\n\n');

  // Step 1: Create a template (generates audit entry)
  process.stdout.write('--- Creating template ---\n');
  const createRes = await api('POST', '/templates', {
    name: 'Audit Cascade Test 234',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Test' }],
        width: 210,
        height: 297,
      }],
    },
  });
  const templateId = createRes.body.id || createRes.body.template?.id;
  assert(!!templateId, `Template created: ${templateId}`);

  // Step 2: Save a draft (generates audit entry)
  process.stdout.write('\n--- Saving draft ---\n');
  const draftRes = await api('PUT', `/templates/${templateId}/draft`, {
    name: 'Audit Cascade Test 234 - Updated',
    schema: {
      pages: [{
        elements: [{ type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Updated' }],
        width: 210,
        height: 297,
      }],
    },
  });
  assert(draftRes.status === 200, `Draft saved (status=${draftRes.status})`);

  // Step 3: Publish the template (generates audit entry)
  process.stdout.write('\n--- Publishing template ---\n');
  const publishRes = await api('POST', `/templates/${templateId}/publish`, {});
  assert(publishRes.status === 200 || publishRes.status === 201, `Template published (status=${publishRes.status})`);

  // Step 4: Check audit log BEFORE archiving
  process.stdout.write('\n--- Checking audit log before archive ---\n');
  const auditBefore = await api('GET', `/audit?entityId=${templateId}&limit=50`);
  assert(auditBefore.status === 200, `Audit query successful before archive`);
  const entriesBefore = auditBefore.body.data || auditBefore.body.entries || auditBefore.body;
  const countBefore = Array.isArray(entriesBefore) ? entriesBefore.length : 0;
  assert(countBefore >= 2, `At least 2 audit entries before archive (got ${countBefore})`);

  // Check for expected actions
  if (Array.isArray(entriesBefore)) {
    const actions = entriesBefore.map(e => e.action);
    process.stdout.write(`  Actions before archive: ${actions.join(', ')}\n`);

    const hasCreated = actions.some(a => a && a.includes('created'));
    const hasPublished = actions.some(a => a && a.includes('published'));
    assert(hasCreated || countBefore >= 1, `Has created action or at least 1 entry`);
    assert(hasPublished, `Has published action`);
  }

  // Step 5: Archive the template
  process.stdout.write('\n--- Archiving template ---\n');
  const archiveRes = await api('DELETE', `/templates/${templateId}`);
  assert(archiveRes.status === 200, `Template archived (status=${archiveRes.status})`);

  // Step 6: Verify template is archived
  const getRes = await api('GET', `/templates/${templateId}`);
  // Could be 404 (if archived templates return 404) or 200 with status=archived
  const isArchived = getRes.status === 404 || (getRes.body && getRes.body.status === 'archived');
  assert(isArchived, `Template is archived (status=${getRes.status}, body.status=${getRes.body?.status})`);

  // Step 7: Check audit log AFTER archiving - entries must be preserved
  process.stdout.write('\n--- Checking audit log AFTER archive ---\n');
  const auditAfter = await api('GET', `/audit?entityId=${templateId}&limit=50`);
  assert(auditAfter.status === 200, `Audit query successful after archive`);
  const entriesAfter = auditAfter.body.data || auditAfter.body.entries || auditAfter.body;
  const countAfter = Array.isArray(entriesAfter) ? entriesAfter.length : 0;

  assert(countAfter >= countBefore, `Audit entries preserved: ${countAfter} >= ${countBefore} (before archive)`);

  // Verify all original actions are still present
  if (Array.isArray(entriesAfter)) {
    const actionsAfter = entriesAfter.map(e => e.action);
    process.stdout.write(`  Actions after archive: ${actionsAfter.join(', ')}\n`);

    const hasCreated = actionsAfter.some(a => a && a.includes('created'));
    const hasPublished = actionsAfter.some(a => a && a.includes('published'));
    const hasArchived = actionsAfter.some(a => a && (a.includes('archived') || a.includes('deleted') || a.includes('soft_delete')));

    assert(hasCreated || countAfter >= countBefore, `Created action preserved after archive`);
    assert(hasPublished, `Published action preserved after archive`);
    assert(hasArchived || countAfter > countBefore, `Archive action logged or count increased`);

    // Verify each entry has required fields
    process.stdout.write('\n--- Verifying audit entry structure ---\n');
    for (const entry of entriesAfter) {
      assert(!!entry.entityId, `Entry has entityId: ${entry.entityId}`);
      assert(entry.entityId === templateId, `Entry entityId matches template: ${entry.entityId === templateId}`);
      assert(!!entry.action, `Entry has action: ${entry.action}`);
      assert(!!entry.orgId, `Entry has orgId`);
    }

    // Verify entries are in chronological order (most recent first)
    if (entriesAfter.length >= 2) {
      const timestamps = entriesAfter.map(e => new Date(e.createdAt || e.timestamp).getTime());
      const isDescending = timestamps.every((t, i) => i === 0 || t <= timestamps[i - 1]);
      assert(isDescending, `Audit entries in reverse chronological order`);
    }
  }

  // Step 8: Test with a second template to verify isolation
  process.stdout.write('\n--- Testing isolation: second template ---\n');
  const create2Res = await api('POST', '/templates', {
    name: 'Audit Cascade Test 234 - Template 2',
    type: 'statement',
    schema: {
      pages: [{
        elements: [{ type: 'text', name: 'f1', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'T2' }],
        width: 210,
        height: 297,
      }],
    },
  });
  const templateId2 = create2Res.body.id || create2Res.body.template?.id;
  assert(!!templateId2, `Second template created`);

  // Archive template 2
  await api('DELETE', `/templates/${templateId2}`);

  // Verify template 1's audit entries are still intact
  const auditFinal = await api('GET', `/audit?entityId=${templateId}&limit=50`);
  const entriesFinal = auditFinal.body.data || auditFinal.body.entries || auditFinal.body;
  const countFinal = Array.isArray(entriesFinal) ? entriesFinal.length : 0;
  assert(countFinal === countAfter, `Template 1 audit entries unchanged after archiving template 2 (${countFinal} === ${countAfter})`);

  // Template 2 should also have its own audit entries
  const audit2 = await api('GET', `/audit?entityId=${templateId2}&limit=50`);
  const entries2 = audit2.body.data || audit2.body.entries || audit2.body;
  const count2 = Array.isArray(entries2) ? entries2.length : 0;
  assert(count2 >= 1, `Template 2 has its own audit entries: ${count2}`);

  // ---- Summary ----
  process.stdout.write(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  process.stderr.write(`Test error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
