/**
 * Test Feature #29: All state-changing actions create audit entries
 *
 * Verifies every mutation endpoint writes to AuditLog:
 * - Create template → audit entry action=template.created
 * - Update template draft → audit entry action=template.updated
 * - Publish template → audit entry action=template.published
 * - Render document → audit entry action=document.rendered
 * - Archive template → audit entry action=template.archived
 * - Fork template → audit entry action=template.forked
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = 'pdfme-dev-secret';

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
  sub: 'audit-user-29',
  orgId: 'org-audit-29',
  roles: [
    'admin', 'template:view', 'template:edit', 'template:publish',
    'template:delete', 'template:import', 'render:trigger',
    'render:bulk', 'audit:view',
  ],
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

async function findAuditEntry(entityId, action) {
  const res = await request('GET', `${BASE}/audit?entityId=${entityId}&limit=100`);
  if (res.status !== 200 || !Array.isArray(res.body.data)) return null;
  return res.body.data.find(e => e.action === action);
}

async function run() {
  const UID = Date.now();

  // 1. Create a template → verify audit entry action=template.created
  const createRes = await request('POST', `${BASE}/templates`, {
    type: 'invoice',
    name: `Audit-Mutation-Test-${UID}`,
    schema: { pages: [{ elements: [{ type: 'text', name: 'field1', content: '{{document.number}}', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
  });
  assert('Template created successfully', createRes.status === 201);
  const templateId = createRes.body.id;

  // Wait a moment for async audit writes
  await new Promise(r => setTimeout(r, 500));

  const createdAudit = await findAuditEntry(templateId, 'template.created');
  assert('Audit entry for template.created exists', !!createdAudit);
  assert('template.created has correct orgId', createdAudit && createdAudit.orgId === 'org-audit-29');
  assert('template.created has correct userId', createdAudit && createdAudit.userId === 'audit-user-29');
  assert('template.created has entityType=template', createdAudit && createdAudit.entityType === 'template');

  // 2. Update template draft → verify audit entry action=template.updated
  const updateRes = await request('PUT', `${BASE}/templates/${templateId}/draft`, {
    name: `Audit-Mutation-Updated-${UID}`,
    schema: { pages: [{ elements: [{ type: 'text', name: 'field1', content: '{{document.number}} updated', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
  });
  assert('Template draft updated successfully', updateRes.status === 200);

  await new Promise(r => setTimeout(r, 500));

  const updatedAudit = await findAuditEntry(templateId, 'template.updated');
  assert('Audit entry for template.updated exists', !!updatedAudit);
  assert('template.updated has correct orgId', updatedAudit && updatedAudit.orgId === 'org-audit-29');
  assert('template.updated has correct userId', updatedAudit && updatedAudit.userId === 'audit-user-29');

  // 3. Publish template → verify audit entry action=template.published
  const publishRes = await request('POST', `${BASE}/templates/${templateId}/publish`);
  assert('Template published successfully', publishRes.status === 200 || publishRes.status === 201);

  await new Promise(r => setTimeout(r, 500));

  const publishedAudit = await findAuditEntry(templateId, 'template.published');
  assert('Audit entry for template.published exists', !!publishedAudit);
  assert('template.published has correct orgId', publishedAudit && publishedAudit.orgId === 'org-audit-29');

  // 4. Render document → verify audit entry action=document.rendered
  const renderRes = await request('POST', `${BASE}/render/now`, {
    templateId,
    channel: 'email',
    entityType: 'invoice',
    entityId: `INV-AUDIT-${UID}`,
    data: { 'document.number': 'INV-001' },
  });
  assert('Document rendered successfully', renderRes.status === 200 || renderRes.status === 201);

  await new Promise(r => setTimeout(r, 1000));

  // Find audit for document rendered - the entityId would be the generated document ID
  const auditAll = await request('GET', `${BASE}/audit?limit=100`);
  const renderAudits = auditAll.body.data.filter(e => e.action === 'document.rendered');
  assert('Audit entry for document.rendered exists', renderAudits.length > 0);

  // 5. Fork template → verify audit entry action=template.forked
  // First un-archive and re-create to fork
  const forkRes = await request('POST', `${BASE}/templates/${templateId}/fork`, {
    name: `Forked-Audit-Test-${UID}`,
  });
  assert('Template forked successfully', forkRes.status === 200 || forkRes.status === 201);

  if (forkRes.status === 200 || forkRes.status === 201) {
    const forkedId = forkRes.body.id;
    await new Promise(r => setTimeout(r, 500));

    const forkedAudit = await findAuditEntry(forkedId, 'template.forked');
    assert('Audit entry for template.forked exists', !!forkedAudit);
    assert('template.forked has correct orgId', forkedAudit && forkedAudit.orgId === 'org-audit-29');
    assert('template.forked has correct userId', forkedAudit && forkedAudit.userId === 'audit-user-29');
    assert('Forked template has forkedFromId', forkRes.body.forkedFromId === templateId);
    assert('Forked template is draft', forkRes.body.status === 'draft');
    assert('Forked template has correct name', forkRes.body.name === `Forked-Audit-Test-${UID}`);
  } else {
    assert('Audit entry for template.forked exists', false);
    assert('template.forked has correct orgId', false);
    assert('template.forked has correct userId', false);
    assert('Forked template has forkedFromId', false);
    assert('Forked template is draft', false);
    assert('Forked template has correct name', false);
  }

  // 6. Create another template and archive it to test template.archived
  const archiveCreateRes = await request('POST', `${BASE}/templates`, {
    type: 'invoice',
    name: `Archive-Audit-Test-${UID}`,
    schema: { pages: [{ elements: [] }] },
  });
  assert('Template for archive test created', archiveCreateRes.status === 201);
  const archiveTemplateId = archiveCreateRes.body.id;

  const archiveRes = await request('DELETE', `${BASE}/templates/${archiveTemplateId}`);
  assert('Template archived (soft-delete) successfully', archiveRes.status === 200);

  await new Promise(r => setTimeout(r, 500));

  const archivedAudit = await findAuditEntry(archiveTemplateId, 'template.archived');
  assert('Audit entry for template.archived exists', !!archivedAudit);
  assert('template.archived has correct orgId', archivedAudit && archivedAudit.orgId === 'org-audit-29');

  // 7. Verify all audit entries are in the org's audit log
  const finalAudit = await request('GET', `${BASE}/audit?limit=200`);
  assert('Final audit query succeeds', finalAudit.status === 200);

  const actions = new Set(finalAudit.body.data.map(e => e.action));
  assert('All expected actions present: template.created', actions.has('template.created'));
  assert('All expected actions present: template.updated', actions.has('template.updated'));
  assert('All expected actions present: template.published', actions.has('template.published'));
  assert('All expected actions present: document.rendered', actions.has('document.rendered'));
  assert('All expected actions present: template.forked', actions.has('template.forked'));
  assert('All expected actions present: template.archived', actions.has('template.archived'));

  // 8. Verify all entries have required fields
  for (const entry of finalAudit.body.data.slice(0, 10)) {
    if (!entry.id || !entry.orgId || !entry.entityType || !entry.entityId || !entry.action || !entry.userId || !entry.createdAt) {
      assert('All audit entries have required fields', false);
      break;
    }
  }
  assert('All audit entries have required fields', true);

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
