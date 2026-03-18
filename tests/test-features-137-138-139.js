/**
 * Test features #137, #138, #139
 * - #137: PDF/A-3b conversion via Ghostscript (or pdf-lib fallback)
 * - #138: PDF/A validation via veraPDF (or basic fallback)
 * - #139: Template import validates and creates draft
 */

const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXRlc3QiLCJvcmdJZCI6Im9yZy10ZXN0Iiwicm9sZXMiOlsidGVtcGxhdGU6ZWRpdCIsInRlbXBsYXRlOnB1Ymxpc2giLCJyZW5kZXI6dHJpZ2dlciIsInRlbXBsYXRlOmltcG9ydCJdfQ.testsig';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(body); } catch { json = body; }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testFeature137() {
  console.log('\n=== Feature #137: PDF/A-3b conversion via Ghostscript ===\n');

  // Step 1: Create a template and publish it
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'PDFA Test Template',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 10, content: 'Test Invoice' },
        { name: 'amount', type: 'text', position: { x: 20, y: 40 }, width: 100, height: 10, content: '1000.00' },
      ]],
    },
    orgId: 'org-test',
    createdBy: 'user-test',
    status: 'draft',
  });
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  const templateId = createRes.body.id;

  // Publish it
  const pubRes = await request('POST', `/api/pdfme/templates/${templateId}/publish`);
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published (${pubRes.status})`);

  // Step 2: Generate document via render/now
  const renderRes = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-pdfa-137',
    channel: 'email',
    inputs: [{ title: 'PDF/A Test Invoice', amount: 'R 15,000.00' }],
  });
  assert(renderRes.status === 200 || renderRes.status === 201, `Render completed (${renderRes.status})`);
  assert(renderRes.body.document, 'Document record returned');
  assert(renderRes.body.document.status === 'done', `Status is done: ${renderRes.body.document.status}`);

  const docPath = renderRes.body.document.filePath;
  assert(typeof docPath === 'string' && docPath.length > 0, `File path returned: ${docPath}`);

  // Step 3: Validate the output has PDF/A-3b metadata
  const validateRes = await request('POST', '/api/pdfme/render/validate-pdfa', {
    documentPath: docPath,
  });
  assert(validateRes.status === 200 || validateRes.status === 201, `Validation endpoint returned OK (${validateRes.status})`);
  assert(validateRes.body.xmpPresent === true, `XMP metadata block present: ${validateRes.body.xmpPresent}`);
  assert(validateRes.body.method === 'basic' || validateRes.body.method === 'verapdf', `Validation method: ${validateRes.body.method}`);

  // Step 4: Check that PDF/A conversion was applied (via validation details)
  if (validateRes.body.details) {
    assert(validateRes.body.details.hasOutputIntents === true, `OutputIntents present: ${validateRes.body.details.hasOutputIntents}`);
    assert(typeof validateRes.body.details.pageCount === 'number', `Page count reported: ${validateRes.body.details.pageCount}`);
  }

  console.log(`\n  Template ID: ${templateId}`);
  console.log(`  Document path: ${docPath}`);

  return templateId;
}

async function testFeature138(templateId) {
  console.log('\n=== Feature #138: PDF/A validation via veraPDF ===\n');

  // Step 1: Generate a fresh document
  const renderRes = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-verapdf-138',
    channel: 'print',
    inputs: [{ title: 'veraPDF Validation Test', amount: 'R 25,000.00' }],
  });
  assert(renderRes.status === 200 || renderRes.status === 201, `Render completed (${renderRes.status})`);
  const docPath = renderRes.body.document.filePath;

  // Step 2: Run validation on output
  const validateRes = await request('POST', '/api/pdfme/render/validate-pdfa', {
    documentPath: docPath,
  });
  assert(validateRes.status === 200 || validateRes.status === 201, `Validation returned OK (${validateRes.status})`);

  // Step 3: Verify validation passes (basic check)
  assert(validateRes.body.valid === true, `Validation passes: ${validateRes.body.valid}`);

  // Step 4: Verify all fonts embedded check
  assert(validateRes.body.fontsEmbedded === true, `Fonts embedded: ${validateRes.body.fontsEmbedded}`);

  // Step 5: Verify no system font references
  assert(validateRes.body.noSystemFontRefs === true, `No system font refs: ${validateRes.body.noSystemFontRefs}`);

  // Step 6: Verify XMP present
  assert(validateRes.body.xmpPresent === true, `XMP metadata present: ${validateRes.body.xmpPresent}`);

  console.log(`\n  Validation method: ${validateRes.body.method}`);
  console.log(`  Errors: ${JSON.stringify(validateRes.body.errors)}`);
}

async function testFeature139() {
  console.log('\n=== Feature #139: Template import validates and creates draft ===\n');

  // Create a valid TTF font header (first 12 bytes of a TTF)
  // TTF magic: 00 01 00 00 (+ numTables + more header bytes)
  const fakeTtfHeader = Buffer.alloc(64);
  fakeTtfHeader[0] = 0x00; fakeTtfHeader[1] = 0x01; fakeTtfHeader[2] = 0x00; fakeTtfHeader[3] = 0x00;
  // numTables=1 (big endian)
  fakeTtfHeader[4] = 0x00; fakeTtfHeader[5] = 0x01;
  const validFontBase64 = fakeTtfHeader.toString('base64');

  // Invalid font (random bytes, not a real font format)
  const invalidFontBase64 = Buffer.from('not-a-real-font-file-data').toString('base64');

  // Valid PNG header
  const fakePngHeader = Buffer.alloc(16);
  fakePngHeader[0] = 0x89; fakePngHeader[1] = 0x50; fakePngHeader[2] = 0x4E; fakePngHeader[3] = 0x47;
  fakePngHeader[4] = 0x0D; fakePngHeader[5] = 0x0A; fakePngHeader[6] = 0x1A; fakePngHeader[7] = 0x0A;
  const validImageBase64 = fakePngHeader.toString('base64');

  // Step 1: Create a TemplateExportPackage JSON with embedded fonts/images
  const exportPackage = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      type: 'invoice',
      name: 'Imported Invoice Template TEST_139',
      schema: {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        schemas: [[
          { name: 'header', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'Invoice' },
          { name: 'total', type: 'text', position: { x: 20, y: 50 }, width: 100, height: 10, content: '0.00' },
        ]],
      },
      status: 'published',
      version: 3,
    },
    assets: {
      images: [
        { path: 'org-other/assets/logo.png', mimeType: 'image/png', data: validImageBase64 },
      ],
      fonts: [
        { path: 'org-other/fonts/custom-font.ttf', mimeType: 'font/ttf', data: validFontBase64 },
        { path: 'org-other/fonts/bad-font.ttf', mimeType: 'font/ttf', data: invalidFontBase64 },
      ],
    },
  };

  // Step 2: POST /api/pdfme/templates/import
  const importRes = await request('POST', '/api/pdfme/templates/import', exportPackage);
  assert(importRes.status === 201, `Import returned 201 (${importRes.status})`);

  // Step 3: Verify new draft template created
  assert(importRes.body.id, `Template ID returned: ${importRes.body.id}`);
  assert(importRes.body.status === 'draft', `Status is draft: ${importRes.body.status}`);
  assert(importRes.body.name === 'Imported Invoice Template TEST_139', `Name matches: ${importRes.body.name}`);
  assert(importRes.body.type === 'invoice', `Type matches: ${importRes.body.type}`);
  assert(importRes.body.version === 1, `Version reset to 1: ${importRes.body.version}`);

  // Step 4: Verify embedded assets extracted and stored
  if (importRes.body.assetsExtracted) {
    assert(importRes.body.assetsExtracted.images === 1, `Images extracted: ${importRes.body.assetsExtracted.images}`);
    assert(importRes.body.assetsExtracted.fonts >= 1, `Valid fonts extracted: ${importRes.body.assetsExtracted.fonts}`);
  } else {
    assert(false, 'assetsExtracted field missing from response');
  }

  // Step 5: Verify font validation applied
  if (importRes.body.fontValidation) {
    assert(importRes.body.fontValidation.total === 2, `Total fonts: ${importRes.body.fontValidation.total}`);
    assert(importRes.body.fontValidation.valid >= 1, `Valid fonts: ${importRes.body.fontValidation.valid}`);
    assert(importRes.body.fontValidation.invalid >= 1, `Invalid fonts caught: ${importRes.body.fontValidation.invalid}`);
    assert(importRes.body.fontValidation.errors.length > 0, `Font validation errors reported: ${importRes.body.fontValidation.errors.join('; ')}`);
  } else {
    assert(false, 'fontValidation field missing from response');
  }

  // Verify the imported template is accessible
  const getRes = await request('GET', `/api/pdfme/templates/${importRes.body.id}`);
  assert(getRes.status === 200, `Imported template accessible via GET`);
  assert(getRes.body.status === 'draft', `Persisted as draft`);

  // Test invalid package format
  const badImport = await request('POST', '/api/pdfme/templates/import', { version: 1 });
  assert(badImport.status === 400, `Invalid package rejected with 400 (${badImport.status})`);

  // Clean up: verify and delete test template
  const cleanupRes = await request('DELETE', `/api/pdfme/templates/${importRes.body.id}`);
  console.log(`  Cleanup: ${cleanupRes.status}`);
}

async function main() {
  console.log('Starting tests for features #137, #138, #139...\n');

  try {
    const templateId = await testFeature137();
    await testFeature138(templateId);
    await testFeature139();
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
