/**
 * Feature #348: Export/import round-trip preserves data
 * Tests: Export then import produces identical templates
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
let passed = 0;
let failed = 0;
const RUN_ID = Date.now().toString(36);

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

const TOKEN = makeToken('org-rt-' + RUN_ID, 'user-348');

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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function run() {
  // Step 1: Create a complex template with multiple pages, elements, and varied properties
  const complexSchema = {
    pages: [
      {
        width: 210, height: 297,
        elements: [
          { type: 'text', x: 10, y: 10, width: 190, height: 30, content: 'INVOICE #{{invoice_number}}', fontSize: 24, fontWeight: 'bold', alignment: 'center' },
          { type: 'text', x: 10, y: 50, width: 90, height: 15, content: 'Bill To: {{customer_name}}', fontSize: 12 },
          { type: 'text', x: 110, y: 50, width: 90, height: 15, content: 'Date: {{invoice_date}}', fontSize: 12, alignment: 'right' },
          { type: 'image', x: 10, y: 260, width: 50, height: 30, src: 'logo.png' },
          { type: 'text', x: 10, y: 100, width: 190, height: 150, content: 'Line items table area', fontSize: 10 }
        ]
      },
      {
        width: 210, height: 297,
        elements: [
          { type: 'text', x: 10, y: 10, width: 190, height: 20, content: 'Terms and Conditions', fontSize: 16, fontWeight: 'bold' },
          { type: 'text', x: 10, y: 40, width: 190, height: 240, content: 'Long legal text here with special chars: & < > " \' \\ / \n newlines and\ttabs', fontSize: 9 }
        ]
      }
    ],
    dataBindings: {
      invoice_number: { source: 'entity', field: 'invoiceNumber' },
      customer_name: { source: 'entity', field: 'customer.name' },
      invoice_date: { source: 'expression', expr: 'FORMAT_DATE(TODAY(), "yyyy-MM-dd")' }
    },
    outputConfig: {
      channel: 'email',
      paperSize: 'A4'
    }
  };

  const createResult = await request('POST', '/api/pdfme/templates', {
    name: 'Roundtrip Complex 348 ' + RUN_ID,
    type: 'invoice',
    schema: complexSchema
  }, TOKEN);
  assert('Create complex template', createResult.status === 201);
  const originalId = createResult.body.id;
  const originalName = createResult.body.name;

  // Step 2: Fetch the original to get the full saved schema
  const originalFetch = await request('GET', '/api/pdfme/templates/' + originalId, null, TOKEN);
  assert('Fetch original template', originalFetch.status === 200);
  const originalSchema = originalFetch.body.schema;
  const originalType = originalFetch.body.type;

  // Step 3: Export the template
  const exportResult = await request('GET', '/api/pdfme/templates/' + originalId + '/export', null, TOKEN);
  assert('Export succeeds', exportResult.status === 200);
  assert('Export has version', typeof exportResult.body.version === 'number');
  assert('Export has exportedAt', typeof exportResult.body.exportedAt === 'string');
  assert('Export has template object', typeof exportResult.body.template === 'object');
  assert('Export template has name', exportResult.body.template.name === originalName);
  assert('Export template has type', exportResult.body.template.type === originalType);
  assert('Export template has schema', typeof exportResult.body.template.schema === 'object');
  assert('Export has assets', typeof exportResult.body.assets === 'object');

  // Step 4: Delete the original template
  const deleteResult = await request('DELETE', '/api/pdfme/templates/' + originalId, null, TOKEN);
  assert('Delete original template', deleteResult.status === 200 || deleteResult.status === 204);

  // Verify it's gone or archived
  const fetchDeleted = await request('GET', '/api/pdfme/templates/' + originalId, null, TOKEN);
  const isGoneOrArchived = fetchDeleted.status === 404 || (fetchDeleted.status === 200 && fetchDeleted.body.status === 'archived');
  assert('Original template is deleted or archived', isGoneOrArchived);

  // Step 5: Import the exported package
  const importResult = await request('POST', '/api/pdfme/templates/import', exportResult.body, TOKEN);
  assert('Import succeeds', importResult.status === 201);
  const importedId = importResult.body.id;
  assert('Imported template has new ID', typeof importedId === 'string');
  assert('Imported template is draft', importResult.body.status === 'draft');

  // Step 6: Fetch the imported template and compare schemas
  const importedFetch = await request('GET', '/api/pdfme/templates/' + importedId, null, TOKEN);
  assert('Fetch imported template', importedFetch.status === 200);
  const importedSchema = importedFetch.body.schema;

  // Compare key schema properties
  assert('Schema pages count matches', importedSchema.pages && originalSchema.pages && importedSchema.pages.length === originalSchema.pages.length);

  // Compare page 1 elements
  if (importedSchema.pages && originalSchema.pages) {
    const origPage1 = originalSchema.pages[0];
    const impPage1 = importedSchema.pages[0];
    assert('Page 1 element count matches', impPage1.elements && origPage1.elements && impPage1.elements.length === origPage1.elements.length);

    // Compare each element in page 1
    if (origPage1.elements && impPage1.elements) {
      for (let i = 0; i < origPage1.elements.length; i++) {
        const orig = origPage1.elements[i];
        const imp = impPage1.elements[i];
        assert('Page 1 element ' + i + ' type matches', orig.type === imp.type);
        assert('Page 1 element ' + i + ' content matches', orig.content === imp.content);
        assert('Page 1 element ' + i + ' position matches', orig.x === imp.x && orig.y === imp.y);
        assert('Page 1 element ' + i + ' size matches', orig.width === imp.width && orig.height === imp.height);
      }
    }

    // Compare page 2 elements
    if (originalSchema.pages.length > 1 && importedSchema.pages.length > 1) {
      const origPage2 = originalSchema.pages[1];
      const impPage2 = importedSchema.pages[1];
      assert('Page 2 element count matches', impPage2.elements && origPage2.elements && impPage2.elements.length === origPage2.elements.length);
      if (origPage2.elements && impPage2.elements) {
        assert('Page 2 text with special chars preserved', impPage2.elements[1].content === origPage2.elements[1].content);
      }
    }
  }

  // Compare data bindings
  assert('DataBindings preserved', deepEqual(importedSchema.dataBindings, originalSchema.dataBindings));

  // Compare output config
  assert('OutputConfig preserved', deepEqual(importedSchema.outputConfig, originalSchema.outputConfig));

  // Step 7: Verify template type preserved
  assert('Template type preserved', importedFetch.body.type === originalType);

  // Step 8: Verify imported template is usable (can save draft)
  const editResult = await request('PUT', '/api/pdfme/templates/' + importedId + '/draft', {
    schema: importedSchema
  }, TOKEN);
  assert('Imported template can be edited', editResult.status === 200);

  // Step 9: Second round-trip to verify stability
  const reExport = await request('GET', '/api/pdfme/templates/' + importedId + '/export', null, TOKEN);
  assert('Re-export succeeds', reExport.status === 200);

  const reImport = await request('POST', '/api/pdfme/templates/import', reExport.body, TOKEN);
  assert('Re-import succeeds', reImport.status === 201);

  const reImportedFetch = await request('GET', '/api/pdfme/templates/' + reImport.body.id, null, TOKEN);
  assert('Re-imported template fetchable', reImportedFetch.status === 200);
  assert('Re-imported schema pages match', reImportedFetch.body.schema.pages && reImportedFetch.body.schema.pages.length === originalSchema.pages.length);
  assert('Round-trip stable (data bindings)', deepEqual(reImportedFetch.body.schema.dataBindings, originalSchema.dataBindings));

  // Summary
  process.stdout.write('Feature #348: ' + passed + '/' + (passed + failed) + ' tests passed\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { process.stderr.write('Error: ' + e.message + '\n'); process.exit(1); });
