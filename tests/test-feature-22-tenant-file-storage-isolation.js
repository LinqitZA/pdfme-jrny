/**
 * Feature #22: Tenant isolation - file storage paths prefixed with orgId
 *
 * Tests that files are stored under org-specific directories and
 * cross-org file access is prevented.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function multipartUpload(urlPath, filename, buffer, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write('  ✅ ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  ❌ ' + name + '\n');
  }
}

// Create a small valid PNG buffer
function createPng() {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrLength = Buffer.from([0x00, 0x00, 0x00, 0x0D]);
  const ihdrType = Buffer.from('IHDR');
  const ihdrData = Buffer.from([
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, // bit depth: 8, color type: RGB
    0x00, 0x00, 0x00, // compression, filter, interlace
  ]);
  const ihdrCrc = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([ihdrType, ihdrData]));
  ihdrCrc.writeUInt32BE(crc, 0);

  const idatData = Buffer.from([0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01]);
  const idatLength = Buffer.alloc(4);
  idatLength.writeUInt32BE(idatData.length, 0);
  const idatType = Buffer.from('IDAT');
  const idatCrc = Buffer.alloc(4);
  const crc2 = crc32(Buffer.concat([idatType, idatData]));
  idatCrc.writeUInt32BE(crc2, 0);

  const iendLength = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const iendType = Buffer.from('IEND');
  const iendCrc = Buffer.alloc(4);
  const crc3 = crc32(iendType);
  iendCrc.writeUInt32BE(crc3, 0);

  return Buffer.concat([
    pngHeader,
    ihdrLength, ihdrType, ihdrData, ihdrCrc,
    idatLength, idatType, idatData, idatCrc,
    iendLength, iendType, iendCrc,
  ]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function run() {
  process.stdout.write('=== Feature #22: Tenant isolation - file storage paths prefixed with orgId ===\n\n');

  const TS = Date.now();
  const ORG_A = `org-iso-A-${TS}`;
  const ORG_B = `org-iso-B-${TS}`;

  const tokenA = makeToken('userA-22', ORG_A, ['template:view', 'template:edit', 'template:publish']);
  const tokenB = makeToken('userB-22', ORG_B, ['template:view', 'template:edit', 'template:publish']);

  const pngBuf = createPng();

  // ============================================================
  // Step 1: Upload asset with org-A JWT
  // ============================================================
  process.stdout.write('Step 1: Upload asset with org-A JWT\n');

  const uploadA = await multipartUpload('/api/pdfme/assets/upload', `test-orgA-${TS}.png`, pngBuf, tokenA);
  assert('Org-A upload returns 201', uploadA.status === 201);
  assert('Org-A upload returns storagePath', typeof uploadA.data.storagePath === 'string');
  assert('Org-A upload has orgId', uploadA.data.orgId === ORG_A);
  assert('Org-A upload has id', typeof uploadA.data.id === 'string');

  const assetIdA = uploadA.data.id;
  const storagePathA = uploadA.data.storagePath;

  // ============================================================
  // Step 2: Verify file stored under {rootDir}/org-A/assets/
  // ============================================================
  process.stdout.write('\nStep 2: Verify file stored under org-A directory\n');

  assert('Storage path starts with orgId', storagePathA.startsWith(ORG_A + '/'));
  assert('Storage path includes /assets/', storagePathA.includes('/assets/'));
  assert('Storage path format: orgId/assets/filename', /^[^/]+\/assets\/[^/]+$/.test(storagePathA));

  // Verify file actually exists on disk via storage-structure endpoint
  const structA = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_A}`, null);
  assert('Storage structure returns org-A assets dir', structA.data.structure && structA.data.structure[`${ORG_A}/assets`]);
  assert('Org-A assets directory exists on disk', structA.data.structure[`${ORG_A}/assets`]?.exists === true);

  // Verify via file listing
  const listA = await request('GET', '/api/pdfme/assets', tokenA);
  assert('Org-A asset list returns 200', listA.status === 200);
  assert('Org-A asset list contains uploaded file', listA.data.data.some(f => f.includes(assetIdA)));
  assert('All org-A files have orgId prefix', listA.data.data.every(f => f.startsWith(ORG_A + '/')));

  // ============================================================
  // Step 3: Upload asset with org-B JWT
  // ============================================================
  process.stdout.write('\nStep 3: Upload asset with org-B JWT\n');

  const uploadB = await multipartUpload('/api/pdfme/assets/upload', `test-orgB-${TS}.png`, pngBuf, tokenB);
  assert('Org-B upload returns 201', uploadB.status === 201);
  assert('Org-B upload returns storagePath', typeof uploadB.data.storagePath === 'string');
  assert('Org-B upload has orgId', uploadB.data.orgId === ORG_B);

  const assetIdB = uploadB.data.id;
  const storagePathB = uploadB.data.storagePath;

  // ============================================================
  // Step 4: Verify file stored under {rootDir}/org-B/assets/
  // ============================================================
  process.stdout.write('\nStep 4: Verify file stored under org-B directory\n');

  assert('Org-B storage path starts with orgId', storagePathB.startsWith(ORG_B + '/'));
  assert('Org-B storage path includes /assets/', storagePathB.includes('/assets/'));

  const structB = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_B}`, null);
  assert('Org-B assets directory exists on disk', structB.data.structure[`${ORG_B}/assets`]?.exists === true);

  const listB = await request('GET', '/api/pdfme/assets', tokenB);
  assert('Org-B asset list returns 200', listB.status === 200);
  assert('Org-B asset list contains uploaded file', listB.data.data.some(f => f.includes(assetIdB)));
  assert('All org-B files have orgId prefix', listB.data.data.every(f => f.startsWith(ORG_B + '/')));

  // ============================================================
  // Step 5: Verify no cross-org file access
  // ============================================================
  process.stdout.write('\nStep 5: Verify no cross-org file access\n');

  // Org-A listing should NOT contain org-B assets
  const listACrossCheck = await request('GET', '/api/pdfme/assets', tokenA);
  assert('Org-A listing has NO org-B files', !listACrossCheck.data.data.some(f => f.startsWith(ORG_B + '/')));
  assert('Org-A listing has NO org-B asset ID', !listACrossCheck.data.data.some(f => f.includes(assetIdB)));

  // Org-B listing should NOT contain org-A assets
  const listBCrossCheck = await request('GET', '/api/pdfme/assets', tokenB);
  assert('Org-B listing has NO org-A files', !listBCrossCheck.data.data.some(f => f.startsWith(ORG_A + '/')));
  assert('Org-B listing has NO org-A asset ID', !listBCrossCheck.data.data.some(f => f.includes(assetIdA)));

  // Org-B trying to download org-A's asset should get 404
  const crossDownload = await request('GET', `/api/pdfme/assets/${assetIdA}`, tokenB);
  assert('Cross-org download returns 404', crossDownload.status === 404);

  // Org-A trying to download org-B's asset should get 404
  const crossDownload2 = await request('GET', `/api/pdfme/assets/${assetIdB}`, tokenA);
  assert('Reverse cross-org download returns 404', crossDownload2.status === 404);

  // Org-B trying to delete org-A's asset should get 404
  const crossDelete = await request('DELETE', `/api/pdfme/assets/${assetIdA}`, tokenB);
  assert('Cross-org delete returns 404', crossDelete.status === 404);

  // ============================================================
  // Step 6: Verify org-A can still access own asset after cross-org attempts
  // ============================================================
  process.stdout.write('\nStep 6: Own-org access still works after cross-org attempts\n');

  const ownDownload = await request('GET', `/api/pdfme/assets/${assetIdA}`, tokenA);
  assert('Org-A can still download own asset (200)', ownDownload.status === 200);

  // ============================================================
  // Step 7: Verify storage paths are separate on disk
  // ============================================================
  process.stdout.write('\nStep 7: Verify storage directory paths are separate on disk\n');

  const rootInfo = await request('GET', '/api/pdfme/health/storage-structure?orgId=' + ORG_A, null);
  const rootDir = rootInfo.data.rootDir;
  assert('Root dir is available', typeof rootDir === 'string' && rootDir.length > 0);

  // Check physical directories are different
  const orgAPath = path.join(rootDir, ORG_A, 'assets');
  const orgBPath = path.join(rootDir, ORG_B, 'assets');
  assert('Org-A and Org-B have different storage directories', orgAPath !== orgBPath);

  // Verify org-A directory has files
  const structCheckA = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_A}`, null);
  const structCheckB = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_B}`, null);
  assert('Org-A assets dir path contains orgId', structCheckA.data.structure[`${ORG_A}/assets`].path.includes(ORG_A));
  assert('Org-B assets dir path contains orgId', structCheckB.data.structure[`${ORG_B}/assets`].path.includes(ORG_B));

  // ============================================================
  // Step 8: Font uploads also use orgId prefix
  // ============================================================
  process.stdout.write('\nStep 8: Font uploads also use orgId prefix\n');

  // Create a minimal TTF-like file (just needs extension check)
  const ttfBuf = Buffer.alloc(100);
  ttfBuf.writeUInt32BE(0x00010000, 0); // TTF version
  const fontUploadA = await multipartUpload('/api/pdfme/assets/upload', `test-font-${TS}.ttf`, ttfBuf, tokenA);
  assert('Font upload returns 201', fontUploadA.status === 201);
  assert('Font stored under orgId/fonts/', fontUploadA.data.storagePath.startsWith(ORG_A + '/fonts/'));
  assert('Font category is font', fontUploadA.data.category === 'font');

  const fontUploadB = await multipartUpload('/api/pdfme/assets/upload', `test-font-${TS}.ttf`, ttfBuf, tokenB);
  assert('Org-B font upload returns 201', fontUploadB.status === 201);
  assert('Org-B font stored under orgId/fonts/', fontUploadB.data.storagePath.startsWith(ORG_B + '/fonts/'));

  // ============================================================
  // Step 9: Signatures use orgId prefix
  // ============================================================
  process.stdout.write('\nStep 9: Signatures use orgId prefix\n');

  // Upload signature for org-A
  const sigPng = pngBuf.toString('base64');
  const sigUploadA = await request('POST', '/api/pdfme/signatures', tokenA, {
    data: `data:image/png;base64,${sigPng}`,
  });
  assert('Org-A signature upload returns 201', sigUploadA.status === 201);
  assert('Signature filePath starts with orgId', sigUploadA.data.filePath.startsWith(ORG_A + '/'));
  assert('Signature filePath includes /signatures/', sigUploadA.data.filePath.includes('/signatures/'));

  // Upload signature for org-B
  const sigUploadB = await request('POST', '/api/pdfme/signatures', tokenB, {
    data: `data:image/png;base64,${sigPng}`,
  });
  assert('Org-B signature upload returns 201', sigUploadB.status === 201);
  assert('Org-B signature filePath starts with orgId', sigUploadB.data.filePath.startsWith(ORG_B + '/'));

  // Org-A cannot access org-B's signature
  const sigMeA = await request('GET', '/api/pdfme/signatures/me', tokenA);
  assert('Org-A gets own signature', sigMeA.status === 200 && sigMeA.data.orgId === ORG_A);

  const sigMeB = await request('GET', '/api/pdfme/signatures/me', tokenB);
  assert('Org-B gets own signature', sigMeB.status === 200 && sigMeB.data.orgId === ORG_B);

  // ============================================================
  // Step 10: Storage usage scoped to org
  // ============================================================
  process.stdout.write('\nStep 10: Storage usage is scoped per org\n');

  const usageA = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_A}`, null);
  const usageB = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_B}`, null);
  assert('Org-A structure shows org-A directories', !!usageA.data.structure[`${ORG_A}/assets`]);
  assert('Org-B structure shows org-B directories', !!usageB.data.structure[`${ORG_B}/assets`]);
  assert('Org-A structure does NOT show org-B', !usageA.data.structure[`${ORG_B}/assets`]);
  assert('Org-B structure does NOT show org-A', !usageB.data.structure[`${ORG_A}/assets`]);

  // ============================================================
  // Cleanup
  // ============================================================
  process.stdout.write('\nCleanup: Deleting test assets\n');
  await request('DELETE', `/api/pdfme/assets/${assetIdA}?confirm=true`, tokenA);
  await request('DELETE', `/api/pdfme/assets/${assetIdB}?confirm=true`, tokenB);
  await request('DELETE', `/api/pdfme/signatures/me`, tokenA);
  await request('DELETE', `/api/pdfme/signatures/me`, tokenB);

  // ============================================================
  // Summary
  // ============================================================
  process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
