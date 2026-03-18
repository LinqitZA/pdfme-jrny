/**
 * Feature #106: Backup import restores from ZIP
 *
 * Tests that POST /api/pdfme/templates/backup/import-zip accepts a ZIP file
 * and restores templates, assets as drafts.
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const { Buffer } = require('buffer');

const BASE_URL = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function makeToken(orgId, roles = ['super_admin'], sub = 'user-test') {
  return jwt.sign({ sub, orgId, roles }, 'pdfme-dev-secret');
}

function request(method, path, body, token, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {},
    };
    if (contentType) options.headers['Content-Type'] = contentType;
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    let bodyBuf;
    if (body instanceof Buffer) {
      bodyBuf = body;
      options.headers['Content-Length'] = body.length;
    } else if (body) {
      bodyBuf = Buffer.from(JSON.stringify(body));
      options.headers['Content-Length'] = bodyBuf.length;
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        let data;
        if (ct.includes('application/json')) {
          try { data = JSON.parse(buffer.toString()); } catch { data = buffer; }
        } else if (ct.includes('application/zip')) {
          data = buffer;
        } else {
          try { data = JSON.parse(buffer.toString()); } catch { data = buffer.toString(); }
        }
        resolve({ status: res.statusCode, data, headers: res.headers, buffer });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${name}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

async function run() {
  const sourceOrg = 'org-zip-export-106';
  const targetOrg = 'org-zip-import-106';
  const sourceToken = makeToken(sourceOrg);
  const targetToken = makeToken(targetOrg);

  process.stdout.write('=== Feature #106: Backup import restores from ZIP ===\n\n');

  // Step 1: Create test data in source org
  process.stdout.write('Step 1: Create test data in source org\n');

  const tpl1 = await request('POST', '/api/pdfme/templates', {
    name: 'Import-ZIP-Template-A',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', name: 'title', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Invoice A' }] }] },
  }, sourceToken);
  assert('Source template A created', tpl1.status === 201);

  const tpl2 = await request('POST', '/api/pdfme/templates', {
    name: 'Import-ZIP-Template-B',
    type: 'report',
    schema: { pages: [{ elements: [{ type: 'text', name: 'header', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Report B' }] }] },
  }, sourceToken);
  assert('Source template B created', tpl2.status === 201);

  // Upload asset to source org via multipart
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const assetUploaded = await new Promise((resolve) => {
    const boundary = '----FormBound' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo-106.png"\r\nContent-Type: image/png\r\n\r\n`),
      pngBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = http.request({
      hostname: 'localhost', port: 3000,
      path: '/api/pdfme/assets/upload',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sourceToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 201 || res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
  assert('Asset uploaded to source org', assetUploaded);

  // Step 2: Export source org as ZIP
  process.stdout.write('\nStep 2: Export source org as ZIP\n');
  const exportRes = await request('POST', '/api/pdfme/templates/backup/export', null, sourceToken);
  assert('Export returns 200', exportRes.status === 200);
  const zipBuffer = exportRes.buffer;
  const isValidZip = zipBuffer.length > 4 && zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4B;
  assert('Got valid ZIP file', isValidZip);

  // Step 3: Import ZIP into target org (send as base64 in JSON body)
  process.stdout.write('\nStep 3: Import ZIP into target org\n');
  const importRes = await request('POST', '/api/pdfme/templates/backup/import-zip', { zip: zipBuffer.toString('base64') }, targetToken, 'application/json');
  assert('Import returns 201', importRes.status === 201);
  assert('Import result has templatesCreated', typeof importRes.data?.templatesCreated === 'number');
  assert('Import created templates', importRes.data?.templatesCreated >= 2);
  assert('Import result has templates array', Array.isArray(importRes.data?.templates));

  // Step 4: Verify templates are created as drafts
  process.stdout.write('\nStep 4: Verify imported templates are drafts\n');
  if (importRes.data?.templates) {
    const importedTemplates = importRes.data.templates;
    const hasTemplateA = importedTemplates.some(t => t.name.includes('Import-ZIP-Template-A'));
    const hasTemplateB = importedTemplates.some(t => t.name.includes('Import-ZIP-Template-B'));
    assert('Template A imported', hasTemplateA);
    assert('Template B imported', hasTemplateB);

    const allDrafts = importedTemplates.every(t => t.status === 'draft');
    assert('All imported templates are drafts', allDrafts);

    // Verify template data via GET
    if (importedTemplates.length > 0) {
      const firstTpl = importedTemplates.find(t => t.name.includes('Import-ZIP-Template-A'));
      if (firstTpl) {
        const getRes = await request('GET', `/api/pdfme/templates/${firstTpl.id}`, null, targetToken);
        assert('Imported template retrievable via GET', getRes.status === 200);
        assert('Retrieved template has correct type', getRes.data?.type === 'invoice');
        assert('Retrieved template has schema with pages', Array.isArray(getRes.data?.schema?.pages));
      }
    }
  }

  // Step 5: Assets restored
  process.stdout.write('\nStep 5: Verify assets restoration\n');
  assert('Assets restored info present', importRes.data?.assetsRestored !== undefined);
  if (importRes.data?.assetsRestored) {
    assert('Images restored count present', typeof importRes.data.assetsRestored.images === 'number');
    assert('Fonts restored count present', typeof importRes.data.assetsRestored.fonts === 'number');
  }

  // Step 6: Deduplication test - import again
  process.stdout.write('\nStep 6: Deduplication on re-import\n');
  const reimportRes = await request('POST', '/api/pdfme/templates/backup/import-zip', { zip: zipBuffer.toString('base64') }, targetToken, 'application/json');
  assert('Re-import returns 201', reimportRes.status === 201);
  if (reimportRes.data?.templates) {
    // Templates should be deduplicated (names should have "(Import)" suffix)
    const hasDeduped = reimportRes.data.templates.some(t => t.name.includes('(Import'));
    assert('Re-imported templates have deduplicated names', hasDeduped);
  }

  // Step 7: Round-trip integrity
  process.stdout.write('\nStep 7: Round-trip integrity\n');
  // Export from target org and verify it has the imported templates
  const targetExportRes = await request('POST', '/api/pdfme/templates/backup/export', null, targetToken);
  assert('Target org export succeeds', targetExportRes.status === 200);
  if (targetExportRes.buffer[0] === 0x50) {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(targetExportRes.buffer);
      const tplIndex = JSON.parse(zip.getEntry('templates/index.json').getData().toString('utf8'));
      const hasImported = tplIndex.some(t => t.name.includes('Import-ZIP-Template'));
      assert('Target org export contains imported templates', hasImported);
    } catch (e) {
      assert('Target org export ZIP valid', false);
    }
  }

  // Step 8: Auth required
  process.stdout.write('\nStep 8: Auth verification\n');
  const noAuthRes = await request('POST', '/api/pdfme/templates/backup/import-zip', { zip: zipBuffer.toString('base64') }, null, 'application/json');
  assert('No auth returns 401', noAuthRes.status === 401);

  // Step 9: Invalid ZIP rejected
  process.stdout.write('\nStep 9: Invalid input handling\n');
  const invalidRes = await request('POST', '/api/pdfme/templates/backup/import-zip', { zip: Buffer.from('not a zip file').toString('base64') }, targetToken, 'application/json');
  assert('Invalid ZIP returns 422', invalidRes.status === 422);

  const noZipField = await request('POST', '/api/pdfme/templates/backup/import-zip', { data: 'missing' }, targetToken, 'application/json');
  assert('Missing zip field returns 422', noZipField.status === 422);

  // Summary
  process.stdout.write(`\n=== Results: ${passed}/${passed + failed} passing ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write(`Fatal error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
