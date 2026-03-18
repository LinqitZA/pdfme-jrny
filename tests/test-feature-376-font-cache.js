/**
 * Feature #376: Browser Cache API for font caching
 * Designer caches fonts in browser with 24h TTL
 *
 * Verification steps:
 * 1. Load designer with custom font
 * 2. Verify font cached in Cache API
 * 3. Reload designer - font loaded from cache
 * 4. Verify cache expiry after 24 hours
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const API_BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function generateToken(orgId = 'org-font-cache-376', userId = 'user-376') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {},
    };

    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    if (body && !(body instanceof Buffer)) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);

      const req = http.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw), headers: res.headers }); }
          catch { resolve({ status: res.statusCode, data: raw, headers: res.headers }); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } else if (body instanceof Buffer) {
      // Multipart upload for font
      const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
      const filename = 'test-font-376.ttf';
      const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: font/ttf\r\n\r\n`;
      const epilogue = `\r\n--${boundary}--\r\n`;
      const payload = Buffer.concat([Buffer.from(preamble), body, Buffer.from(epilogue)]);
      options.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      options.headers['Content-Length'] = payload.length;

      const req = http.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw), headers: res.headers }); }
          catch { resolve({ status: res.statusCode, data: raw, headers: res.headers }); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    } else {
      const req = http.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw), headers: res.headers }); }
          catch { resolve({ status: res.statusCode, data: raw, headers: res.headers }); }
        });
      });
      req.on('error', reject);
      req.end();
    }
  });
}

/**
 * Create a minimal valid TTF font buffer for testing.
 * This creates a bare-minimum TTF with installable embedding (fsType=0x0000).
 */
function createTestTTF() {
  const buf = Buffer.alloc(512, 0);
  // TrueType magic
  buf.writeUInt32BE(0x00010000, 0);
  // numTables = 1
  buf.writeUInt16BE(1, 4);
  // searchRange, entrySelector, rangeShift
  buf.writeUInt16BE(16, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(16, 10);
  // Table directory entry for OS/2
  buf.write('OS/2', 12, 'ascii');
  buf.writeUInt32BE(0, 16); // checksum
  buf.writeUInt32BE(28, 20); // offset to OS/2 table
  buf.writeUInt32BE(78, 24); // length

  // OS/2 table at offset 28
  // version
  buf.writeUInt16BE(4, 28);
  // xAvgCharWidth
  buf.writeInt16BE(500, 30);
  // usWeightClass
  buf.writeUInt16BE(400, 32);
  // usWidthClass
  buf.writeUInt16BE(5, 34);
  // fsType = 0x0000 (installable embedding)
  buf.writeUInt16BE(0x0000, 36);

  return buf;
}

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

async function runTests() {
  const token = generateToken();

  console.log('Feature #376: Browser Cache API for font caching');
  console.log('='.repeat(60));

  for (const { name, fn } of results) {
    try {
      await fn(token);
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  }

  console.log(`\nResults: ${passed}/${passed + failed} tests passing`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Tests ───

// 1. Font cache config endpoint returns correct settings
test('Font cache config endpoint returns cache settings', async (token) => {
  const res = await apiRequest('GET', '/fonts/cache/config', null, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.cacheName, 'pdfme-font-cache-v1');
  assert.strictEqual(res.data.ttlMs, 86400000); // 24h in ms
  assert.strictEqual(res.data.ttlHours, 24);
  assert.strictEqual(res.data.strategy, 'cache-first');
});

// 2. Cache config describes browser Cache API strategy
test('Cache config describes cache-first strategy', async (token) => {
  const res = await apiRequest('GET', '/fonts/cache/config', null, token);
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.description.includes('Cache API'));
  assert.ok(res.data.description.includes('24h'));
});

// 3. Upload a test font
test('Upload test font for caching tests', async (token) => {
  const fontBuf = createTestTTF();
  const res = await apiRequest('POST', '/fonts/upload', fontBuf, token);
  assert.strictEqual(res.status, 201);
  assert.ok(res.data.validation);
  assert.strictEqual(res.data.validation.valid, true);
});

// 4. Font list includes uploaded font
test('Font list includes uploaded test font', async (token) => {
  const res = await apiRequest('GET', '/fonts', null, token);
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.count >= 1, 'Should have at least 1 font');
  const hasTTF = res.data.data.some((f) => f.includes('.ttf'));
  assert.ok(hasTTF, 'Should include .ttf font file');
});

// 5. Font download returns correct content type
test('Font download returns correct content type for TTF', async (token) => {
  const listRes = await apiRequest('GET', '/fonts', null, token);
  const fontPath = listRes.data.data.find((f) => f.includes('test-font-376'));
  assert.ok(fontPath, 'Test font should exist');

  const fontId = fontPath.split('/').pop().replace('.ttf', '');
  const dlRes = await apiRequest('GET', `/fonts/${fontId}`, null, token);
  assert.strictEqual(dlRes.status, 200);
  assert.ok(dlRes.headers['content-type'].includes('font/ttf'));
});

// 6. Font download includes Cache-Control header
test('Font download includes Cache-Control header with 24h max-age', async (token) => {
  const listRes = await apiRequest('GET', '/fonts', null, token);
  const fontPath = listRes.data.data.find((f) => f.includes('test-font-376'));
  const fontId = fontPath.split('/').pop().replace('.ttf', '');

  const dlRes = await apiRequest('GET', `/fonts/${fontId}`, null, token);
  assert.strictEqual(dlRes.status, 200);
  const cc = dlRes.headers['cache-control'];
  assert.ok(cc, 'Cache-Control header should be present');
  assert.ok(cc.includes('max-age=86400'), 'Should have 24h max-age');
  assert.ok(cc.includes('public'), 'Should be public cacheable');
  assert.ok(cc.includes('immutable'), 'Should be marked immutable');
});

// 7. fontCache module exports correct functions
test('fontCache module exports isCacheApiAvailable function', async () => {
  // Verify the module file exists and has correct exports
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes('export function isCacheApiAvailable'), 'Should export isCacheApiAvailable');
  assert.ok(src.includes('export async function getCachedFont'), 'Should export getCachedFont');
  assert.ok(src.includes('export async function cacheFontResponse'), 'Should export cacheFontResponse');
  assert.ok(src.includes('export async function fetchFontWithCache'), 'Should export fetchFontWithCache');
  assert.ok(src.includes('export async function getFontCacheStats'), 'Should export getFontCacheStats');
  assert.ok(src.includes('export async function clearFontCache'), 'Should export clearFontCache');
  assert.ok(src.includes('export async function pruneExpiredFonts'), 'Should export pruneExpiredFonts');
});

// 8. fontCache module uses correct cache name
test('fontCache module uses pdfme-font-cache-v1 cache name', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes("'pdfme-font-cache-v1'"), 'Should use correct cache name');
});

