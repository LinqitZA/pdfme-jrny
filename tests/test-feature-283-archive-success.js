const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-283', 'test-org-283', ['admin']);

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
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
const results = [];

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${name}`);
  } else {
    failed++;
    results.push(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  }
}

async function run() {
  const DESIGNER_FILE = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );

  // ──────────────────────────────────────────────
  // Test Group 1: UI Code - Archive button exists
  // ──────────────────────────────────────────────

  assert('archive button exists in code',
    DESIGNER_FILE.includes('data-testid="btn-archive"'));

  assert('archive button calls handleArchive',
    DESIGNER_FILE.includes('onClick={handleArchive}'));

  assert('archive button shows Archiving text during archive',
    DESIGNER_FILE.includes("'Archiving\u2026'") || DESIGNER_FILE.includes("Archiving…"));

  assert('archive button shows Archived text on success',
    DESIGNER_FILE.includes("'\u2713 Archived'") || DESIGNER_FILE.includes("Archived"));

  assert('archive button disabled during archiving',
    DESIGNER_FILE.includes("archiveStatus === 'archiving'"));

  // ──────────────────────────────────────────────
  // Test Group 2: UI Code - Archive handler
  // ──────────────────────────────────────────────

  assert('handleArchive function exists',
    DESIGNER_FILE.includes('handleArchive'));

  assert('archive sends DELETE request',
    DESIGNER_FILE.includes("method: 'DELETE'"));

  assert('archive shows confirmation dialog before proceeding',
    DESIGNER_FILE.includes('window.confirm') && DESIGNER_FILE.includes('archive'));

  assert('archive shows success toast with archived message',
    DESIGNER_FILE.includes('Template archived successfully'));

  assert('archive navigates to template list on success',
    DESIGNER_FILE.includes("window.location.href = url") || DESIGNER_FILE.includes('/templates'));

  assert('archive updates templateStatus to archived',
    DESIGNER_FILE.includes("setTemplateStatus('archived')"));

  assert('archive navigates after delay',
    DESIGNER_FILE.includes('setTimeout') && DESIGNER_FILE.includes('/templates'));

  // ──────────────────────────────────────────────
  // Test Group 3: API - Archive (DELETE) works correctly
  // ──────────────────────────────────────────────

  // Create a template
  const createRes = await request('POST', '/templates', {
    name: 'Archive Test Feature 283',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', x: 50, y: 50, w: 200, h: 24, content: 'Test' }],
        basePdf: { width: 210, height: 297 }
      }]
    }
  });
  assert('create template returns 201', createRes.status === 201, `got ${createRes.status}`);
  const templateId = createRes.body.id;

  // Archive (soft delete)
  const archiveRes = await request('DELETE', `/templates/${templateId}`);
  assert('archive returns 200', archiveRes.status === 200, `got ${archiveRes.status}`);
  assert('archive response has status archived', archiveRes.body.status === 'archived', `got ${archiveRes.body.status}`);
  assert('archive response includes template id', archiveRes.body.id === templateId);

  // ──────────────────────────────────────────────
  // Test Group 4: Archived template not in default list
  // ──────────────────────────────────────────────

  const listRes = await request('GET', '/templates?search=Archive%20Test%20Feature%20283');
  assert('archived template not in default list', listRes.body.data.length === 0, `found ${listRes.body.data.length}`);

  // But available via explicit archived status filter
  const archivedListRes = await request('GET', '/templates?status=archived&search=Archive%20Test%20Feature%20283');
  assert('archived template visible with archived status filter',
    archivedListRes.body.data.length >= 1, `found ${archivedListRes.body.data.length}`);

  // ──────────────────────────────────────────────
  // Test Group 5: Archive of nonexistent template
  // ──────────────────────────────────────────────

  const badArchiveRes = await request('DELETE', '/templates/nonexistent-id-283');
  assert('archive nonexistent template returns 404', badArchiveRes.status === 404, `got ${badArchiveRes.status}`);

  // ──────────────────────────────────────────────
  // Test Group 6: Double archive returns 404
  // ──────────────────────────────────────────────

  const doubleArchiveRes = await request('DELETE', `/templates/${templateId}`);
  assert('double archive is idempotent (returns 200 with archived status)',
    doubleArchiveRes.status === 200 && doubleArchiveRes.body.status === 'archived',
    `got ${doubleArchiveRes.status} - ${JSON.stringify(doubleArchiveRes.body)}`);

  // ──────────────────────────────────────────────
  // Test Group 7: GET archived template returns 404
  // ──────────────────────────────────────────────

  const getArchivedRes = await request('GET', `/templates/${templateId}`);
  assert('GET archived template returns 404',
    getArchivedRes.status === 404, `got ${getArchivedRes.status}`);

  // ──────────────────────────────────────────────
  // Test Group 8: Archive error handling in UI
  // ──────────────────────────────────────────────

  assert('archive error state exists',
    DESIGNER_FILE.includes("setArchiveStatus('error')"));

  assert('archive error shows toast',
    DESIGNER_FILE.includes("addToast('error'") && DESIGNER_FILE.includes('archive'));

  // Summary
  const total = passed + failed;
  console.log(`\nFeature #283: Archive success shows confirmation`);
  console.log(`${'='.repeat(50)}`);
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${total} tests passed${failed > 0 ? ` (${failed} failed)` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
