/**
 * Test Feature #181: Cascading update - publish updates UI
 *
 * Verifies: Publishing template reflects in all views
 * Steps:
 * 1. Publish template
 * 2. Check template list - status shows published
 * 3. Check version history - new entry
 * 4. Check audit log - publish entry
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

// Generate a dev JWT token
function makeToken(sub, orgId, roles = ['template:edit', 'template:publish']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return `${header}.${payload}.testsig`;
}

const ORG_ID = 'org-test-181';
const USER_ID = 'user-test-181';
const TOKEN = makeToken(USER_ID, ORG_ID);
const AUTH = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

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

async function createTemplate(name, type = 'invoice') {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name,
      type,
      schema: {
        pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }] }],
      },
    }),
  });
  return res.json();
}

async function run() {
  console.log('\n=== Feature #181: Cascading update - publish updates UI ===\n');

  // Step 1: Create a draft template
  console.log('Step 1: Create a draft template');
  const template = await createTemplate('Cascading Test 181');
  assert(template.id, 'Template created with ID: ' + template.id);
  assert(template.status === 'draft', 'Template starts as draft');

  // Step 2: Verify template appears as draft in list
  console.log('\nStep 2: Verify template is draft in list');
  let listRes = await fetch(`${BASE}/templates`, { headers: AUTH });
  let listData = await listRes.json();
  let found = listData.data.find(t => t.id === template.id);
  assert(found, 'Template found in list');
  assert(found && found.status === 'draft', 'Template shows as draft in list');

  // Step 3: Publish the template
  console.log('\nStep 3: Publish the template');
  const publishRes = await fetch(`${BASE}/templates/${template.id}/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  const publishData = await publishRes.json();
  assert(publishRes.status === 200 || publishRes.status === 201, 'Publish returns 200/201, got: ' + publishRes.status);
  assert(publishData.status === 'published', 'Publish response shows published status');

  // Step 4: Check template list - status shows published
  console.log('\nStep 4: Check template list - status shows published');
  listRes = await fetch(`${BASE}/templates`, { headers: AUTH });
  listData = await listRes.json();
  found = listData.data.find(t => t.id === template.id);
  assert(found, 'Template still in list after publish');
  assert(found && found.status === 'published', 'Template status is now "published" in list');

  // Step 5: Check template detail also shows published
  console.log('\nStep 5: Check template detail shows published');
  const detailRes = await fetch(`${BASE}/templates/${template.id}`, { headers: AUTH });
  const detail = await detailRes.json();
  assert(detail.status === 'published', 'Template detail shows published');
  assert(detail.publishedVer === detail.version, 'publishedVer matches version');

  // Step 6: Check version history - new entry
  console.log('\nStep 6: Check version history - new entry');
  const versionRes = await fetch(`${BASE}/templates/${template.id}/versions`, { headers: AUTH });
  const versionData = await versionRes.json();
  assert(versionRes.status === 200, 'Version history endpoint returns 200');
  assert(versionData.data && versionData.data.length > 0, 'Version history has entries');
  if (versionData.data && versionData.data.length > 0) {
    const latest = versionData.data[0];
    assert(latest.templateId === template.id, 'Version entry references correct template');
    assert(latest.status === 'published', 'Version entry status is published');
    assert(latest.version === 1, 'Version entry version is 1');
    assert(latest.savedBy === USER_ID, 'Version entry savedBy matches user');
    assert(latest.changeNote === 'Published', 'Version entry has "Published" change note');
  }

  // Step 7: Check audit log - publish entry
  console.log('\nStep 7: Check audit log - publish entry');
  const auditRes = await fetch(`${BASE}/audit?entityType=template&entityId=${template.id}&action=template.published`, {
    headers: AUTH,
  });
  const auditData = await auditRes.json();
  assert(auditRes.status === 200, 'Audit log query returns 200');
  assert(auditData.data && auditData.data.length > 0, 'Audit log has publish entry');
  if (auditData.data && auditData.data.length > 0) {
    const auditEntry = auditData.data[0];
    assert(auditEntry.action === 'template.published', 'Audit action is template.published');
    assert(auditEntry.entityId === template.id, 'Audit entityId matches template');
    assert(auditEntry.userId === USER_ID, 'Audit userId matches');
    assert(auditEntry.metadata && auditEntry.metadata.name === 'Cascading Test 181', 'Audit metadata has template name');
  }

  // Step 8: Verify create also has audit entry
  console.log('\nStep 8: Verify create also has audit entry');
  const createAuditRes = await fetch(`${BASE}/audit?entityType=template&entityId=${template.id}&action=template.created`, {
    headers: AUTH,
  });
  const createAuditData = await createAuditRes.json();
  assert(createAuditData.data && createAuditData.data.length > 0, 'Audit log has create entry');

  // Step 9: Republish (idempotent) should still show published
  console.log('\nStep 9: Republish (idempotent)');
  const republishRes = await fetch(`${BASE}/templates/${template.id}/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  const republishData = await republishRes.json();
  assert(republishRes.status === 200 || republishRes.status === 201, 'Republish returns 200/201, got: ' + republishRes.status);
  assert(republishData.status === 'published', 'Still shows published');

  // Step 10: Second template - verify independent versioning
  console.log('\nStep 10: Second template independent versioning');
  const template2 = await createTemplate('Cascading Test 181 B');
  const pub2Res = await fetch(`${BASE}/templates/${template2.id}/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  assert(pub2Res.status === 200 || pub2Res.status === 201, 'Second template published, got: ' + pub2Res.status);

  const ver2Res = await fetch(`${BASE}/templates/${template2.id}/versions`, { headers: AUTH });
  const ver2Data = await ver2Res.json();
  assert(ver2Data.data.length > 0, 'Second template has version history');
  assert(ver2Data.data[0].templateId === template2.id, 'Version entry belongs to second template');

  // Cleanup check: list both templates as published
  listRes = await fetch(`${BASE}/templates`, { headers: AUTH });
  listData = await listRes.json();
  const pub1 = listData.data.find(t => t.id === template.id);
  const pub2 = listData.data.find(t => t.id === template2.id);
  assert(pub1 && pub1.status === 'published', 'First template still published in list');
  assert(pub2 && pub2.status === 'published', 'Second template published in list');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
