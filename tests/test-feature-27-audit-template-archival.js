/**
 * Feature #27: Audit log records template archival
 *
 * Steps:
 * 1. Create and publish a template
 * 2. DELETE /api/pdfme/templates/:id to archive
 * 3. Query audit log
 * 4. Verify entry with entityType=template action=archived
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles: roles || ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'render:bulk', 'system:seed'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'org-audit-archive-27';
const USER_A = 'user-archiver-27';
const TOKEN_A = makeToken(USER_A, ORG_ID);

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
const fs = require('fs');
const OUT = '/tmp/test-27-output.txt';

function assert(condition, msg) {
  if (condition) { passed++; } else { failed++; }
  fs.appendFileSync(OUT, '  ' + (condition ? '✅' : '❌') + ' ' + msg + '\n');
}

function log(msg) { fs.appendFileSync(OUT, msg + '\n'); }

async function run() {
  fs.writeFileSync(OUT, '=== Feature #27: Audit log records template archival ===\n\n');

  // 1. Create a template
  log('Step 1: Create a template');
  const createRes = await request('POST', '/api/pdfme/templates', TOKEN_A, {
    name: 'Archive Audit Test ' + Date.now(),
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] },
  });
  assert(createRes.status === 201, 'Template created (' + createRes.status + ')');
  const templateId = createRes.body.id;
  const templateName = createRes.body.name;
  log('  Template ID: ' + templateId);

  // 2. Archive the template (DELETE)
  log('\nStep 2: Archive the template');
  const archiveRes = await request('DELETE', '/api/pdfme/templates/' + templateId, TOKEN_A);
  assert(archiveRes.status === 200, 'Template archived (' + archiveRes.status + ')');
  assert(archiveRes.body.status === 'archived', 'Status is archived (' + archiveRes.body.status + ')');

  // 3. Verify template is archived (should not appear in list or return archived status)
  log('\nStep 3: Verify template is archived');
  const getRes = await request('GET', '/api/pdfme/templates/' + templateId, TOKEN_A);
  // Archived template may return 200 with status=archived or 404
  if (getRes.status === 200) {
    assert(getRes.body.status === 'archived', 'Template status is archived');
  } else {
    assert(getRes.status === 404, 'Archived template returns 404');
  }

  // 4. Query audit log for template archival
  log('\nStep 4: Query audit log for archival');
  const auditRes = await request('GET', '/api/pdfme/audit?entityType=template&action=archived&entityId=' + templateId, TOKEN_A);
  assert(auditRes.status === 200, 'Audit query succeeded (' + auditRes.status + ')');
  assert(auditRes.body.data && auditRes.body.data.length > 0, 'Audit entries found (' + (auditRes.body.data?.length || 0) + ')');

  if (auditRes.body.data && auditRes.body.data.length > 0) {
    const entry = auditRes.body.data[0];
    log('\nStep 5: Verify audit entry details');
    assert(entry.action === 'archived', 'Action is archived');
    assert(entry.entityType === 'template', 'Entity type is template');
    assert(entry.entityId === templateId, 'Entity ID matches template');
    assert(entry.userId === USER_A, 'User ID is archiver (' + entry.userId + ')');
    assert(entry.metadata !== null, 'Metadata exists');
    assert(entry.metadata.name === templateName, 'Metadata includes template name (' + entry.metadata?.name + ')');
  } else {
    log('  ❌ No audit entries found - skipping detail checks');
    failed += 5;
  }

  // 6. Broader query includes the archive entry
  log('\nStep 6: Broader audit query');
  const auditBroad = await request('GET', '/api/pdfme/audit?entityType=template&entityId=' + templateId, TOKEN_A);
  assert(auditBroad.status === 200, 'Broad audit query succeeded');
  const archiveEntries = (auditBroad.body.data || []).filter(function(e) { return e.action === 'archived'; });
  assert(archiveEntries.length >= 1, 'Archive entry in broad query (' + archiveEntries.length + ')');

  // 7. Archive a second template - creates separate audit entry
  log('\nStep 7: Archive second template');
  const create2 = await request('POST', '/api/pdfme/templates', TOKEN_A, {
    name: 'Archive Audit Test 2 ' + Date.now(),
    type: 'statement',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] },
  });
  assert(create2.status === 201, 'Second template created');
  const templateId2 = create2.body.id;
  const archive2 = await request('DELETE', '/api/pdfme/templates/' + templateId2, TOKEN_A);
  assert(archive2.status === 200, 'Second template archived');

  // Check that there are now 2 archive audit entries
  const auditAll = await request('GET', '/api/pdfme/audit?entityType=template&action=archived', TOKEN_A);
  const allArchiveEntries = (auditAll.body.data || []).filter(function(e) { return e.action === 'archived'; });
  assert(allArchiveEntries.length >= 2, 'Two archive audit entries (' + allArchiveEntries.length + ')');

  // 8. Archiving non-existent template returns 404 and no audit entry
  log('\nStep 8: Archive non-existent template');
  const archiveBad = await request('DELETE', '/api/pdfme/templates/nonexistent-id-xyz', TOKEN_A);
  assert(archiveBad.status === 404, 'Non-existent template returns 404 (' + archiveBad.status + ')');

  // 9. Tenant isolation
  log('\nStep 9: Tenant isolation');
  const OTHER_TOKEN = makeToken('other-user', 'org-other-27');
  const auditOther = await request('GET', '/api/pdfme/audit?entityType=template&action=archived', OTHER_TOKEN);
  assert(auditOther.status === 200, 'Other org audit query succeeds');
  assert(auditOther.body.data.length === 0, 'Other org sees no archive entries (' + auditOther.body.data?.length + ')');

  // 10. Archiving already archived template (idempotent check)
  log('\nStep 10: Re-archiving already archived template');
  const reArchive = await request('DELETE', '/api/pdfme/templates/' + templateId, TOKEN_A);
  // May return 200 (already archived) or 404 - either is acceptable
  assert(reArchive.status === 200 || reArchive.status === 404, 'Re-archive returns 200 or 404 (' + reArchive.status + ')');

  log('\n=== Results: ' + passed + '/' + (passed + failed) + ' passed ===');

  const output = fs.readFileSync(OUT, 'utf8');
  process.stderr.write(output);

  if (failed > 0) process.exit(1);
}

run().catch(function(e) { fs.appendFileSync(OUT, 'ERROR: ' + e.message + '\n'); process.exit(1); });
