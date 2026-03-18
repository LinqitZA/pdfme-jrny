/**
 * Feature #88: Asset download streams binary
 * GET asset returns file binary with correct Content-Type
 */

const crypto = require('crypto');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('dl-user-88', 'org-dl-88', ['template:read', 'template:write']);
const TOKEN_OTHER = makeToken('dl-user-88b', 'org-dl-88b', ['template:read', 'template:write']);

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

// Minimal 1x1 PNG
function createPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
}

// Minimal SVG
function createSvg() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="red" width="1" height="1"/></svg>');
}

async function uploadAsset(token, name, buf, contentType) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + contentType + '\r\n\r\n'),
    buf,
    Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);
  const res = await fetch(BASE + '/api/pdfme/assets/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Authorization': 'Bearer ' + token,
    },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function run() {
  console.log('Feature #88: Asset download streams binary');
  console.log('='.repeat(50));

  // Upload a PNG asset
  console.log('\n--- Setup: Upload assets ---');
  const pngBuf = createPng();
  const pngUpload = await uploadAsset(TOKEN, 'download-test-88.png', pngBuf, 'image/png');
  assert(pngUpload.status === 201, 'PNG upload returns 201 (got ' + pngUpload.status + ')');
  const pngId = pngUpload.json.id;

  // Upload an SVG asset
  const svgBuf = createSvg();
  const svgUpload = await uploadAsset(TOKEN, 'download-test-88.svg', svgBuf, 'image/svg+xml');
  assert(svgUpload.status === 201, 'SVG upload returns 201 (got ' + svgUpload.status + ')');
  const svgId = svgUpload.json.id;

  // Test 1: GET asset by ID returns binary data
  console.log('\n--- Test: Download PNG asset ---');
  const dlRes = await fetch(BASE + '/api/pdfme/assets/' + pngId, {
    headers: { 'Authorization': 'Bearer ' + TOKEN },
  });
  assert(dlRes.status === 200, 'Download returns 200 (got ' + dlRes.status + ')');

  // Test 2: Correct Content-Type for PNG
  const contentType = dlRes.headers.get('content-type');
  assert(contentType === 'image/png', 'Content-Type is image/png (got ' + contentType + ')');

  // Test 3: Content-Length header present
  const contentLength = dlRes.headers.get('content-length');
  assert(contentLength, 'Content-Length header present');
  assert(parseInt(contentLength) > 0, 'Content-Length > 0 (got ' + contentLength + ')');

  // Test 4: Binary data matches uploaded content
  const dlBuffer = Buffer.from(await dlRes.arrayBuffer());
  assert(dlBuffer.length === pngBuf.length, 'Downloaded size matches uploaded (' + dlBuffer.length + ' vs ' + pngBuf.length + ')');
  assert(dlBuffer.equals(pngBuf), 'Downloaded binary matches uploaded content');

  // Test 5: PNG magic bytes present
  assert(dlBuffer[0] === 0x89 && dlBuffer[1] === 0x50 && dlBuffer[2] === 0x4E && dlBuffer[3] === 0x47, 'PNG magic bytes present');

  // Test 6: Download SVG asset with correct content type
  console.log('\n--- Test: Download SVG asset ---');
  const svgDlRes = await fetch(BASE + '/api/pdfme/assets/' + svgId, {
    headers: { 'Authorization': 'Bearer ' + TOKEN },
  });
  assert(svgDlRes.status === 200, 'SVG download returns 200 (got ' + svgDlRes.status + ')');
  const svgContentType = svgDlRes.headers.get('content-type');
  assert(svgContentType === 'image/svg+xml', 'SVG Content-Type is image/svg+xml (got ' + svgContentType + ')');

  const svgDownloaded = Buffer.from(await svgDlRes.arrayBuffer());
  assert(svgDownloaded.toString().includes('<svg'), 'SVG content contains <svg tag');

  // Test 7: Non-existent asset returns 404
  console.log('\n--- Test: Non-existent asset ---');
  const notFound = await fetch(BASE + '/api/pdfme/assets/nonexistent-asset-id-12345', {
    headers: { 'Authorization': 'Bearer ' + TOKEN },
  });
  assert(notFound.status === 404, 'Non-existent asset returns 404 (got ' + notFound.status + ')');

  // Test 8: Different org cannot download asset
  console.log('\n--- Test: Tenant isolation ---');
  const otherOrgRes = await fetch(BASE + '/api/pdfme/assets/' + pngId, {
    headers: { 'Authorization': 'Bearer ' + TOKEN_OTHER },
  });
  assert(otherOrgRes.status === 404, 'Other org gets 404 (got ' + otherOrgRes.status + ')');

  // Cleanup
  console.log('\n--- Cleanup ---');
  await fetch(BASE + '/api/pdfme/assets/' + pngId + '?confirm=true', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + TOKEN },
  });
  await fetch(BASE + '/api/pdfme/assets/' + svgId + '?confirm=true', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + TOKEN },
  });

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
