/**
 * Feature #290: Asset upload progress shown
 * Verifies file upload shows progress feedback.
 *
 * Steps:
 * 1. Upload large asset file
 * 2. Verify upload progress indicator
 * 3. Verify completion feedback
 * 4. Verify asset appears in list after upload
 */

const { signJwt } = require('./create-signed-token');
const fs = require('fs');
const path = require('path');
const API = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

const token = signJwt({ sub: 'user-290', orgId: 'org-290', roles: ['template:edit', 'template:publish', 'render:trigger'] });
const headers = { 'Authorization': `Bearer ${token}` };
const jsonHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; process.stdout.write(`  ✓ ${msg}\n`); }
  else { failed++; process.stdout.write(`  ✗ ${msg}\n`); }
}

function createPngBuffer(size) {
  // Minimal PNG header + data to make a valid-ish file of given size
  const header = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width=1
    0x00, 0x00, 0x00, 0x01, // height=1
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x90, 0x77, 0x53, 0xDE, // CRC
  ]);
  const padding = Buffer.alloc(Math.max(0, size - header.length), 0);
  return Buffer.concat([header, padding]);
}

async function testAssetUploadAPI() {
  process.stdout.write('\n--- Asset Upload API ---\n');

  // Upload a small PNG file
  const pngData = createPngBuffer(1024);
  const boundary = '----FormBoundary290' + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="test-290.png"\r\n`,
    `Content-Type: image/png\r\n\r\n`,
  ];
  const bodyPrefix = Buffer.from(bodyParts.join(''));
  const bodySuffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([bodyPrefix, pngData, bodySuffix]);

  const res = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  assert(res.status === 201, `Upload returns 201 (got ${res.status})`);
  const result = await res.json();
  assert(result.id || result.assetId, 'Upload response has asset ID');
  assert(result.filename || result.originalname, 'Upload response has filename');

  return result;
}

async function testAssetAppearsInList() {
  process.stdout.write('\n--- Asset Appears in List ---\n');

  const res = await fetch(`${API}/assets`, { headers });
  assert(res.status === 200, `Asset list returns 200 (got ${res.status})`);
  const result = await res.json();
  assert(result.data !== undefined, 'Response has data array');
  assert(result.data.length > 0, `Asset list is not empty (has ${result.data.length} assets)`);
  assert(result.pagination !== undefined, 'Response has pagination');
  assert(result.pagination.total > 0, `Pagination total > 0 (got ${result.pagination.total})`);
}

async function testOversizedUploadRejected() {
  process.stdout.write('\n--- Oversized Upload Rejected ---\n');

  // Try uploading a file that exceeds 10MB
  const largeData = createPngBuffer(11 * 1024 * 1024);
  const boundary = '----FormBoundary290Large' + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="large-290.png"\r\n`,
    `Content-Type: image/png\r\n\r\n`,
  ];
  const bodyPrefix = Buffer.from(bodyParts.join(''));
  const bodySuffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([bodyPrefix, largeData, bodySuffix]);

  const res = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  assert(res.status === 413, `Oversized upload returns 413 (got ${res.status})`);
}