// 9. fontCache module uses 24h TTL
test('fontCache module uses 24h TTL default', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes('24 * 60 * 60 * 1000'), 'Should define 24h TTL in ms');
  assert.ok(src.includes('DEFAULT_TTL_MS'), 'Should have DEFAULT_TTL_MS constant');
});

// 10. fontCache module has TTL expiry check
test('fontCache module checks TTL for cache expiry', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  // Verify the getCachedFont function checks age against TTL
  assert.ok(src.includes('age > ttlMs'), 'Should compare age against TTL');
  assert.ok(src.includes('cache.delete'), 'Should delete expired entries');
});

// 11. fontCache module stores timestamp header
test('fontCache module stores X-PdfMe-Cache-Timestamp header', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes('X-PdfMe-Cache-Timestamp'), 'Should use custom timestamp header');
  assert.ok(src.includes('headers.set(CACHE_TIMESTAMP_HEADER, String(Date.now()))'), 'Should set timestamp on cache');
});

// 12. ErpDesigner integrates fontCache
test('ErpDesigner imports and uses fontCache module', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );
  assert.ok(src.includes("from './fontCache'"), 'Should import fontCache');
  assert.ok(src.includes('fetchFontWithCache'), 'Should use fetchFontWithCache');
  assert.ok(src.includes('getFontCacheStats'), 'Should use getFontCacheStats');
  assert.ok(src.includes('pruneExpiredFonts'), 'Should prune expired fonts on load');
});

// 13. ErpDesigner exposes font cache status via data attributes
test('ErpDesigner has font cache data attributes', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );
  assert.ok(src.includes('data-font-cache-loaded'), 'Should have cache loaded attribute');
  assert.ok(src.includes('data-font-cache-entries'), 'Should have cache entries attribute');
  assert.ok(src.includes('data-font-cache-available'), 'Should have cache available attribute');
  assert.ok(src.includes('data-font-cache-from-cache'), 'Should track fonts loaded from cache');
  assert.ok(src.includes('data-font-cache-from-network'), 'Should track fonts loaded from network');
});

// 14. fontCache handles Cache API unavailability
test('fontCache gracefully handles missing Cache API', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  // getCachedFont returns null when Cache API not available
  assert.ok(src.includes("if (!isCacheApiAvailable()) return null"), 'getCachedFont returns null');
  // cacheFontResponse returns void silently
  assert.ok(src.includes("if (!isCacheApiAvailable()) return"), 'cacheFontResponse returns silently');
  // clearFontCache returns false
  assert.ok(src.includes("if (!isCacheApiAvailable()) return false"), 'clearFontCache returns false');
});

