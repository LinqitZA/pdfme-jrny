/**
 * Feature #410: Upgrade pdfjs-dist to fix arbitrary JavaScript execution vulnerability
 * Tests that pdfjs-dist has been upgraded to 5.x and PDF functionality still works
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const secret = 'pdfme-dev-secret';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-test-410';
const USER_ID = 'user-test-410';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view']
});

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${message}`);
  } else {
    failed++;
    results.push(`  ❌ ${message}`);
  }
}

async function run() {
  console.log('=== Feature #410: Upgrade pdfjs-dist to fix JS execution vulnerability ===\n');

  // --- Step 1: Verify pdfjs-dist version in package.json ---
  console.log('--- Step 1: Verify pdfjs-dist version in package.json ---');
  const pkgPath = path.join(__dirname, '..', 'packages', 'converter', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pdfjsVersion = pkg.dependencies['pdfjs-dist'];

  assert(pdfjsVersion !== '^3.11.174', 'pdfjs-dist is no longer at vulnerable version 3.x');
  assert(pdfjsVersion.startsWith('^5.'), `pdfjs-dist version range is 5.x (${pdfjsVersion})`);

  // --- Step 2: Verify installed version ---
  console.log('--- Step 2: Verify installed pdfjs-dist version ---');
  const installedPkgPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'package.json');
  const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
  const installedVersion = installedPkg.version;

  assert(installedVersion.startsWith('5.'), `Installed pdfjs-dist is 5.x (${installedVersion})`);
  assert(!installedVersion.startsWith('3.'), 'Installed version is NOT vulnerable 3.x');
  assert(!installedVersion.startsWith('4.'), 'Installed version is NOT vulnerable 4.x (<=4.1.392)');

  const majorVer = parseInt(installedVersion.split('.')[0], 10);
  assert(majorVer >= 5, `Major version >= 5 (got ${majorVer})`);

  // --- Step 3: Verify breaking API changes handled ---
  console.log('--- Step 3: Verify breaking API changes handled in source ---');
  const nodeEntryPath = path.join(__dirname, '..', 'packages', 'converter', 'src', 'index.node.ts');
  const nodeEntry = fs.readFileSync(nodeEntryPath, 'utf8');

  assert(nodeEntry.includes('pdf.mjs'), 'Node entry uses .mjs import (pdfjs-dist 5.x format)');
  assert(!nodeEntry.includes('pdf.worker.js'), 'Node entry does not import old .js worker');
  assert(!nodeEntry.includes("pdf.worker.js'"), 'No legacy pdf.worker.js import path');

  const browserEntryPath = path.join(__dirname, '..', 'packages', 'converter', 'src', 'index.browser.ts');
  const browserEntry = fs.readFileSync(browserEntryPath, 'utf8');

  assert(!browserEntry.includes('pdf.worker.entry.js'), 'Browser entry does not use removed pdf.worker.entry.js');
  assert(browserEntry.includes('GlobalWorkerOptions'), 'Browser entry configures GlobalWorkerOptions');

  // --- Step 4: Verify pdf2img.ts updated for RenderParameters ---
  console.log('--- Step 4: Verify pdf2img.ts updated for RenderParameters ---');
  const pdf2imgPath = path.join(__dirname, '..', 'packages', 'converter', 'src', 'pdf2img.ts');
  const pdf2img = fs.readFileSync(pdf2imgPath, 'utf8');

  assert(pdf2img.includes('canvas:'), 'pdf2img passes canvas property in render() call (5.x requirement)');
  assert(pdf2img.includes('PDFDocumentProxy'), 'pdf2img still uses PDFDocumentProxy type');

  // --- Step 5: Verify converter builds successfully ---
  console.log('--- Step 5: Verify converter dist exists (built successfully) ---');
  const distCjsPath = path.join(__dirname, '..', 'packages', 'converter', 'dist', 'cjs', 'src', 'index.node.js');
  const distEsmPath = path.join(__dirname, '..', 'packages', 'converter', 'dist', 'esm', 'src', 'index.node.js');

  assert(fs.existsSync(distCjsPath), 'CJS dist build exists');
  assert(fs.existsSync(distEsmPath), 'ESM dist build exists');

  // Verify built files reflect the upgrade
  const builtCjs = fs.readFileSync(distCjsPath, 'utf8');
  assert(builtCjs.includes('pdf.mjs'), 'Built CJS file uses .mjs import path');

  // --- Step 6: Verify 5.x file structure exists ---
  console.log('--- Step 6: Verify pdfjs-dist 5.x file structure ---');
  const legacyMjsPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  const mainMjsPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs');
  const workerMjsPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs');
  const typesPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'types', 'src', 'pdf.d.ts');

  assert(fs.existsSync(legacyMjsPath), 'pdfjs-dist 5.x has legacy/build/pdf.mjs');
  assert(fs.existsSync(mainMjsPath), 'pdfjs-dist 5.x has build/pdf.mjs');
  assert(fs.existsSync(workerMjsPath), 'pdfjs-dist 5.x has build/pdf.worker.mjs');
  assert(fs.existsSync(typesPath), 'pdfjs-dist 5.x has types/src/pdf.d.ts');

  // --- Step 7: Verify PDF rendering still works end-to-end ---
  console.log('--- Step 7: Verify PDF rendering still works end-to-end ---');

  // Create a template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'PDFJS_UPGRADE_TEST_410',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'title',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Test PDF'
          }]
        }]
      }
    })
  });
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  const template = await createRes.json();
  const templateId = template.id;

  // Publish template
  const pubRes = await fetch(`${BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers
  });
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published (${pubRes.status})`);

  // Render PDF
  const renderRes = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'test-410-entity',
      channel: 'email',
      inputs: [{ title: 'Rendered after pdfjs-dist 5.x upgrade' }]
    })
  });
  assert(renderRes.status === 200 || renderRes.status === 201, `PDF rendered successfully (${renderRes.status})`);

  const renderData = await renderRes.json();
  const docId = renderData.document?.id || renderData.documentId || renderData.id;
  assert(!!docId, 'Render returned a document ID');

  // Download the PDF
  const dlRes = await fetch(`${BASE}/render/document/${docId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(dlRes.status === 200, `PDF download returns 200 (${dlRes.status})`);

  const contentType = dlRes.headers.get('content-type');
  assert(contentType && contentType.includes('pdf'), `Content-Type is PDF (${contentType})`);

  const pdfBuffer = Buffer.from(await dlRes.arrayBuffer());
  assert(pdfBuffer.length > 100, `PDF has content (${pdfBuffer.length} bytes)`);

  const pdfHeader = pdfBuffer.slice(0, 5).toString();
  assert(pdfHeader === '%PDF-', `Valid PDF header (${pdfHeader})`);

  // --- Step 8: Verify GHSA-wgrm-67xf-hhpq vulnerability is resolved ---
  console.log('--- Step 8: Verify vulnerability GHSA-wgrm-67xf-hhpq is resolved ---');
  // The vulnerability affects pdfjs-dist <=4.1.392
  // Our installed version is 5.x which is above the vulnerable range
  const [major, minor, patch] = installedVersion.split('.').map(Number);
  assert(major > 4 || (major === 4 && minor > 1) || (major === 4 && minor === 1 && patch > 392),
    `Version ${installedVersion} is above vulnerable range (<=4.1.392)`);

  // --- Cleanup ---
  console.log('\n--- Cleanup ---');
  if (templateId) {
    await fetch(`${BASE}/templates/${templateId}`, {
      method: 'DELETE',
      headers
    });
  }
  console.log('  Cleaned up test template');

  // --- Print results ---
  console.log('');
  results.forEach(r => console.log(r));
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
