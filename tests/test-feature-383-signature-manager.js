/**
 * Feature #383: Signature manager HTML5 canvas drawing
 *
 * Tests SignatureManager component and backend signature API.
 * Verifies: Canvas drawing, clear button, submit saves SVG/PNG.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-sig-383';
const USER_ID = 'sig-test-user';

function makeJwt(userId, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID, orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeJwt();

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Authorization': `Bearer ${token || TOKEN}`, 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let parsed;
        try { parsed = JSON.parse(raw.toString()); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

function createMinimalPng() {
  // 1x1 white pixel PNG
  const pngData = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
  return pngData;
}

function createMinimalSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200" viewBox="0 0 500 200"><rect width="500" height="200" fill="#ffffff"/><path d="M 50.0 100.0 L 100.0 80.0 L 150.0 120.0 L 200.0 90.0 L 250.0 110.0" stroke="#000000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

async function run() {
  console.log('=== Feature #383: Signature manager HTML5 canvas drawing ===\n');

  // --- Step 1: Verify SignatureManager component exists ---
  console.log('--- Step 1: Verify SignatureManager component exists ---');
  const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'SignatureManager.tsx');
  const componentExists = fs.existsSync(componentPath);
  assert(componentExists, 'SignatureManager.tsx component exists');

  if (componentExists) {
    const content = fs.readFileSync(componentPath, 'utf8');
    assert(content.includes('canvas'), 'Component uses HTML5 canvas element');
    assert(content.includes('onMouseDown') || content.includes('startDrawing'), 'Component handles mouse down events');
    assert(content.includes('onMouseMove') || content.includes('draw'), 'Component handles mouse move (drawing)');
    assert(content.includes('onMouseUp') || content.includes('stopDrawing'), 'Component handles mouse up (stop drawing)');
    assert(content.includes('onTouchStart') || content.includes('touch'), 'Component supports touch events');
    assert(content.includes('clearCanvas') || content.includes('clear'), 'Component has clear functionality');
    assert(content.includes('toDataURL') || content.includes('exportAsPng'), 'Component exports canvas as PNG');
    assert(content.includes('svg') || content.includes('SVG'), 'Component supports SVG export');
    assert(content.includes('data-testid="signature-canvas"'), 'Canvas has testid for automation');
    assert(content.includes('data-testid="signature-clear"'), 'Clear button has testid');
    assert(content.includes('data-testid="signature-save-png"'), 'Save PNG button has testid');
    assert(content.includes('data-testid="signature-save-svg"'), 'Save SVG button has testid');
    assert(content.includes('strokesRef') || content.includes('strokes'), 'Component tracks stroke data');
    assert(content.includes('isDrawing'), 'Component tracks drawing state');
    assert(content.includes('hasDrawn'), 'Component tracks if user has drawn');
    assert(content.includes('/signatures'), 'Component calls signatures API endpoint');
  }

  // --- Step 2: Verify signatures page route exists ---
  console.log('\n--- Step 2: Verify signature page route ---');
  const pagePath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'signatures', 'page.tsx');
  const pageExists = fs.existsSync(pagePath);
  assert(pageExists, 'Signatures page route exists');

  if (pageExists) {
    const pageContent = fs.readFileSync(pagePath, 'utf8');
    assert(pageContent.includes('SignatureManager'), 'Page imports SignatureManager component');
  }

  // --- Step 3: Upload PNG signature via API ---
  console.log('\n--- Step 3: Upload PNG signature via API ---');
  const pngData = createMinimalPng();
  const pngBase64 = 'data:image/png;base64,' + pngData.toString('base64');

  const uploadPng = await request('POST', '/api/pdfme/signatures', { data: pngBase64, orgId: ORG_ID });
  assert(uploadPng.status === 201, `PNG upload succeeded (${uploadPng.status})`);
  assert(uploadPng.body.id, 'Upload returned signature ID');
  assert(uploadPng.body.userId === USER_ID, `Upload tied to correct user (${uploadPng.body.userId})`);
  assert(uploadPng.body.orgId === ORG_ID, `Upload tied to correct org (${uploadPng.body.orgId})`);
  assert(uploadPng.body.filePath && uploadPng.body.filePath.includes('.png'), 'File path is PNG');
  assert(uploadPng.body.capturedAt, 'Capture timestamp present');

  // --- Step 4: Upload SVG signature via API ---
  console.log('\n--- Step 4: Upload SVG signature via API ---');
  const svgData = createMinimalSvg();
  const svgBase64 = 'data:image/svg+xml;base64,' + Buffer.from(svgData).toString('base64');

  const uploadSvg = await request('POST', '/api/pdfme/signatures', { data: svgBase64, orgId: ORG_ID });
  assert(uploadSvg.status === 201, `SVG upload succeeded (${uploadSvg.status})`);
  assert(uploadSvg.body.id, 'SVG upload returned signature ID');

  // --- Step 5: Retrieve current signature ---
  console.log('\n--- Step 5: Retrieve current signature ---');
  const getMine = await request('GET', '/api/pdfme/signatures/me');
  assert(getMine.status === 200, `Get my signature succeeded (${getMine.status})`);
  assert(getMine.body.id, 'Retrieved signature has ID');
  assert(getMine.body.userId === USER_ID, 'Retrieved signature matches user');

  // --- Step 6: Download signature file ---
  console.log('\n--- Step 6: Download signature file ---');
  const dlFile = await request('GET', '/api/pdfme/signatures/me/file');
  assert(dlFile.status === 200, `File download succeeded (${dlFile.status})`);
  const ct = dlFile.headers['content-type'] || '';
  assert(ct.includes('image') || ct.includes('png'), `Content-Type is image (${ct})`);
  const contentLen = parseInt(dlFile.headers['content-length'] || '0', 10);
  assert(contentLen > 0, `File has content (${contentLen} bytes)`);

  // --- Step 7: Verify clear/replace behavior ---
  console.log('\n--- Step 7: Clear and replace signature ---');
  const newPng = 'data:image/png;base64,' + pngData.toString('base64');
  const uploadReplace = await request('POST', '/api/pdfme/signatures', { data: newPng, orgId: ORG_ID });
  assert(uploadReplace.status === 201, `Replacement upload succeeded (${uploadReplace.status})`);
  assert(uploadReplace.body.id !== uploadSvg.body.id, 'Replacement has new ID (old replaced)');

  // Verify only one active signature per user
  const getMine2 = await request('GET', '/api/pdfme/signatures/me');
  assert(getMine2.status === 200, 'Get after replace succeeded');
  assert(getMine2.body.id === uploadReplace.body.id, 'Active signature is the latest one');

  // --- Step 8: Revoke signature ---
  console.log('\n--- Step 8: Revoke signature ---');
  const revoke = await request('DELETE', '/api/pdfme/signatures/me');
  assert(revoke.status === 200, `Revoke succeeded (${revoke.status})`);

  // After revocation, getting signature should return 404
  const getMine3 = await request('GET', '/api/pdfme/signatures/me');
  assert(getMine3.status === 404, `No active signature after revoke (${getMine3.status})`);

  // --- Step 9: Re-upload after revocation ---
  console.log('\n--- Step 9: Re-upload after revocation ---');
  const reUpload = await request('POST', '/api/pdfme/signatures', { data: pngBase64, orgId: ORG_ID });
  assert(reUpload.status === 201, `Re-upload after revoke succeeded (${reUpload.status})`);

  const getMine4 = await request('GET', '/api/pdfme/signatures/me');
  assert(getMine4.status === 200, 'Get after re-upload succeeded');
  assert(getMine4.body.id === reUpload.body.id, 'New signature is active');

  // --- Step 10: Validation - empty data rejected ---
  console.log('\n--- Step 10: Validation tests ---');
  const emptyUpload = await request('POST', '/api/pdfme/signatures', { data: '', orgId: ORG_ID });
  assert(emptyUpload.status === 400, `Empty data rejected (${emptyUpload.status})`);

  const noDataUpload = await request('POST', '/api/pdfme/signatures', { orgId: ORG_ID });
  assert(noDataUpload.status === 400, `Missing data rejected (${noDataUpload.status})`);

  // --- Step 11: Auth required ---
  console.log('\n--- Step 11: Auth validation ---');
  const noAuth = await request('POST', '/api/pdfme/signatures', { data: pngBase64 }, 'invalid-token');
  assert(noAuth.status === 401 || noAuth.status === 403, `Invalid auth rejected (${noAuth.status})`);

  // --- Step 12: Multi-user isolation ---
  console.log('\n--- Step 12: Multi-user signature isolation ---');
  const user2Token = makeJwt('sig-user-2', ORG_ID);
  const user2Upload = await request('POST', '/api/pdfme/signatures', { data: pngBase64, orgId: ORG_ID }, user2Token);
  assert(user2Upload.status === 201, `User 2 upload succeeded (${user2Upload.status})`);
  assert(user2Upload.body.userId === 'sig-user-2', 'User 2 signature tied to correct user');

  // User 1 signature still exists
  const user1Sig = await request('GET', '/api/pdfme/signatures/me');
  assert(user1Sig.status === 200, 'User 1 still has their signature');
  assert(user1Sig.body.userId === USER_ID, 'User 1 signature unchanged');

  // User 2 has their own signature
  const user2Sig = await request('GET', '/api/pdfme/signatures/me', null, user2Token);
  assert(user2Sig.status === 200, 'User 2 has their own signature');
  assert(user2Sig.body.userId === 'sig-user-2', 'User 2 signature is isolated');

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