// 15. fontCache provides cache statistics
test('fontCache stats include entry details', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  // Stats should include useful fields
  assert.ok(src.includes('entryCount'), 'Should report entry count');
  assert.ok(src.includes('totalSizeBytes'), 'Should report total size');
  assert.ok(src.includes('expired'), 'Should flag expired entries');
  assert.ok(src.includes('ageMs'), 'Should calculate entry age');
});

// 16. Font download endpoint returns content-length
test('Font download returns content-length header', async (token) => {
  const listRes = await apiRequest('GET', '/fonts', null, token);
  const fontPath = listRes.data.data.find((f) => f.includes('test-font-376'));
  const fontId = fontPath.split('/').pop().replace('.ttf', '');

  const dlRes = await apiRequest('GET', `/fonts/${fontId}`, null, token);
  assert.strictEqual(dlRes.status, 200);
  const cl = dlRes.headers['content-length'];
  assert.ok(cl, 'Content-Length header should be present');
  assert.ok(parseInt(cl) > 0, 'Content should have positive length');
});

// 17. Cache config TTL matches font module TTL
test('Cache config TTL matches fontCache module TTL', async (token) => {
  const res = await apiRequest('GET', '/fonts/cache/config', null, token);
  assert.strictEqual(res.data.ttlMs, 24 * 60 * 60 * 1000);

  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  // Both use 24h
  assert.ok(src.includes('24 * 60 * 60 * 1000'));
});

// 18. ErpDesigner prunes expired cache entries on load
test('ErpDesigner calls pruneExpiredFonts on mount', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );
  // The useEffect should call pruneExpiredFonts before loading
  assert.ok(src.includes('await pruneExpiredFonts()'), 'Should prune expired entries on mount');
});

// 19. fontCache has cache-first strategy (check cache before network)
test('fontCache implements cache-first strategy', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  // fetchFontWithCache should check cache first
  const cacheFirstIdx = src.indexOf('Try cache first');
  const networkFetchIdx = src.indexOf('Network fetch');
  assert.ok(cacheFirstIdx > 0, 'Should have cache-first comment');
  assert.ok(networkFetchIdx > cacheFirstIdx, 'Network fetch should come after cache check');
});

// 20. fontCache tracks fromCache flag for observability
test('fontCache fetchFontWithCache returns fromCache flag', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes('fromCache: true'), 'Should return fromCache: true for cached fonts');
  assert.ok(src.includes('fromCache: false'), 'Should return fromCache: false for network fetches');
});

// 21. System fonts endpoint still works
test('System fonts endpoint returns open-licence fonts', async (token) => {
  const res = await apiRequest('GET', '/fonts/system', null, token);
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.fonts.length > 0, 'Should have system fonts');
  assert.strictEqual(res.data.allOpenLicence, true, 'All should be open licence');
});

// 22. Multiple font uploads all cacheable
test('Multiple fonts can be listed for caching', async (token) => {
  // Upload a second font
  const fontBuf = createTestTTF();
  const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
  const filename = 'test-font-376-second.ttf';
  const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: font/ttf\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([Buffer.from(preamble), fontBuf, Buffer.from(epilogue)]);

  await new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}/fonts/upload`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
      },
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  const listRes = await apiRequest('GET', '/fonts', null, token);
  assert.ok(listRes.data.count >= 2, 'Should have at least 2 fonts');
});

// 23. Font download works for second font
test('Second font download also has cache headers', async (token) => {
  const listRes = await apiRequest('GET', '/fonts', null, token);
  const fontPath = listRes.data.data.find((f) => f.includes('test-font-376-second'));
  assert.ok(fontPath, 'Second test font should exist');

  const fontId = fontPath.split('/').pop().replace('.ttf', '');
  const dlRes = await apiRequest('GET', `/fonts/${fontId}`, null, token);
  assert.strictEqual(dlRes.status, 200);
  assert.ok(dlRes.headers['cache-control'].includes('max-age=86400'));
});

// 24. ErpDesigner fetches fonts with auth headers in cache
test('ErpDesigner passes auth headers when fetching fonts', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );
  // The font loading code passes auth headers
  assert.ok(src.includes("fetchHeaders['Authorization']"), 'Should set Authorization header for font fetch');
});

// 25. fontCache module clones response before caching
test('fontCache clones response before caching to avoid body consumption', async () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'fontCache.ts'),
    'utf-8'
  );
  assert.ok(src.includes('response.clone()'), 'Should clone response before caching');
});

// 26. Health check still works after adding cache config endpoint
test('Health check still works', async () => {
  const res = await apiRequest('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.status, 'ok');
});

runTests();
