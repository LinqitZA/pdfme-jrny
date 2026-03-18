/**
 * Feature #334: Concurrent asset uploads don't conflict
 * - Upload 5 assets simultaneously
 * - Verify all 5 stored correctly
 * - Verify no filename collisions
 * - Verify all accessible after upload
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = `org-concurrent-${Date.now()}`;

// Generate JWT token
function makeToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-334',
    orgId: orgId || ORG_ID,
    roles: ['template_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken();

// Create a minimal valid PNG buffer with unique content
function createPngBuffer(label) {
  // 1x1 pixel PNG with label embedded in tEXt chunk for uniqueness
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x02,             // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00,       // compression, filter, interlace
  ]);
  // IHDR CRC
  const ihdrData = pngHeader.slice(12, 29);
  const ihdrCrc = crc32(ihdrData);

  // IDAT chunk (minimal compressed pixel data)
  const idatData = Buffer.from([
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01
  ]);
  const idatChunk = Buffer.alloc(4 + 4 + idatData.length + 4);
  idatChunk.writeUInt32BE(idatData.length, 0);
  idatChunk.write('IDAT', 4);
  idatData.copy(idatChunk, 8);
  const idatCrcData = Buffer.concat([Buffer.from('IDAT'), idatData]);
  const idatCrc = crc32(idatCrcData);
  idatCrc.copy(idatChunk, 8 + idatData.length);

  // IEND chunk
  const iendChunk = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);

  return Buffer.concat([pngHeader, ihdrCrc, idatChunk, iendChunk]);
}

// Simple CRC32 for PNG chunks
function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const result = Buffer.alloc(4);
  result.writeUInt32BE(crc, 0);
  return result;
}

// Upload a file via multipart/form-data
function uploadAsset(filename, buffer) {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, '')}`;
    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
      `Content-Type: image/png\r\n\r\n`,
    ];
    const bodyStart = Buffer.from(bodyParts.join(''));
    const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([bodyStart, buffer, bodyEnd]);

    const url = new URL(`${BASE}/api/pdfme/assets/upload`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// List assets for the org
function listAssets() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/pdfme/assets`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Download an asset by ID
function downloadAsset(assetId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/pdfme/assets/${assetId}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Delete an asset
function deleteAsset(assetId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/pdfme/assets/${assetId}?confirm=true`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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

async function run() {
  console.log('Feature #334: Concurrent asset uploads don\'t conflict\n');

  // Step 1: Upload 5 assets simultaneously with SAME original filename
  console.log('Test 1: Upload 5 assets simultaneously (same filename)');
  const sameNameFiles = [];
  for (let i = 0; i < 5; i++) {
    sameNameFiles.push({ name: 'test-image.png', buffer: createPngBuffer(`same-${i}`) });
  }

  const sameNameResults = await Promise.all(
    sameNameFiles.map(f => uploadAsset(f.name, f.buffer))
  );

  const sameNameSuccesses = sameNameResults.filter(r => r.status === 201);
  assert(sameNameSuccesses.length === 5, `All 5 same-name uploads succeeded (got ${sameNameSuccesses.length}/5)`);

  // Step 2: Verify all have unique IDs
  const sameNameIds = sameNameSuccesses.map(r => r.body.id);
  const uniqueIds = new Set(sameNameIds);
  assert(uniqueIds.size === 5, `All 5 uploads have unique IDs (${uniqueIds.size} unique)`);

  // Step 3: Verify all have unique storage paths (no collisions)
  const sameNamePaths = sameNameSuccesses.map(r => r.body.storagePath);
  const uniquePaths = new Set(sameNamePaths);
  assert(uniquePaths.size === 5, `All 5 uploads have unique storage paths (${uniquePaths.size} unique)`);

  // Step 4: Verify all have unique filenames
  const sameNameFilenames = sameNameSuccesses.map(r => r.body.filename);
  const uniqueFilenames = new Set(sameNameFilenames);
  assert(uniqueFilenames.size === 5, `All 5 uploads have unique filenames (${uniqueFilenames.size} unique)`);

  // Step 5: Upload 5 assets simultaneously with DIFFERENT filenames
  console.log('\nTest 2: Upload 5 assets simultaneously (different filenames)');
  const diffNameFiles = [];
  for (let i = 0; i < 5; i++) {
    diffNameFiles.push({ name: `asset-${i}-${Date.now()}.png`, buffer: createPngBuffer(`diff-${i}`) });
  }

  const diffNameResults = await Promise.all(
    diffNameFiles.map(f => uploadAsset(f.name, f.buffer))
  );

  const diffNameSuccesses = diffNameResults.filter(r => r.status === 201);
  assert(diffNameSuccesses.length === 5, `All 5 different-name uploads succeeded (got ${diffNameSuccesses.length}/5)`);

  // Step 6: Verify different-name uploads have unique IDs
  const diffIds = diffNameSuccesses.map(r => r.body.id);
  const uniqueDiffIds = new Set(diffIds);
  assert(uniqueDiffIds.size === 5, `All 5 different-name uploads have unique IDs (${uniqueDiffIds.size} unique)`);

  // Step 7: Verify no ID collisions between same-name and different-name uploads
  const allIds = [...sameNameIds, ...diffIds];
  const allUniqueIds = new Set(allIds);
  assert(allUniqueIds.size === 10, `All 10 uploads have globally unique IDs (${allUniqueIds.size} unique)`);

  // Step 8: Verify all 10 assets appear in asset list
  console.log('\nTest 3: Verify all assets stored correctly');
  const listResult = await listAssets();
  assert(listResult.status === 200, `Asset list returns 200 (got ${listResult.status})`);

  const storedAssets = listResult.body.data || [];
  let allFoundInList = 0;
  for (const id of allIds) {
    if (storedAssets.some(a => a.includes(id))) {
      allFoundInList++;
    }
  }
  assert(allFoundInList === 10, `All 10 assets found in asset list (found ${allFoundInList}/10)`);

  // Step 9: Verify each asset is individually accessible (download)
  console.log('\nTest 4: Verify all assets accessible after upload');
  let accessibleCount = 0;
  for (const id of allIds) {
    const dl = await downloadAsset(id);
    if (dl.status === 200 && dl.body.length > 0) {
      accessibleCount++;
    }
  }
  assert(accessibleCount === 10, `All 10 assets downloadable (${accessibleCount}/10)`);

  // Step 10: Verify upload results have correct metadata
  console.log('\nTest 5: Verify upload metadata correctness');
  for (let i = 0; i < sameNameSuccesses.length; i++) {
    const r = sameNameSuccesses[i].body;
    assert(r.originalName === 'test-image.png', `Same-name upload ${i} has correct originalName`);
    assert(r.category === 'image', `Same-name upload ${i} has correct category`);
    assert(r.mimeType === 'image/png', `Same-name upload ${i} has correct mimeType`);
    assert(r.orgId === ORG_ID, `Same-name upload ${i} has correct orgId`);
    assert(typeof r.createdAt === 'string' && r.createdAt.includes('T'), `Same-name upload ${i} has ISO timestamp`);
  }

  // Step 11: Verify no filename collisions even with same original name
  console.log('\nTest 6: Verify filename collision prevention');
  const allFilenames = [...sameNameFilenames, ...diffNameSuccesses.map(r => r.body.filename)];
  const uniqueAllFilenames = new Set(allFilenames);
  assert(uniqueAllFilenames.size === 10, `All 10 filenames are unique (${uniqueAllFilenames.size} unique)`);

  // Verify UUID prefix in filenames prevents collisions
  for (const fn of sameNameFilenames) {
    assert(fn.includes('_test-image.png'), `Same-name file ${fn} has UUID prefix + original name`);
  }

  // Cleanup
  console.log('\nCleanup: Deleting test assets...');
  for (const id of allIds) {
    await deleteAsset(id).catch(() => {});
  }

  console.log(`\n=============================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
