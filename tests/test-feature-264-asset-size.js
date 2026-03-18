/**
 * Feature #264: Asset upload validates file size
 * - Files exceeding limit rejected
 * - Upload image >10MB (configured limit) -> 413 or 400
 * - Upload image within limit -> succeeds
 * - Verify specific size limit in error message
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = 'pdfme-dev-secret';

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

const TOKEN = makeJwt({sub:'test-user-264', orgId:'test-org-264', roles:['admin']});

function multipartUpload(url, filename, buffer, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
    const hdr = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([hdr, buffer, footer]);

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg}\n`);
  }
}

async function run() {
  process.stdout.write('Feature #264: Asset upload validates file size\n');
  process.stdout.write('==============================================\n\n');

  // Test 1: Small file upload (100 bytes) succeeds
  process.stdout.write('Test 1: Small image upload succeeds\n');
  const smallPng = Buffer.alloc(100);
  smallPng[0] = 0x89; smallPng[1] = 0x50; smallPng[2] = 0x4E; smallPng[3] = 0x47;
  const r1 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'small_test.png', smallPng, TOKEN);
  assert(r1.status === 201, `Small upload returns 201 (got ${r1.status})`);
  assert(r1.body.id, 'Small upload returns asset ID');
  assert(r1.body.category === 'image', 'Small upload has category image');
  assert(r1.body.size === 100, `Small upload reports correct size (got ${r1.body.size})`);

  // Test 2: 1KB file succeeds
  process.stdout.write('\nTest 2: 1KB file upload succeeds\n');
  const kb1 = Buffer.alloc(1024);
  kb1[0] = 0x89; kb1[1] = 0x50; kb1[2] = 0x4E; kb1[3] = 0x47;
  const r2 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'tiny_1kb.png', kb1, TOKEN);
  assert(r2.status === 201, `1KB upload returns 201 (got ${r2.status})`);

  // Test 3: 5MB file succeeds (well within limit)
  process.stdout.write('\nTest 3: 5MB file succeeds (within limit)\n');
  const mb5 = Buffer.alloc(5 * 1024 * 1024);
  mb5[0] = 0x89; mb5[1] = 0x50; mb5[2] = 0x4E; mb5[3] = 0x47;
  const r3 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'medium_5mb.png', mb5, TOKEN);
  assert(r3.status === 201, `5MB upload returns 201 (got ${r3.status})`);
  assert(r3.body.size === 5 * 1024 * 1024, `Reports 5MB size correctly`);

  // Test 4: 9MB file succeeds (just under limit)
  process.stdout.write('\nTest 4: 9MB file succeeds (under limit)\n');
  const mb9 = Buffer.alloc(9 * 1024 * 1024);
  mb9[0] = 0x89; mb9[1] = 0x50; mb9[2] = 0x4E; mb9[3] = 0x47;
  const r4 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'large_9mb.png', mb9, TOKEN);
  assert(r4.status === 201, `9MB upload returns 201 (got ${r4.status})`);

  // Test 5: 11MB file rejected with 413
  process.stdout.write('\nTest 5: Oversized file (11MB) rejected\n');
  const mb11 = Buffer.alloc(11 * 1024 * 1024);
  mb11[0] = 0x89; mb11[1] = 0x50; mb11[2] = 0x4E; mb11[3] = 0x47;
  const r5 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'large_11mb.png', mb11, TOKEN);
  assert(r5.status === 413 || r5.status === 400, `11MB upload rejected (got ${r5.status})`);

  // Test 6: 15MB file rejected
  process.stdout.write('\nTest 6: Very large file (15MB) rejected\n');
  const mb15 = Buffer.alloc(15 * 1024 * 1024);
  mb15[0] = 0x89; mb15[1] = 0x50; mb15[2] = 0x4E; mb15[3] = 0x47;
  const r6 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'huge_15mb.png', mb15, TOKEN);
  assert(r6.status === 413 || r6.status === 400, `15MB upload rejected (got ${r6.status})`);

  // Test 7: Error message mentions specific size limit
  process.stdout.write('\nTest 7: Error message mentions size limit\n');
  const errMsg = typeof r5.body === 'object' ? JSON.stringify(r5.body) : String(r5.body);
  assert(errMsg.includes('10MB') || errMsg.includes('10 MB') || errMsg.includes('size'),
    `Error message includes size limit info`);

  // Test 8: Error response includes maxSize field
  process.stdout.write('\nTest 8: Error response includes maxSize field\n');
  if (typeof r5.body === 'object') {
    assert(r5.body.maxSize === '10MB' || (r5.body.message && r5.body.message.includes('10MB')),
      `Error response includes max size (maxSize=${r5.body.maxSize})`);
  } else {
    assert(false, 'Error response should be JSON');
  }

  // Test 9: Error response has correct status code field
  process.stdout.write('\nTest 9: Error response structure\n');
  if (typeof r5.body === 'object') {
    assert(r5.body.statusCode === 413, `Error has statusCode=413 (got ${r5.body.statusCode})`);
    assert(r5.body.message && r5.body.message.length > 5, 'Error has descriptive message');
  } else {
    assert(false, 'Error response should be JSON');
  }

  // Test 10: Server still healthy after rejections
  process.stdout.write('\nTest 10: Server healthy after oversized uploads\n');
  const healthRes = await new Promise((resolve, reject) => {
    http.get(`${BASE}/api/pdfme/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
  assert(healthRes.status === 200, 'Health check returns 200');
  assert(healthRes.body.status === 'ok', 'Server reports ok status');

  // Test 11: Normal upload still works after rejection
  process.stdout.write('\nTest 11: Normal upload works after rejection\n');
  const afterReject = Buffer.alloc(200);
  afterReject[0] = 0x89; afterReject[1] = 0x50; afterReject[2] = 0x4E; afterReject[3] = 0x47;
  const r11 = await multipartUpload(`${BASE}/api/pdfme/assets/upload`, 'after_reject.png', afterReject, TOKEN);
  assert(r11.status === 201, `Upload after rejection succeeds (got ${r11.status})`);

  process.stdout.write(`\n==============================================\n`);
  process.stdout.write(`Results: ${passed}/${passed + failed} passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
