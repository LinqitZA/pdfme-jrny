/**
 * Feature #363: File storage handles concurrent reads
 *
 * Tests that multiple simultaneous file reads perform well:
 * - Upload 10 assets
 * - Read all 10 simultaneously
 * - Verify all return correctly
 * - Verify no timeout or error
 * - Verify response time reasonable
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const SECRET = 'pdfme-dev-secret';
const ORG_ID = 'org-concurrent-363-' + Date.now();

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('concurrent-user-363', ORG_ID);

function doRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data.toString()), raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data.toString(), raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function doRawRequest(method, path, rawBody, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data.toString()), raw: data });
        } catch {
          resolve({ status: res.statusCode, body: data.toString(), raw: data });
        }
      });
    });
    req.on('error', reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

/**
 * Generate a simple PNG image buffer with unique content.
 * Creates a minimal valid 1x1 PNG with a specific color.
 */
function generatePngBuffer(index) {
  // Minimal 1x1 PNG
  // PNG signature + IHDR + IDAT + IEND
  const r = (index * 37) % 256;
  const g = (index * 73) % 256;
  const b = (index * 113) % 256;

  // Use a simple approach: create a buffer with a unique marker
  const marker = `ASSET_${index}_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const markerBuf = Buffer.from(marker);

  // Create minimal valid PNG
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (width=1, height=1, bit_depth=8, color_type=2 RGB)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrCrc = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdr = Buffer.alloc(12 + 13);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write('IHDR', 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(ihdrCrc, 21);

  // IDAT chunk (raw pixel data: filter_byte + R G B)
  const rawPixel = Buffer.from([0, r, g, b]); // 0 = no filter
  // zlib deflate the raw data (use stored block for simplicity)
  const deflated = deflateStored(rawPixel);

  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), deflated]));
  const idat = Buffer.alloc(12 + deflated.length);
  idat.writeUInt32BE(deflated.length, 0);
  idat.write('IDAT', 4);
  deflated.copy(idat, 8);
  idat.writeUInt32BE(idatCrc, 8 + deflated.length);

  // IEND chunk
  const iendCrc = crc32(Buffer.from('IEND'));
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  iend.writeUInt32BE(iendCrc, 8);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Simple CRC32 for PNG chunks
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crc ^ buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Minimal zlib stored block (no compression)
function deflateStored(data) {
  const header = Buffer.from([0x78, 0x01]); // zlib header (no compression)
  const block = Buffer.alloc(5 + data.length);
  block[0] = 0x01; // final block, stored
  block.writeUInt16LE(data.length, 1);
  block.writeUInt16LE(data.length ^ 0xFFFF, 3);
  data.copy(block, 5);

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE((b << 16) | a, 0);

  return Buffer.concat([header, block, adler]);
}

/**
 * Upload a file via multipart/form-data
 */
function uploadAsset(filename, buffer) {
  const boundary = 'boundary' + Date.now() + Math.random().toString(36).substring(2);

  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
  parts.push(`Content-Type: image/png\r\n\r\n`);

  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buffer, footer]);

  return doRawRequest('POST', '/assets/upload', body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  });
}

function timedRequest(method, path) {
  const start = performance.now();
  return doRequest(method, path).then(res => {
    res.elapsed = performance.now() - start;
    return res;
  });
}

function timedRawGet(path) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + TOKEN },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const elapsed = performance.now() - start;
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, raw: data, elapsed, size: data.length });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function main() {
  console.log('=== Feature #363: File storage handles concurrent reads ===');

  // Check API health
  const health = await doRequest('GET', '/health');
  assert(health.status === 200, 'API server is healthy');

  // Step 1: Upload 10 assets
  console.log('\n--- Step 1: Upload 10 assets ---');
  const assetIds = [];
  const assetSizes = [];

  for (let i = 0; i < 10; i++) {
    const pngBuf = generatePngBuffer(i);
    const filename = `concurrent-test-${i}.png`;
    const res = await uploadAsset(filename, pngBuf);

    if (res.status === 201 || res.status === 200) {
      const assetId = res.body.id || res.body.assetId || res.body.filename || filename;
      assetIds.push(assetId);
      assetSizes.push(pngBuf.length);
      console.log(`  Uploaded asset ${i}: ${assetId} (${pngBuf.length} bytes)`);
    } else {
      console.log(`  Upload ${i} failed: ${res.status} - ${JSON.stringify(res.body).substring(0, 200)}`);
    }
  }

  assert(assetIds.length === 10, `All 10 assets uploaded (got ${assetIds.length})`);

  // Verify assets are listed
  const listRes = await doRequest('GET', '/assets');
  assert(listRes.status === 200, 'Asset list endpoint returns 200');
  const assets = listRes.body.data || [];
  console.log(`  Total assets in org: ${assets.length}`);
  assert(assets.length >= 10, `At least 10 assets listed (${assets.length})`);

  // Get asset IDs from the list for reading
  const readableAssets = assets.slice(0, 10);
  console.log(`  Will read ${readableAssets.length} assets concurrently`);

  // Step 2: Read all 10 simultaneously
  console.log('\n--- Step 2: Read all 10 simultaneously ---');

  // Extract asset identifiers for download
  const assetPaths = readableAssets.map(a => {
    // The asset path format varies - try to get the ID
    if (typeof a === 'string') {
      // Path string - extract filename
      const parts = a.split('/');
      return parts[parts.length - 1];
    }
    return a.id || a.assetId || a.filename || a;
  });

  const startConcurrent = performance.now();
  const concurrentPromises = assetPaths.map(assetPath =>
    timedRawGet(`/assets/${encodeURIComponent(assetPath)}`)
  );
  const concurrentResults = await Promise.all(concurrentPromises);
  const totalConcurrentTime = performance.now() - startConcurrent;

  console.log(`  All 10 concurrent reads completed in ${totalConcurrentTime.toFixed(2)}ms`);

  // Step 3: Verify all return correctly
  console.log('\n--- Step 3: Verify all return correctly ---');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < concurrentResults.length; i++) {
    const res = concurrentResults[i];
    if (res.status === 200) {
      successCount++;
      assert(res.size > 0, `Asset ${i} returned ${res.size} bytes in ${res.elapsed.toFixed(2)}ms`);
    } else {
      errorCount++;
      console.log(`  Asset ${i} (${assetPaths[i]}) failed: status ${res.status}`);
    }
  }

  assert(successCount === concurrentResults.length, `All ${concurrentResults.length} reads returned 200 (${successCount} success, ${errorCount} errors)`);

  // Step 4: Verify no timeout or error
  console.log('\n--- Step 4: Verify no timeout or error ---');

  const timedOut = concurrentResults.filter(r => r.elapsed > 5000);
  assert(timedOut.length === 0, `No reads timed out (>5s): ${timedOut.length} timeouts`);

  const errored = concurrentResults.filter(r => r.status >= 500);
  assert(errored.length === 0, `No server errors (5xx): ${errored.length} errors`);

  const notFound = concurrentResults.filter(r => r.status === 404);
  if (notFound.length > 0) {
    console.log(`  Note: ${notFound.length} assets returned 404 (may be path format issue)`);
  }

  // Step 5: Verify response time reasonable
  console.log('\n--- Step 5: Verify response time reasonable ---');

  const successTimes = concurrentResults.filter(r => r.status === 200).map(r => r.elapsed);
  if (successTimes.length > 0) {
    successTimes.sort((a, b) => a - b);
    const medianTime = successTimes[Math.floor(successTimes.length / 2)];
    const avgTime = successTimes.reduce((a, b) => a + b, 0) / successTimes.length;
    const maxTime = successTimes[successTimes.length - 1];

    console.log(`  Concurrent read stats: median=${medianTime.toFixed(2)}ms, avg=${avgTime.toFixed(2)}ms, max=${maxTime.toFixed(2)}ms`);
    assert(medianTime < 500, `Median read time ${medianTime.toFixed(2)}ms < 500ms`);
    assert(maxTime < 2000, `Max read time ${maxTime.toFixed(2)}ms < 2000ms`);
    assert(totalConcurrentTime < 5000, `Total concurrent time ${totalConcurrentTime.toFixed(2)}ms < 5000ms`);
  }

  // Bonus: Compare sequential vs concurrent
  console.log('\n--- Bonus: Sequential vs concurrent comparison ---');

  const startSequential = performance.now();
  for (const assetPath of assetPaths) {
    await timedRawGet(`/assets/${encodeURIComponent(assetPath)}`);
  }
  const totalSequentialTime = performance.now() - startSequential;

  console.log(`  Sequential reads: ${totalSequentialTime.toFixed(2)}ms`);
  console.log(`  Concurrent reads: ${totalConcurrentTime.toFixed(2)}ms`);

  // Concurrent should be faster than sequential (or at least similar)
  const speedup = totalSequentialTime / totalConcurrentTime;
  console.log(`  Speedup: ${speedup.toFixed(2)}x`);
  assert(totalConcurrentTime < totalSequentialTime * 2, `Concurrent not significantly slower than sequential`);

  // Second round of concurrent reads to verify stability
  console.log('\n--- Bonus: Second concurrent batch (stability) ---');
  const start2 = performance.now();
  const results2 = await Promise.all(
    assetPaths.map(p => timedRawGet(`/assets/${encodeURIComponent(p)}`))
  );
  const time2 = performance.now() - start2;
  const success2 = results2.filter(r => r.status === 200).length;
  console.log(`  Second batch: ${time2.toFixed(2)}ms, ${success2}/${results2.length} success`);
  assert(success2 === results2.length, `Second concurrent batch all successful`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