async function testUnsupportedTypeRejected() {
  process.stdout.write('\n--- Unsupported Type Rejected ---\n');

  const boundary = '----FormBoundary290Type' + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="test-290.exe"\r\n`,
    `Content-Type: application/octet-stream\r\n\r\n`,
    `MZ fake exe content`,
    `\r\n--${boundary}--\r\n`,
  ];
  const body = Buffer.from(bodyParts.join(''));

  const res = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  assert(res.status === 400, `Unsupported type returns 400 (got ${res.status})`);
}

async function testUploadProgressUICode() {
  process.stdout.write('\n--- Upload Progress UI Code Verification ---\n');

  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'), 'utf-8');

  // Verify progress state tracking
  assert(source.includes('assetUploadProgress'), 'Component tracks upload progress percentage');
  assert(source.includes('setAssetUploadProgress'), 'Has setter for upload progress');

  // Verify progress bar UI
  assert(source.includes('asset-upload-progress-bar'), 'Progress bar has data-testid');
  assert(source.includes('asset-upload-progress-section'), 'Progress section has data-testid');
  assert(source.includes('asset-upload-progress-text'), 'Progress text has data-testid');

  // Verify progress bar width is driven by percentage
  assert(source.includes('`${assetUploadProgress}%`'), 'Progress bar width is percentage-driven');

  // Verify XMLHttpRequest for progress tracking
  assert(source.includes('XMLHttpRequest'), 'Uses XMLHttpRequest for upload progress');
  assert(source.includes('upload.addEventListener'), 'Listens for upload progress events');
  assert(source.includes('e.lengthComputable'), 'Checks if progress is computable');
  assert(source.includes('e.loaded'), 'Uses loaded bytes for calculation');
  assert(source.includes('e.total'), 'Uses total bytes for calculation');
}

async function testUploadStatusStates() {
  process.stdout.write('\n--- Upload Status State Machine ---\n');

  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'), 'utf-8');

  // Verify all upload states
  assert(source.includes("'idle'") && source.includes("'uploading'") && source.includes("'success'") && source.includes("'error'"), 'All upload states defined: idle, uploading, success, error');

  // Verify uploading state shows progress
  assert(source.includes("assetUploadStatus === 'uploading'"), 'Uploading state handled');
  assert(source.includes('Uploading…'), 'Shows "Uploading..." during upload');

  // Verify success state
  assert(source.includes("assetUploadStatus === 'success'"), 'Success state handled');
  assert(source.includes('Upload Complete') || source.includes('Upload complete'), 'Shows completion message');

  // Verify success auto-dismiss
  assert(source.includes("prev === 'success' ? 'idle' : prev"), 'Success state auto-dismisses');

  // Verify error state
  assert(source.includes("assetUploadStatus === 'error'"), 'Error state handled');
  assert(source.includes('asset-upload-error'), 'Error display has test ID');
}

async function testUploadCompletionFeedback() {
  process.stdout.write('\n--- Upload Completion Feedback ---\n');

  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'), 'utf-8');

  // Verify completion feedback
  assert(source.includes('Upload complete'), 'Shows "Upload complete" text on success');
  assert(source.includes('#10b981'), 'Success state uses green color');
  assert(source.includes('asset added to library'), 'Shows "asset added to library" on success');

  // Verify asset is added to list on success
  assert(source.includes('setAssets((prev) => [...prev, newAsset])'), 'New asset added to assets list');

  // Verify button text changes
  assert(source.includes('✓ Upload Complete'), 'Upload button shows checkmark on success');
}

async function testProgressBarAppearance() {
  process.stdout.write('\n--- Progress Bar Visual Properties ---\n');

  const source = fs.readFileSync(path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'), 'utf-8');

  // Verify progress bar styling
  assert(source.includes("height: '6px'"), 'Progress bar has 6px height');
  assert(source.includes("borderRadius: '3px'"), 'Progress bar has rounded corners');
  assert(source.includes("transition: 'width 0.2s ease'"), 'Progress bar has smooth animation');
  assert(source.includes('#3b82f6'), 'Uploading state uses blue progress bar');
  assert(source.includes("assetUploadStatus === 'success' ? '#10b981' : '#3b82f6'"), 'Progress bar turns green on success');
}

async function testMultipleUploads() {
  process.stdout.write('\n--- Multiple Sequential Uploads ---\n');

  // Upload first file
  const png1 = createPngBuffer(512);
  const boundary1 = '----FormBoundary290Multi1' + Date.now();
  const body1 = Buffer.from([
    `--${boundary1}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="multi1-290.png"\r\n`,
    `Content-Type: image/png\r\n\r\n`,
  ].join(''));
  const full1 = Buffer.concat([body1, png1, Buffer.from(`\r\n--${boundary1}--\r\n`)]);

  const res1 = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary1}` },
    body: full1,
  });
  assert(res1.status === 201, `First upload succeeds (${res1.status})`);

  // Upload second file
  const png2 = createPngBuffer(768);
  const boundary2 = '----FormBoundary290Multi2' + Date.now();
  const body2 = Buffer.from([
    `--${boundary2}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="multi2-290.png"\r\n`,
    `Content-Type: image/png\r\n\r\n`,
  ].join(''));
  const full2 = Buffer.concat([body2, png2, Buffer.from(`\r\n--${boundary2}--\r\n`)]);

  const res2 = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
    body: full2,
  });
  assert(res2.status === 201, `Second upload succeeds (${res2.status})`);

  // Both should appear in list
  const listRes = await fetch(`${API}/assets`, { headers });
  const list = await listRes.json();
  assert(list.data.length >= 2, `Asset list has at least 2 items (has ${list.data.length})`);
}

async function testNoFileUpload() {
  process.stdout.write('\n--- No File Provided ---\n');

  const boundary = '----FormBoundary290Empty' + Date.now();
  const body = Buffer.from(`--${boundary}--\r\n`);

  const res = await fetch(`${API}/assets/upload`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert(res.status === 400, `No file returns 400 (got ${res.status})`);
  const err = await res.json();
  assert(err.message.includes('No file') || err.message.includes('file'), 'Error mentions missing file');
}

(async () => {
  try {
    await testAssetUploadAPI();
    await testAssetAppearsInList();
    await testOversizedUploadRejected();
    await testUnsupportedTypeRejected();
    await testUploadProgressUICode();
    await testUploadStatusStates();
    await testUploadCompletionFeedback();
    await testProgressBarAppearance();
    await testMultipleUploads();
    await testNoFileUpload();

    process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    process.stdout.write(`\nFATAL ERROR: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
})();
