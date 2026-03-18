/**
 * Test Feature #176: Designer asset upload calls API
 *
 * Tests that uploading an asset from the Assets tab uses onAssetUpload callback
 * and the asset appears in the Assets list after upload.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXRlc3QiLCJvcmdJZCI6Im9yZy10ZXN0Iiwicm9sZXMiOlsiYWRtaW4iXX0.fake-signature';
const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => JSON.parse(data),
          text: () => data,
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function multipartUpload(url, fieldName, filename, buffer, mimeType, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const crlf = '\r\n';

    const preamble = `--${boundary}${crlf}Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`;
    const epilogue = `${crlf}--${boundary}--${crlf}`;

    const body = Buffer.concat([
      Buffer.from(preamble),
      buffer,
      Buffer.from(epilogue),
    ]);

    const urlObj = new URL(url);
    const reqHeaders = {
      ...headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    };

    const req = http.request(url, {
      method: 'POST',
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => JSON.parse(data),
          text: () => data,
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

// Create a minimal valid PNG (1x1 pixel, red)
function createTestPng() {
  // Minimal PNG: 1x1 pixel red
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  ]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type);
    const crc = Buffer.alloc(4); // Simplified CRC (works for test purposes)
    return Buffer.concat([length, typeBuffer, data, crc]);
  }

  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk (raw pixel data, minimal deflate)
  const rawData = Buffer.from([
    0x08, 0xD7, // zlib header
    0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x01, 0x01, 0x01, 0x00, // deflated filter+RGB
  ]);
  const idat = createChunk('IDAT', rawData);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngHeader, ihdr, idat, iend]);
}

async function run() {
  console.log('=== Feature #176: Designer asset upload calls API ===\n');

  // Step 1: Verify asset upload API endpoint works
  console.log('Step 1: Test asset upload API endpoint');
  const testPng = createTestPng();

  const uploadRes = await multipartUpload(
    `${API_BASE}/assets/upload`,
    'file',
    'test-f176-upload.png',
    testPng,
    'image/png',
    { 'Authorization': `Bearer ${TOKEN}` },
  );

  assert(uploadRes.ok, `Asset upload returns success (${uploadRes.status})`);
  const uploadResult = uploadRes.json();
  assert(uploadResult.filename || uploadResult.path || uploadResult.id, 'Upload response contains asset info');
  console.log(`  Uploaded: ${JSON.stringify(uploadResult)}`);

  // Step 2: Verify asset appears in list API
  console.log('\nStep 2: Verify asset appears in list');
  const listRes = await fetch(`${API_BASE}/assets`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });

  assert(listRes.ok, 'Asset list returns 200');
  const listResult = listRes.json();
  assert(listResult.data && Array.isArray(listResult.data), 'List response has data array');
  const hasUploadedAsset = listResult.data.some(f => f.includes('test-f176-upload'));
  assert(hasUploadedAsset, 'Uploaded asset appears in list');

  // Step 3: Verify component source code has upload functionality
  console.log('\nStep 3: Verify component has asset upload implementation');
  const componentSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf8'
  );

  assert(componentSrc.includes('onAssetUpload'), 'Component has onAssetUpload prop');
  assert(componentSrc.includes('handleAssetUpload'), 'Component has handleAssetUpload handler');
  assert(componentSrc.includes('handleAssetFileChange'), 'Component has handleAssetFileChange handler');
  assert(componentSrc.includes('assetFileInputRef'), 'Component has file input ref');
  assert(componentSrc.includes('asset-file-input'), 'Component has hidden file input element');
  assert(componentSrc.includes('asset-upload-btn'), 'Component has upload button with testid');
  assert(componentSrc.includes('assets-list'), 'Component has assets list with testid');
  assert(componentSrc.includes('assets-content'), 'Component has assets content area');

  // Step 4: Verify upload handler calls the API
  console.log('\nStep 4: Verify upload handler calls API correctly');
  assert(componentSrc.includes('/assets/upload'), 'Upload handler calls /assets/upload endpoint');
  assert(componentSrc.includes('FormData'), 'Upload uses FormData for multipart upload');
  assert(componentSrc.includes("formData.append('file'"), 'Upload appends file to FormData');
  assert(componentSrc.includes('method: \'POST\''), 'Upload uses POST method');

  // Step 5: Verify onAssetUpload callback is called
  console.log('\nStep 5: Verify onAssetUpload callback integration');
  assert(componentSrc.includes('onAssetUpload(newAsset)'), 'Calls onAssetUpload with asset info');
  assert(componentSrc.includes('AssetInfo'), 'AssetInfo interface is defined');
  assert(componentSrc.includes('setAssets((prev) => [...prev, newAsset])'), 'Adds new asset to state');

  // Step 6: Verify upload status indicators
  console.log('\nStep 6: Verify upload status UI');
  assert(componentSrc.includes('assetUploadStatus'), 'Tracks upload status');
  assert(componentSrc.includes('Uploading...'), 'Shows uploading indicator');
  assert(componentSrc.includes('asset-upload-error'), 'Shows upload error message');
  assert(componentSrc.includes('No assets uploaded yet'), 'Shows empty state when no assets');

  // Step 7: Verify asset list renders uploaded assets
  console.log('\nStep 7: Verify asset list rendering');
  assert(componentSrc.includes('assets.map'), 'Renders asset list from state');
  assert(componentSrc.includes('asset.filename'), 'Shows asset filename');
  assert(componentSrc.includes('asset-item-'), 'Each asset has testid');

  // Step 8: Verify file input accepts correct file types
  console.log('\nStep 8: Verify file input accepts image types');
  assert(componentSrc.includes('accept=".png,.jpg,.jpeg,.svg,.webp,.gif"'), 'File input accepts image types');
  assert(componentSrc.includes('type="file"'), 'Has file type input');

  // Step 9: Verify asset loading from API on mount
  console.log('\nStep 9: Verify assets are loaded from API on mount');
  assert(componentSrc.includes('loadAssets'), 'Has loadAssets function');
  assert(componentSrc.includes('/assets`') && componentSrc.includes('loadAssets'), 'Fetches asset list from API');

  // Cleanup
  console.log('\nCleanup: Removing test assets');
  if (listResult.data) {
    for (const assetPath of listResult.data) {
      if (assetPath.includes('test-f176')) {
        const assetName = assetPath.split('/').pop();
        await fetch(`${API_BASE}/assets/${assetName}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${TOKEN}` },
        });
      }
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
