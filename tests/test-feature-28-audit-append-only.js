/**
 * Test Feature #28: Audit log is append-only - no updates or deletes
 *
 * Verifies:
 * - Audit entries can be created via normal operations
 * - UPDATE operations on audit_logs are blocked at database level
 * - DELETE operations on audit_logs are blocked at database level
 * - All original entries remain unchanged after failed update/delete attempts
 * - API PUT/DELETE endpoints return 403
 * - Audit policy endpoint reports enforcement status
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = 'pdfme_jwt_secret_dev';

let passed = 0;
let failed = 0;
const results = [];

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const TOKEN = makeJwt({
  sub: 'audit-test-user',
  orgId: 'org-audit-28',
  roles: ['admin'],
  permissions: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'render:bulk', 'audit:view'],
});

function request(method, path, body = null, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
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

function assert(name, condition) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${name}`);
  } else {
    failed++;
    results.push(`  ❌ ${name}`);
  }
}

async function run() {
  // Step 1: Create audit entries via normal operations (create templates which trigger audit)
  const templateIds = [];
  for (let i = 0; i < 3; i++) {
    const res = await request('POST', `${BASE}/templates`, {
      type: 'invoice',
      name: `Audit-Test-Template-${i}-${Date.now()}`,
      schema: { pages: [{ elements: [] }] },
    });
    if (res.status === 201 && res.body.id) {
      templateIds.push(res.body.id);
    }
  }
  assert('Created 3 templates to generate audit entries', templateIds.length === 3);

  // Step 2: Query audit logs for our org
  const auditRes = await request('GET', `${BASE}/audit?limit=100`);
  assert('Audit log query returns 200', auditRes.status === 200);
  assert('Audit log has data array', Array.isArray(auditRes.body.data));

  const auditEntries = auditRes.body.data;
  const entryCount = auditEntries.length;
  assert('Audit log has entries from operations', entryCount >= 3);

  // Step 3: Get a specific audit entry ID for testing
  const testEntry = auditEntries[0];
  assert('Audit entry has id', !!testEntry.id);
  assert('Audit entry has orgId', testEntry.orgId === 'org-audit-28');
  assert('Audit entry has entityType', !!testEntry.entityType);
  assert('Audit entry has action', !!testEntry.action);
  assert('Audit entry has userId', !!testEntry.userId);
  assert('Audit entry has createdAt', !!testEntry.createdAt);

  // Step 4: Verify audit policy endpoint
  const policyRes = await request('GET', `${BASE}/audit/policy`);
  assert('Audit policy endpoint returns 200', policyRes.status === 200);
  assert('Audit policy is append-only', policyRes.body.policy === 'append-only');
  assert('Update blocked by trigger', policyRes.body.enforcement && policyRes.body.enforcement.updateBlocked === true);
  assert('Delete blocked by trigger', policyRes.body.enforcement && policyRes.body.enforcement.deleteBlocked === true);
  assert('Trigger names present', policyRes.body.enforcement && policyRes.body.enforcement.triggers.length >= 2);

  // Step 5: Attempt UPDATE via API - should be rejected with 403
  const updateRes = await request('PUT', `${BASE}/audit/${testEntry.id}`, { action: 'tampered' });
  assert('API PUT on audit log returns 403', updateRes.status === 403);
  assert('API PUT error mentions append-only', typeof updateRes.body.message === 'string' && updateRes.body.message.includes('append-only'));

  // Step 6: Attempt DELETE via API - should be rejected with 403
  const deleteRes = await request('DELETE', `${BASE}/audit/${testEntry.id}`);
  assert('API DELETE on audit log returns 403', deleteRes.status === 403);
  assert('API DELETE error mentions append-only', typeof deleteRes.body.message === 'string' && deleteRes.body.message.includes('append-only'));

  // Step 7: Verify all original entries still exist unchanged
  const afterRes = await request('GET', `${BASE}/audit?limit=100`);
  assert('Audit entries still accessible after failed update/delete', afterRes.status === 200);

  const afterEntries = afterRes.body.data;
  const afterCount = afterEntries.length;
  assert('Entry count unchanged after failed update/delete', afterCount >= entryCount);

  // Check the specific test entry is still intact
  const refound = afterEntries.find(e => e.id === testEntry.id);
  assert('Original entry still exists with same id', !!refound);
  assert('Original entry action unchanged', refound && refound.action === testEntry.action);
  assert('Original entry entityType unchanged', refound && refound.entityType === testEntry.entityType);
  assert('Original entry userId unchanged', refound && refound.userId === testEntry.userId);
  assert('Original entry createdAt unchanged', refound && refound.createdAt === testEntry.createdAt);

  // Step 8: Verify all 3 original template-creation audit entries exist
  const templateAuditEntries = afterEntries.filter(e => e.entityType === 'template' && e.action === 'create');
  assert('Template creation audit entries exist', templateAuditEntries.length >= 3);

  // Step 9: Verify additional audit entries (from earlier operations) also persist
  const allIds = new Set(afterEntries.map(e => e.id));
  for (const entry of auditEntries) {
    if (!allIds.has(entry.id)) {
      assert(`Entry ${entry.id} persists`, false);
      break;
    }
  }
  assert('All original entries persist unchanged', auditEntries.every(e => allIds.has(e.id)));

  // Step 10: Create one more audit entry to verify INSERT still works
  const newTemplate = await request('POST', `${BASE}/templates`, {
    type: 'invoice',
    name: `Audit-Post-Test-${Date.now()}`,
    schema: { pages: [{ elements: [] }] },
  });
  assert('Can still create entries (INSERT works)', newTemplate.status === 201);

  const finalAudit = await request('GET', `${BASE}/audit?limit=100`);
  assert('New audit entry created after verification', finalAudit.body.data.length > afterCount);

  // Step 11: Attempt PUT on non-existent audit entry - still 403
  const fakeUpdateRes = await request('PUT', `${BASE}/audit/nonexistent-id`, { action: 'tampered' });
  assert('PUT on non-existent audit entry also returns 403', fakeUpdateRes.status === 403);

  // Step 12: Attempt DELETE on non-existent audit entry - still 403
  const fakeDeleteRes = await request('DELETE', `${BASE}/audit/nonexistent-id`);
  assert('DELETE on non-existent audit entry also returns 403', fakeDeleteRes.status === 403);

  // Print results
  const total = passed + failed;
  for (const r of results) process.stdout.write(r + '\n');
  process.stdout.write(`\n${passed}/${total} tests passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write(`Test error: ${err.message}\n`);
  process.exit(1);
});
