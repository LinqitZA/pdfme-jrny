/**
 * Test Feature #30: Signature files stored with restricted permissions
 *
 * Verifies:
 * - Upload drawn signature via POST /api/pdfme/signatures
 * - Signature directory uses 0700 permissions
 * - Signature file uses 0600 permissions
 * - File is not accessible via public web URL
 * - Storage info endpoint reports restricted status
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = 'pdfme-dev-secret';

let passed = 0;
let failed = 0;
const results = [];

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const TOKEN = makeJwt({
  sub: 'sig-user-30',
  orgId: 'org-sig-30',
  roles: ['admin', 'template:view', 'template:edit'],
});

function request(method, urlPath, body = null, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function rawRequest(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${name}`);
  } else {
    failed++;
    results.push(`  ❌ ${name}`);
  }
}

// Create a minimal valid PNG (1x1 red pixel)
function createMinimalPng() {
  // Minimal valid PNG with 1x1 pixel
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // chunk length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(1, 8); // width
  ihdr.writeUInt32BE(1, 12); // height
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // color type (RGB)
  ihdr[18] = 0; ihdr[19] = 0; ihdr[20] = 0;
  // CRC for IHDR
  const ihdrData = ihdr.subarray(4, 21);
  const ihdrCrc = crc32(ihdrData);
  ihdr.writeInt32BE(ihdrCrc, 21);

  return Buffer.concat([pngHeader, ihdr]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xEDB88320;
      else crc = crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) | 0;
}

async function run() {
  const STORAGE_ROOT = path.join(process.cwd(), 'storage');
  const SIG_DIR = path.join(STORAGE_ROOT, 'org-sig-30', 'signatures');

  // 1. Upload a signature
  const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  const uploadRes = await request('POST', `${BASE}/signatures`, {
    data: pngData.toString('base64'),
  });
  assert('Signature upload returns 201', uploadRes.status === 201);
  assert('Signature has id', !!uploadRes.body.id);
  assert('Signature has filePath', !!uploadRes.body.filePath);
  assert('FilePath contains signatures directory', uploadRes.body.filePath && uploadRes.body.filePath.includes('/signatures/'));

  await new Promise(r => setTimeout(r, 300));

  // 2. Check filesystem permissions on signature storage directory
  let dirExists = false;
  let dirMode = null;
  try {
    if (fs.existsSync(SIG_DIR)) {
      dirExists = true;
      const stats = fs.statSync(SIG_DIR);
      dirMode = stats.mode & 0o777;
    }
  } catch (err) {
    // Expected if permissions are restrictive
  }
  assert('Signature directory exists', dirExists);
  assert('Directory permissions are 0700 (owner-only)', dirMode === 0o700);

  // 3. Check file permissions
  let fileMode = null;
  try {
    const files = fs.readdirSync(SIG_DIR);
    if (files.length > 0) {
      const fileStat = fs.statSync(path.join(SIG_DIR, files[0]));
      fileMode = fileStat.mode & 0o777;
    }
  } catch {
    // May fail if permissions are too restrictive for current user
  }
  assert('Signature file has restrictive permissions (0600)', fileMode === 0o600);

  // 4. Verify file is NOT accessible via public web URL (no auth)
  const noAuthRes = await rawRequest('GET', `${BASE}/signatures/me/file`);
  assert('Signature file not accessible without auth (401)', noAuthRes.status === 401);

  // 5. Verify file IS accessible via authenticated endpoint
  const authFileRes = await request('GET', `${BASE}/signatures/me/file`);
  assert('Signature file accessible with auth', authFileRes.status === 200);

  // 6. Check storage-info endpoint
  const infoRes = await request('GET', `${BASE}/signatures/storage-info`);
  assert('Storage info endpoint returns 200', infoRes.status === 200);
  assert('Storage info reports directory exists', infoRes.body.directoryExists === true);
  assert('Storage info reports 0700 permissions', infoRes.body.directoryPermissions === '0700');
  assert('Storage info reports restricted=true', infoRes.body.restricted === true);
  assert('Storage info reports publiclyAccessible=false', infoRes.body.publiclyAccessible === false);
  assert('Storage info reports file count >= 1', infoRes.body.fileCount >= 1);
  assert('Storage info reports correct orgId', infoRes.body.orgId === 'org-sig-30');

  // 7. Upload a second signature (different user) and verify isolation
  const TOKEN2 = makeJwt({
    sub: 'sig-user-30b',
    orgId: 'org-sig-30',
    roles: ['admin'],
  });
  const upload2Res = await request('POST', `${BASE}/signatures`, {
    data: pngData.toString('base64'),
  }, TOKEN2);
  assert('Second user can also upload signature', upload2Res.status === 201);

  // Verify permissions still correct after second upload
  await new Promise(r => setTimeout(r, 300));
  const info2Res = await request('GET', `${BASE}/signatures/storage-info`);
  assert('Permissions maintained after second upload (0700)', info2Res.body.directoryPermissions === '0700');
  assert('File count increased', info2Res.body.fileCount >= 2);

  // 8. Verify direct file path is not a public URL
  // Try to access storage path directly - should fail
  const directPath = uploadRes.body.filePath;
  const directRes = await rawRequest('GET', `http://localhost:3001/${directPath}`);
  assert('Direct file path not publicly accessible', directRes.status === 404 || directRes.status === 401);

  // 9. Verify different org cannot access signature file
  const TOKEN_OTHER_ORG = makeJwt({
    sub: 'sig-user-30',
    orgId: 'org-other-30',
    roles: ['admin'],
  });
  const crossOrgRes = await request('GET', `${BASE}/signatures/me/file`, null, TOKEN_OTHER_ORG);
  assert('Cross-org access to signature file blocked', crossOrgRes.status === 404);

  // Print results
  const total = passed + failed;
  for (const r of results) process.stdout.write(r + '\n');
  process.stdout.write(`\n${passed}/${total} tests passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write(`Test error: ${err.message}\n`);
  process.exit(1);
});
