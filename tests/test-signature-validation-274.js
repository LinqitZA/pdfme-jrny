const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const JWT_TOKEN = createJwt({ sub: 'test-user-274', orgId: 'test-org-274', roles: ['template:admin'] });

let passed = 0;
let failed = 0;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`,
        ...headers,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function createMinimalPng() {
  // Minimal valid 1x1 transparent PNG
  const pngData = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
    'hex'
  );
  return pngData.toString('base64');
}

function createMinimalSvg() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="black"/></svg>';
  return Buffer.from(svg).toString('base64');
}

async function run() {
  console.log('=== Feature #274: Signature data validation ===\n');

  // ---- GROUP 1: Empty/missing data → 400 ----
  console.log('--- Group 1: Empty/missing data → 400 ---');

  // Test 1: No data field
  {
    const res = await request('POST', '/api/pdfme/signatures', {});
    assert(res.status === 400, `No data field returns 400 (got ${res.status})`);
    assert(res.body.message && res.body.message.includes('required'), `Message mentions required (got ${res.body.message})`);
  }

  // Test 2: Empty string data
  {
    const res = await request('POST', '/api/pdfme/signatures', { data: '' });
    assert(res.status === 400, `Empty string data returns 400 (got ${res.status})`);
  }

  // Test 3: Whitespace-only data
  {
    const res = await request('POST', '/api/pdfme/signatures', { data: '   ' });
    assert(res.status === 400, `Whitespace-only data returns 400 (got ${res.status})`);
  }

  // Test 4: null data
  {
    const res = await request('POST', '/api/pdfme/signatures', { data: null });
    assert(res.status === 400, `Null data returns 400 (got ${res.status})`);
  }

  // ---- GROUP 2: Non-image data → 400 ----
  console.log('\n--- Group 2: Non-image data → 400 ---');

  // Test 5: Random text as base64
  {
    const randomText = Buffer.from('This is just plain text, not an image').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: randomText });
    assert(res.status === 400, `Plain text base64 returns 400 (got ${res.status})`);
    assert(res.body.message && res.body.message.toLowerCase().includes('image'), `Message mentions image (got ${res.body.message})`);
  }

  // Test 6: JSON as base64
  {
    const jsonData = Buffer.from(JSON.stringify({ not: 'an image' })).toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: jsonData });
    assert(res.status === 400, `JSON base64 returns 400 (got ${res.status})`);
  }

  // Test 7: PDF data as base64
  {
    const pdfHeader = Buffer.from('%PDF-1.4 this is pdf data');
    const res = await request('POST', '/api/pdfme/signatures', { data: pdfHeader.toString('base64') });
    assert(res.status === 400, `PDF data returns 400 (got ${res.status})`);
  }

  // Test 8: Random binary data
  {
    const randomBytes = crypto.randomBytes(100);
    const res = await request('POST', '/api/pdfme/signatures', { data: randomBytes.toString('base64') });
    assert(res.status === 400, `Random binary returns 400 (got ${res.status})`);
  }

  // Test 9: JPEG data URL prefix (unsupported format)
  {
    const jpegPrefix = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg data').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: jpegPrefix });
    assert(res.status === 400, `JPEG data URL returns 400 (got ${res.status})`);
    assert(res.body.message && res.body.message.includes('image/jpeg'), `Message mentions jpeg mime type (got ${res.body.message})`);
  }

  // Test 10: GIF data URL prefix (unsupported format)
  {
    const gifPrefix = 'data:image/gif;base64,' + Buffer.from('fake gif data').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: gifPrefix });
    assert(res.status === 400, `GIF data URL returns 400 (got ${res.status})`);
  }

  // Test 11: application/pdf data URL prefix
  {
    const pdfPrefix = 'data:application/pdf;base64,' + Buffer.from('fake pdf data').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: pdfPrefix });
    assert(res.status === 400, `PDF data URL returns 400 (got ${res.status})`);
  }

  // Test 12: WebP data URL prefix (unsupported)
  {
    const webpPrefix = 'data:image/webp;base64,' + Buffer.from('fake webp data').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: webpPrefix });
    assert(res.status === 400, `WebP data URL returns 400 (got ${res.status})`);
  }

  // ---- GROUP 3: Valid PNG/SVG → succeeds ----
  console.log('\n--- Group 3: Valid PNG/SVG → 201 ---');

  // Test 13: Valid PNG with data URL prefix
  {
    const pngBase64 = createMinimalPng();
    const res = await request('POST', '/api/pdfme/signatures', { data: `data:image/png;base64,${pngBase64}` });
    assert(res.status === 201, `PNG with data URL prefix returns 201 (got ${res.status})`);
    assert(res.body.id, `Response has id (got ${res.body.id})`);
    assert(res.body.userId === 'test-user-274', `Response has userId (got ${res.body.userId})`);
  }

  // Revoke before uploading again
  await request('DELETE', '/api/pdfme/signatures/me');

  // Test 14: Valid PNG without data URL prefix (raw base64)
  {
    const pngBase64 = createMinimalPng();
    const res = await request('POST', '/api/pdfme/signatures', { data: pngBase64 });
    assert(res.status === 201, `PNG without prefix returns 201 (got ${res.status})`);
    assert(res.body.id, `Response has id for raw PNG (got ${res.body.id})`);
  }

  // Revoke again
  await request('DELETE', '/api/pdfme/signatures/me');

  // Test 15: Valid SVG with data URL prefix
  {
    const svgBase64 = createMinimalSvg();
    const res = await request('POST', '/api/pdfme/signatures', { data: `data:image/svg+xml;base64,${svgBase64}` });
    assert(res.status === 201, `SVG with data URL prefix returns 201 (got ${res.status})`);
    assert(res.body.id, `Response has id for SVG (got ${res.body.id})`);
  }

  // Revoke again
  await request('DELETE', '/api/pdfme/signatures/me');

  // Test 16: Valid SVG without data URL prefix (raw base64, detected by content)
  {
    const svgBase64 = createMinimalSvg();
    const res = await request('POST', '/api/pdfme/signatures', { data: svgBase64 });
    assert(res.status === 201, `SVG without prefix returns 201 (got ${res.status})`);
  }

  // Revoke again
  await request('DELETE', '/api/pdfme/signatures/me');

  // Test 17: SVG with XML declaration
  {
    const svgWithXml = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>';
    const res = await request('POST', '/api/pdfme/signatures', { data: Buffer.from(svgWithXml).toString('base64') });
    assert(res.status === 201, `SVG with XML declaration returns 201 (got ${res.status})`);
  }

  // Revoke and cleanup
  await request('DELETE', '/api/pdfme/signatures/me');

  // ---- GROUP 4: Error response format ----
  console.log('\n--- Group 4: Error response format ---');

  // Test 18: Error has standard envelope
  {
    const randomBytes = crypto.randomBytes(50);
    const res = await request('POST', '/api/pdfme/signatures', { data: randomBytes.toString('base64') });
    assert(res.body.statusCode === 400, `Error has statusCode (got ${res.body.statusCode})`);
    assert(res.body.error === 'Bad Request', `Error has error field (got ${res.body.error})`);
    assert(res.body.message, `Error has message (got ${res.body.message})`);
  }

  // Test 19: Unsupported format error mentions accepted formats
  {
    const bmpPrefix = 'data:image/bmp;base64,' + Buffer.from('fake bmp').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: bmpPrefix });
    assert(res.status === 400, `BMP returns 400 (got ${res.status})`);
    assert(
      res.body.message.includes('png') || res.body.message.includes('PNG') || res.body.message.includes('svg') || res.body.message.includes('SVG'),
      `Error mentions accepted formats (got ${res.body.message})`
    );
  }

  // Test 20: Details array on unsupported format
  {
    const bmpPrefix = 'data:image/bmp;base64,' + Buffer.from('fake bmp').toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', { data: bmpPrefix });
    assert(Array.isArray(res.body.details), `Unsupported format error has details array (got ${typeof res.body.details})`);
  }

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
