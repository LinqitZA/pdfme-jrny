/**
 * Feature #26: Audit log records signature revocation
 *
 * Steps:
 * 1. Upload signature for user
 * 2. DELETE /api/pdfme/signatures/me to revoke
 * 3. Query audit log
 * 4. Verify entry with entityType=signature action=revoked
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

const ORG_ID = 'org-audit-sig-26';
const USER_A = 'user-sig-owner-26';
const TOKEN_A = makeToken(USER_A, ORG_ID);

// Minimal 1x1 PNG
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': 'Bearer ' + token,
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
  if (condition) { passed++; } else { failed++; }
  const icon = condition ? '✅' : '❌';
  const fs = require('fs');
  fs.appendFileSync('/tmp/test-26-output.txt', `  ${icon} ${msg}\n`);
}

async function run() {
  const fs = require('fs');
  fs.writeFileSync('/tmp/test-26-output.txt', '=== Feature #26: Audit log records signature revocation ===\n\n');

  // 1. Upload a signature
  fs.appendFileSync('/tmp/test-26-output.txt', 'Step 1: Upload signature\n');
  const uploadRes = await request('POST', '/api/pdfme/signatures', TOKEN_A, {
    data: 'data:image/png;base64,' + TINY_PNG,
  });
  assert(uploadRes.status === 201, 'Signature uploaded (' + uploadRes.status + ')');
  const sigId = uploadRes.body.id;
  fs.appendFileSync('/tmp/test-26-output.txt', '  Signature ID: ' + sigId + '\n');

  // 2. Verify signature exists
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 2: Verify signature exists\n');
  const getRes = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getRes.status === 200, 'Signature retrieved (' + getRes.status + ')');
  assert(getRes.body.id === sigId, 'Signature ID matches');

  // 3. Revoke the signature
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 3: Revoke signature\n');
  const revokeRes = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A);
  assert(revokeRes.status === 200, 'Signature revoked (' + revokeRes.status + ')');
  assert(revokeRes.body.message === 'Signature revoked successfully', 'Revocation message correct');

  // 4. Verify signature is revoked (should be 404 now)
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 4: Verify signature is gone\n');
  const getAfter = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getAfter.status === 404, 'Signature no longer found (' + getAfter.status + ')');

  // 5. Query audit log for signature revocation
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 5: Query audit log\n');
  const auditRes = await request('GET', '/api/pdfme/audit?entityType=signature&action=revoked', TOKEN_A);
  assert(auditRes.status === 200, 'Audit query succeeded (' + auditRes.status + ')');
  assert(auditRes.body.data && auditRes.body.data.length > 0, 'Audit entries found (' + (auditRes.body.data?.length || 0) + ')');

  if (auditRes.body.data && auditRes.body.data.length > 0) {
    const entry = auditRes.body.data[0];
    fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 6: Verify audit entry details\n');
    assert(entry.action === 'revoked', 'Action is revoked');
    assert(entry.entityType === 'signature', 'Entity type is signature');
    assert(entry.entityId === sigId, 'Entity ID matches signature ID');
    assert(entry.userId === USER_A, 'User ID matches revoker (' + entry.userId + ')');
    assert(entry.metadata !== null, 'Metadata exists');
    assert(entry.metadata.signatureId === sigId, 'Metadata signatureId matches (' + entry.metadata?.signatureId + ')');
    assert(entry.metadata.filePath !== undefined, 'Metadata includes filePath');
    assert(entry.metadata.capturedAt !== undefined, 'Metadata includes capturedAt');
  } else {
    fs.appendFileSync('/tmp/test-26-output.txt', '  ❌ No audit entries found - skipping detail checks\n');
    failed += 6;
  }

  // 7. Revoking again should return 404 and no new audit entry
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 7: Double revoke returns 404\n');
  const doubleRevoke = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A);
  assert(doubleRevoke.status === 404, 'Second revoke returns 404 (' + doubleRevoke.status + ')');
  const auditAfter = await request('GET', '/api/pdfme/audit?entityType=signature&action=revoked', TOKEN_A);
  assert(auditAfter.body.data.length === 1, 'Still only 1 revocation audit entry');

  // 8. Upload new signature, revoke, verify second audit entry
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 8: Upload and revoke again creates new audit entry\n');
  const upload2 = await request('POST', '/api/pdfme/signatures', TOKEN_A, {
    data: 'data:image/png;base64,' + TINY_PNG,
  });
  assert(upload2.status === 201, 'Second signature uploaded');
  const revoke2 = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A);
  assert(revoke2.status === 200, 'Second revocation succeeded');
  const auditMulti = await request('GET', '/api/pdfme/audit?entityType=signature&action=revoked', TOKEN_A);
  assert(auditMulti.body.data.length === 2, 'Two revocation audit entries (' + auditMulti.body.data?.length + ')');

  // 9. Tenant isolation
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 9: Tenant isolation\n');
  const OTHER_TOKEN = makeToken('other-user', 'org-other-26');
  const auditOther = await request('GET', '/api/pdfme/audit?entityType=signature&action=revoked', OTHER_TOKEN);
  assert(auditOther.status === 200, 'Other org audit query succeeds');
  assert(auditOther.body.data.length === 0, 'Other org sees no revocation entries');

  // 10. Query by entityId
  fs.appendFileSync('/tmp/test-26-output.txt', '\nStep 10: Query by entityId\n');
  const auditById = await request('GET', '/api/pdfme/audit?entityType=signature&entityId=' + sigId, TOKEN_A);
  assert(auditById.status === 200, 'Audit query by entityId succeeded');
  assert(auditById.body.data.length === 1, 'Found 1 entry for specific signature ID');

  fs.appendFileSync('/tmp/test-26-output.txt', '\n=== Results: ' + passed + '/' + (passed + failed) + ' passed ===\n');

  // Print results
  const output = fs.readFileSync('/tmp/test-26-output.txt', 'utf8');
  // Write to stdout via stderr which is allowed
  process.stderr.write(output);

  if (failed > 0) process.exit(1);
}

run().catch(e => { require('fs').appendFileSync('/tmp/test-26-output.txt', 'ERROR: ' + e.message + '\n'); process.exit(1); });
