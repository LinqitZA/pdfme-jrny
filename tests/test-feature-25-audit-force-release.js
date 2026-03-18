/**
 * Feature #25: Audit log records force-release of edit lock
 *
 * Steps:
 * 1. Admin force-releases another user's template lock
 * 2. Query GET /api/pdfme/audit with entityType=template
 * 3. Verify audit entry with action=lock_force_released exists
 * 4. Verify metadata includes lock holder and releaser userId
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles: roles || ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'system:seed'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'org-audit-lock-25';
const USER_A = 'user-lock-holder-25';
const USER_B = 'user-admin-releaser-25';
const TOKEN_A = makeToken(USER_A, ORG_ID);
const TOKEN_B = makeToken(USER_B, ORG_ID);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function run() {
  console.log('=== Feature #25: Audit log records force-release of edit lock ===\n');

  // 1. Create a template
  console.log('Step 1: Create a template');
  const createRes = await request('POST', '/api/pdfme/templates', TOKEN_A, {
    name: `Audit Lock Test ${Date.now()}`,
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] },
  });
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  const templateId = createRes.body.id;
  console.log(`  Template ID: ${templateId}`);

  // 2. User A acquires the lock
  console.log('\nStep 2: User A acquires lock');
  const lockRes = await request('POST', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  assert(lockRes.status === 200 || lockRes.status === 201, `Lock acquired by User A (${lockRes.status})`);
  assert(lockRes.body.locked === true, 'Lock status is true');
  assert(lockRes.body.lockedBy === USER_A, `Locked by ${lockRes.body.lockedBy}`);

  // 3. Verify lock status
  console.log('\nStep 3: Verify lock status');
  const statusRes = await request('GET', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  assert(statusRes.status === 200, `Lock status retrieved (${statusRes.status})`);
  assert(statusRes.body.locked === true, 'Template is locked');
  assert(statusRes.body.lockedBy === USER_A, `Locked by User A`);

  // 4. User B tries to release without force - should fail
  console.log('\nStep 4: User B tries to release without force');
  const noForceRes = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, TOKEN_B);
  assert(noForceRes.status === 403, `Non-force release by different user rejected (${noForceRes.status})`);

  // 5. User B force-releases the lock
  console.log('\nStep 5: User B force-releases the lock');
  const forceRes = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, TOKEN_B);
  assert(forceRes.status === 200, `Force release succeeded (${forceRes.status})`);
  assert(forceRes.body.released === true, 'Lock released');

  // 6. Verify template is now unlocked
  console.log('\nStep 6: Verify template is unlocked');
  const statusRes2 = await request('GET', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  assert(statusRes2.status === 200, `Lock status retrieved (${statusRes2.status})`);
  assert(statusRes2.body.locked === false, 'Template is now unlocked');

  // 7. Query audit logs for this template with action=lock_force_released
  console.log('\nStep 7: Query audit logs for force-release');
  const auditRes = await request('GET', `/api/pdfme/audit?entityType=template&action=lock_force_released&entityId=${templateId}`, TOKEN_B);
  assert(auditRes.status === 200, `Audit query succeeded (${auditRes.status})`);
  assert(auditRes.body.data && auditRes.body.data.length > 0, `Audit entries found (${auditRes.body.data?.length || 0})`);

  if (auditRes.body.data && auditRes.body.data.length > 0) {
    const entry = auditRes.body.data[0];
    console.log('\nStep 8: Verify audit entry details');
    assert(entry.action === 'lock_force_released', `Action is lock_force_released`);
    assert(entry.entityType === 'template', `Entity type is template`);
    assert(entry.entityId === templateId, `Entity ID matches template`);
    assert(entry.userId === USER_B, `User ID is the releaser (${entry.userId})`);
    assert(entry.metadata !== null, 'Metadata exists');
    assert(entry.metadata.lockHolder === USER_A, `Metadata lockHolder is User A (${entry.metadata?.lockHolder})`);
    assert(entry.metadata.releasedBy === USER_B, `Metadata releasedBy is User B (${entry.metadata?.releasedBy})`);
    assert(entry.metadata.templateName !== undefined, `Metadata includes template name`);
  } else {
    console.log('  ❌ No audit entries found - skipping detail checks');
    failed += 5;
  }

  // 9. Query audit logs with entityType=template only (no action filter)
  console.log('\nStep 9: Broader audit query includes force-release');
  const auditBroad = await request('GET', `/api/pdfme/audit?entityType=template&entityId=${templateId}`, TOKEN_B);
  assert(auditBroad.status === 200, `Broad audit query succeeded`);
  const forceEntries = (auditBroad.body.data || []).filter(e => e.action === 'lock_force_released');
  assert(forceEntries.length >= 1, `Force-release entry found in broad query (${forceEntries.length})`);

  // 10. Normal release (by owner) should NOT create audit entry
  console.log('\nStep 10: Normal release does not create force-release audit');
  // Re-lock as User A
  await request('POST', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  // Release normally (User A releases own lock)
  await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  // Check audit - should still be only 1 force-release entry
  const auditAfterNormal = await request('GET', `/api/pdfme/audit?entityType=template&action=lock_force_released&entityId=${templateId}`, TOKEN_B);
  assert(auditAfterNormal.body.data.length === 1, `Still only 1 force-release audit entry after normal release`);

  // 11. Multiple force-releases create multiple audit entries
  console.log('\nStep 11: Multiple force-releases create multiple entries');
  await request('POST', `/api/pdfme/templates/${templateId}/lock`, TOKEN_A);
  await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, TOKEN_B);
  const auditMulti = await request('GET', `/api/pdfme/audit?entityType=template&action=lock_force_released&entityId=${templateId}`, TOKEN_B);
  assert(auditMulti.body.data.length === 2, `Two force-release audit entries after second force release (${auditMulti.body.data?.length})`);

  // 12. Tenant isolation - other org can't see audit entries
  console.log('\nStep 12: Tenant isolation for audit entries');
  const OTHER_TOKEN = makeToken('other-user', 'org-other-25');
  const auditOther = await request('GET', `/api/pdfme/audit?entityType=template&action=lock_force_released`, OTHER_TOKEN);
  assert(auditOther.status === 200, 'Other org audit query succeeds');
  assert(auditOther.body.data.length === 0, `Other org sees no force-release entries (${auditOther.body.data?.length})`);

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
