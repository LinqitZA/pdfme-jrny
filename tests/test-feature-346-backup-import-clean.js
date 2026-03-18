/**
 * Feature #346: Backup import to clean org works
 * Tests: Export from org-A, Import to empty org-B, verify all data
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
let passed = 0;
let failed = 0;

function makeToken(orgId, userId) {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId, orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN_A = makeToken('org-bkp-src-346', 'user-346-src');
const TOKEN_B = makeToken('org-bkp-dst-346', 'user-346-dst');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const postData = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    };
    if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) { passed++; }
  else { failed++; process.stderr.write('FAIL: ' + name + '\n'); }
}

async function run() {
  // Step 1: Create templates in org-A
  const tpl1 = await request('POST', '/api/pdfme/templates', {
    name: 'BkpTest Invoice 346', type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Invoice' }] }] }
  }, TOKEN_A);
  assert('Create template 1 in org-A', tpl1.status === 201);

  const tpl2 = await request('POST', '/api/pdfme/templates', {
    name: 'BkpTest Statement 346', type: 'statement',
    schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Statement' }] }] }
  }, TOKEN_A);
  assert('Create template 2 in org-A', tpl2.status === 201);

  const tpl3 = await request('POST', '/api/pdfme/templates', {
    name: 'BkpTest PO 346', type: 'purchase_order',
    schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'PO' }] }] }
  }, TOKEN_A);
  assert('Create template 3 in org-A', tpl3.status === 201);

  // Step 2: Upload an asset (signature) to org-A
  const sigUpload = await request('POST', '/api/pdfme/signatures/upload', {
    data: Buffer.from('fake-png-signature-346').toString('base64'),
  }, TOKEN_A);
  // Signature upload might be multipart, let's try the API format used
  const sigOk = sigUpload.status === 201 || sigUpload.status === 200;

  // Step 3: Export backup from org-A
  const backup = await request('GET', '/api/pdfme/templates/backup', null, TOKEN_A);
  assert('Backup export succeeds', backup.status === 200);
  assert('Backup has templates array', Array.isArray(backup.body.templates));
  assert('Backup has 3+ templates', backup.body.templates.length >= 3);
  assert('Backup has assets object', backup.body.assets && typeof backup.body.assets === 'object');
  assert('Backup has version', backup.body.version === 1);
  assert('Backup has exportedAt', typeof backup.body.exportedAt === 'string');

  // Step 4: Verify org-B is clean (no templates)
  const orgBList = await request('GET', '/api/pdfme/templates?limit=100', null, TOKEN_B);
  const orgBTemplatesBefore = orgBList.body.data ? orgBList.body.data.filter(t => t.name && t.name.includes('BkpTest')) : [];
  assert('Org-B has no BkpTest templates before import', orgBTemplatesBefore.length === 0);

  // Step 5: Import backup to org-B
  const importResult = await request('POST', '/api/pdfme/templates/backup/import', backup.body, TOKEN_B);
  assert('Import returns 201', importResult.status === 201);
  assert('Import has templatesCreated count', typeof importResult.body.templatesCreated === 'number');
  assert('Import created 3+ templates', importResult.body.templatesCreated >= 3);
  assert('Import has assetsRestored', importResult.body.assetsRestored && typeof importResult.body.assetsRestored === 'object');
  assert('Import returns templates array', Array.isArray(importResult.body.templates));

  // Step 6: Verify all templates created in org-B
  const orgBAfter = await request('GET', '/api/pdfme/templates?limit=100', null, TOKEN_B);
  const bkpTemplates = orgBAfter.body.data ? orgBAfter.body.data.filter(t => t.name && t.name.includes('BkpTest')) : [];
  assert('Org-B now has BkpTest templates', bkpTemplates.length >= 3);

  // Verify template names match
  const bkpNames = bkpTemplates.map(t => t.name);
  assert('Invoice template imported', bkpNames.some(n => n.includes('BkpTest Invoice 346')));
  assert('Statement template imported', bkpNames.some(n => n.includes('BkpTest Statement 346')));
  assert('PO template imported', bkpNames.some(n => n.includes('BkpTest PO 346')));

  // Step 7: Verify all imported templates are drafts
  const allDrafts = bkpTemplates.every(t => t.status === 'draft');
  assert('All imported templates are drafts', allDrafts);

  // Step 8: Verify templates are usable (can be fetched by ID)
  for (const tpl of importResult.body.templates.slice(0, 3)) {
    const fetched = await request('GET', '/api/pdfme/templates/' + tpl.id, null, TOKEN_B);
    assert('Template ' + tpl.name + ' fetchable by ID', fetched.status === 200);
    assert('Template ' + tpl.name + ' has schema', fetched.body.schema && typeof fetched.body.schema === 'object');
  }

  // Step 9: Verify templates can be edited (usable immediately)
  if (importResult.body.templates.length > 0) {
    const firstId = importResult.body.templates[0].id;
    const editResult = await request('PUT', '/api/pdfme/templates/' + firstId + '/draft', {
      schema: { pages: [{ elements: [{ type: 'text', x: 20, y: 20, width: 200, height: 40, content: 'Edited after import' }] }] }
    }, TOKEN_B);
    assert('Imported template can be edited', editResult.status === 200);
  }

  // Step 10: Verify assets were restored
  assert('Assets images restored count is number', typeof importResult.body.assetsRestored.images === 'number');
  assert('Assets fonts restored count is number', typeof importResult.body.assetsRestored.fonts === 'number');

  // Summary
  process.stdout.write('Feature #346: ' + passed + '/' + (passed + failed) + ' tests passed\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { process.stderr.write('Error: ' + e.message + '\n'); process.exit(1); });
