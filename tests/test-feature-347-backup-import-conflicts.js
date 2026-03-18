/**
 * Feature #347: Backup import handles conflicts gracefully
 * Tests: Import to org with existing data doesn't corrupt
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
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

const RUN_ID = Date.now().toString(36);
const TOKEN_SRC = makeToken('org-csrc-' + RUN_ID, 'user-347-src');
const TOKEN_DST = makeToken('org-cdst-' + RUN_ID, 'user-347-dst');

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
  // Step 1: Create templates in source org
  const srcTpl1 = await request('POST', '/api/pdfme/templates', {
    name: 'Conflict Invoice 347', type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Source Invoice' }] }] }
  }, TOKEN_SRC);
  assert('Create source template 1', srcTpl1.status === 201);

  const srcTpl2 = await request('POST', '/api/pdfme/templates', {
    name: 'Conflict Statement 347', type: 'statement',
    schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Source Statement' }] }] }
  }, TOKEN_SRC);
  assert('Create source template 2', srcTpl2.status === 201);

  // Step 2: Create existing templates in destination org with SAME names
  const dstExisting1 = await request('POST', '/api/pdfme/templates', {
    name: 'Conflict Invoice 347', type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', x: 5, y: 5, width: 80, height: 15, content: 'Existing Invoice' }] }] }
  }, TOKEN_DST);
  assert('Create existing dst template with same name', dstExisting1.status === 201);
  const existingId = dstExisting1.body.id;
  const existingSchema = dstExisting1.body.schema;

  // Also create a unique template in destination
  const dstExisting2 = await request('POST', '/api/pdfme/templates', {
    name: 'Unique Dst Template 347', type: 'report',
    schema: { pages: [{ elements: [{ type: 'text', x: 0, y: 0, width: 50, height: 10, content: 'Unique' }] }] }
  }, TOKEN_DST);
  assert('Create unique dst template', dstExisting2.status === 201);
  const uniqueId = dstExisting2.body.id;

  // Step 3: Export backup from source
  const backup = await request('GET', '/api/pdfme/templates/backup', null, TOKEN_SRC);
  assert('Backup export succeeds', backup.status === 200);
  assert('Backup has templates', backup.body.templates.length >= 2);

  // Step 4: Import backup to destination (which already has data)
  const importResult = await request('POST', '/api/pdfme/templates/backup/import', backup.body, TOKEN_DST);
  assert('Import returns 201', importResult.status === 201);
  assert('Import created templates', importResult.body.templatesCreated >= 2);

  // Step 5: Verify existing templates are untouched
  const existingFetched = await request('GET', '/api/pdfme/templates/' + existingId, null, TOKEN_DST);
  assert('Existing template still exists', existingFetched.status === 200);
  assert('Existing template name unchanged', existingFetched.body.name === 'Conflict Invoice 347');
  // Schema may have additional default fields added by the service, so check key content is preserved
  const schemaStr = JSON.stringify(existingFetched.body.schema);
  assert('Existing template schema preserved', schemaStr.includes('Existing Invoice') && schemaStr.includes('pages'));

  const uniqueFetched = await request('GET', '/api/pdfme/templates/' + uniqueId, null, TOKEN_DST);
  assert('Unique dst template still exists', uniqueFetched.status === 200);
  assert('Unique dst template name unchanged', uniqueFetched.body.name === 'Unique Dst Template 347');

  // Step 6: Verify no name collisions - imported templates should have deduped names
  const allDst = await request('GET', '/api/pdfme/templates?limit=100', null, TOKEN_DST);
  const conflict347 = allDst.body.data.filter(t => t.name && t.name.includes('Conflict Invoice 347'));
  assert('Multiple templates with similar names exist', conflict347.length >= 2);

  // Original should keep its name, imported should have (Import) suffix
  const originalName = conflict347.find(t => t.name === 'Conflict Invoice 347');
  const importedName = conflict347.find(t => t.name.includes('(Import)'));
  assert('Original keeps exact name', !!originalName);
  assert('Imported gets (Import) suffix', !!importedName);

  // Step 7: Verify new templates added as drafts
  const importedTemplates = importResult.body.templates;
  const allDrafts = importedTemplates.every(t => t.status === 'draft');
  assert('All imported templates are drafts', allDrafts);

  // Step 8: Verify statement template also imported correctly
  const stmtTemplates = allDst.body.data.filter(t => t.name && t.name.includes('Conflict Statement 347'));
  assert('Statement template imported', stmtTemplates.length >= 1);

  // Step 9: Verify imported templates have unique IDs (no ID collisions)
  const importedIds = importedTemplates.map(t => t.id);
  const uniqueIds = new Set(importedIds);
  assert('All imported template IDs are unique', uniqueIds.size === importedIds.length);
  assert('Imported IDs differ from existing', !importedIds.includes(existingId));

  // Step 10: Verify total count increased correctly
  const totalBefore = 2; // We created 2 in dst
  const importedCount = importResult.body.templatesCreated;
  // dst should have original 2 + imported count (note: backup may include system templates)
  const dst347Templates = allDst.body.data.filter(t =>
    t.name && (t.name.includes('Conflict') || t.name.includes('Unique Dst'))
  );
  assert('Total dst templates increased', dst347Templates.length >= totalBefore + 2);

  // Step 11: Double import - import same backup again
  const importResult2 = await request('POST', '/api/pdfme/templates/backup/import', backup.body, TOKEN_DST);
  assert('Second import succeeds', importResult2.status === 201);

  // After second import, name dedup should produce (Import 2) or similar
  const allDstAfter2 = await request('GET', '/api/pdfme/templates?limit=100', null, TOKEN_DST);
  const invoiceConflicts = allDstAfter2.body.data.filter(t => t.name && t.name.includes('Conflict Invoice 347'));
  assert('After 2 imports, multiple versions exist', invoiceConflicts.length >= 3);

  // Verify no two templates have the same name
  const invoiceNames = invoiceConflicts.map(t => t.name);
  const uniqueNames = new Set(invoiceNames);
  assert('No duplicate names after multiple imports', uniqueNames.size === invoiceNames.length);

  // Step 12: Existing templates still usable after all imports
  const existingStillOk = await request('GET', '/api/pdfme/templates/' + existingId, null, TOKEN_DST);
  assert('Existing template still accessible after multiple imports', existingStillOk.status === 200);
  assert('Existing template data intact', existingStillOk.body.name === 'Conflict Invoice 347');

  // Summary
  process.stdout.write('Feature #347: ' + passed + '/' + (passed + failed) + ' tests passed\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { process.stderr.write('Error: ' + e.message + '\n'); process.exit(1); });
