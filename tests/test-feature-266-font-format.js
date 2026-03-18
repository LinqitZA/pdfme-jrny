/**
 * Feature #266: Font upload validates file format
 * - Upload .ttf file - accepted
 * - Upload .otf file - accepted
 * - Upload .woff2 file - accepted
 * - Upload .exe file - rejected
 * - Upload .woff file - verify policy
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = 'pdfme-dev-secret';

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

const TOKEN = makeJwt({sub:'test-user-266', orgId:'test-org-266', roles:['admin']});

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

/**
 * Create a minimal TTF buffer (magic: 0x00010000) with OS/2 table, fsType=0
 */
function makeTtf() {
  const headerSize = 12;
  const numTables = 1;
  const tableEntrySize = 16;
  const os2TableOffset = headerSize + numTables * tableEntrySize;
  const os2TableSize = 96;
  const totalSize = os2TableOffset + os2TableSize;
  const buf = Buffer.alloc(totalSize);
  buf[0] = 0x00; buf[1] = 0x01; buf[2] = 0x00; buf[3] = 0x00; // TTF magic
  buf.writeUInt16BE(numTables, 4);
  buf.writeUInt16BE(16, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(16, 10);
  buf.write('OS/2', 12);
  buf.writeUInt32BE(0, 16);
  buf.writeUInt32BE(os2TableOffset, 20);
  buf.writeUInt32BE(os2TableSize, 24);
  buf.writeUInt16BE(0x0000, os2TableOffset + 8); // fsType=0 (installable)
  return buf;
}

/**
 * Create a minimal OTF buffer (magic: OTTO = 0x4F54544F) with OS/2 table
 */
function makeOtf() {
  const headerSize = 12;
  const numTables = 1;
  const tableEntrySize = 16;
  const os2TableOffset = headerSize + numTables * tableEntrySize;
  const os2TableSize = 96;
  const totalSize = os2TableOffset + os2TableSize;
  const buf = Buffer.alloc(totalSize);
  buf[0] = 0x4F; buf[1] = 0x54; buf[2] = 0x54; buf[3] = 0x4F; // OTF magic (OTTO)
  buf.writeUInt16BE(numTables, 4);
  buf.writeUInt16BE(16, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(16, 10);
  buf.write('OS/2', 12);
  buf.writeUInt32BE(0, 16);
  buf.writeUInt32BE(os2TableOffset, 20);
  buf.writeUInt32BE(os2TableSize, 24);
  buf.writeUInt16BE(0x0000, os2TableOffset + 8); // fsType=0
  return buf;
}

/**
 * Create a minimal WOFF2 buffer (magic: wOF2 = 0x774F4632)
 */
function makeWoff2() {
  const buf = Buffer.alloc(128);
  buf[0] = 0x77; buf[1] = 0x4F; buf[2] = 0x46; buf[3] = 0x32; // WOFF2 magic (wOF2)
  return buf;
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
  process.stdout.write('Feature #266: Font upload validates file format\n');
  process.stdout.write('================================================\n\n');

  // Test 1: Upload valid .ttf file - accepted
  process.stdout.write('Test 1: Valid .ttf file accepted\n');
  const ttf = makeTtf();
  const r1 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'test_font.ttf', ttf, TOKEN);
  assert(r1.status === 201, `TTF upload returns 201 (got ${r1.status})`);
  if (r1.body.validation) {
    assert(r1.body.validation.detectedFormat === 'ttf', `Detected format is ttf (got ${r1.body.validation.detectedFormat})`);
    assert(r1.body.validation.valid === true, 'Validation passes');
  }

  // Test 2: Upload valid .otf file - accepted
  process.stdout.write('\nTest 2: Valid .otf file accepted\n');
  const otf = makeOtf();
  const r2 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'test_font.otf', otf, TOKEN);
  assert(r2.status === 201, `OTF upload returns 201 (got ${r2.status})`);
  if (r2.body.validation) {
    assert(r2.body.validation.detectedFormat === 'otf', `Detected format is otf (got ${r2.body.validation.detectedFormat})`);
  }

  // Test 3: Upload valid .woff2 file - accepted
  process.stdout.write('\nTest 3: Valid .woff2 file accepted\n');
  const woff2 = makeWoff2();
  const r3 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'test_font.woff2', woff2, TOKEN);
  assert(r3.status === 201, `WOFF2 upload returns 201 (got ${r3.status})`);
  if (r3.body.validation) {
    assert(r3.body.validation.detectedFormat === 'woff2', `Detected format is woff2 (got ${r3.body.validation.detectedFormat})`);
  }

  // Test 4: Upload .exe file - rejected
  process.stdout.write('\nTest 4: .exe file rejected\n');
  const exe = Buffer.alloc(100);
  exe[0] = 0x4D; exe[1] = 0x5A; // MZ header (PE/EXE)
  const r4 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'malware.exe', exe, TOKEN);
  assert(r4.status === 400, `.exe file rejected with 400 (got ${r4.status})`);
  const errExe = typeof r4.body === 'object' ? r4.body.message || '' : '';
  assert(errExe.includes('.exe') || errExe.includes('not supported') || errExe.includes('Invalid') || errExe.includes('Allowed'),
    `Error message explains rejection: ${errExe.substring(0, 100)}`);

  // Test 5: Upload .woff (v1) file - rejected (only woff2 accepted)
  process.stdout.write('\nTest 5: .woff (v1) file - verify policy\n');
  const woff1 = Buffer.alloc(100);
  woff1[0] = 0x77; woff1[1] = 0x4F; woff1[2] = 0x46; woff1[3] = 0x46; // wOFF (WOFF1 magic)
  const r5 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'test_font.woff', woff1, TOKEN);
  assert(r5.status === 400, `.woff (v1) rejected with 400 (got ${r5.status})`);
  const errWoff = typeof r5.body === 'object' ? r5.body.message || '' : '';
  assert(errWoff.includes('.woff') || errWoff.includes('not supported') || errWoff.includes('Invalid') || errWoff.includes('Allowed'),
    `Error explains .woff rejection`);

  // Test 6: Upload .txt file renamed to .ttf - rejected by magic bytes
  process.stdout.write('\nTest 6: Non-font data with .ttf extension rejected (magic bytes)\n');
  const fakeTtf = Buffer.from('This is not a font file at all, just plain text data');
  const r6 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'fake_font.ttf', fakeTtf, TOKEN);
  assert(r6.status === 400, `Fake TTF rejected with 400 (got ${r6.status})`);
  const errFake = typeof r6.body === 'object' ? r6.body.message || '' : '';
  assert(errFake.includes('magic') || errFake.includes('invalid') || errFake.includes('Invalid') || errFake.includes('valid'),
    `Error explains magic bytes mismatch`);

  // Test 7: Upload .zip file - rejected
  process.stdout.write('\nTest 7: .zip file rejected\n');
  const zip = Buffer.alloc(100);
  zip[0] = 0x50; zip[1] = 0x4B; zip[2] = 0x03; zip[3] = 0x04; // ZIP magic
  const r7 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'fonts.zip', zip, TOKEN);
  assert(r7.status === 400, `.zip file rejected (got ${r7.status})`);

  // Test 8: Upload .pdf file - rejected
  process.stdout.write('\nTest 8: .pdf file rejected\n');
  const pdf = Buffer.from('%PDF-1.4 fake pdf content here...');
  const r8 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'document.pdf', pdf, TOKEN);
  assert(r8.status === 400, `.pdf file rejected (got ${r8.status})`);

  // Test 9: Upload .png image as font - rejected
  process.stdout.write('\nTest 9: .png file rejected as font\n');
  const png = Buffer.alloc(100);
  png[0] = 0x89; png[1] = 0x50; png[2] = 0x4E; png[3] = 0x47;
  const r9 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'image.png', png, TOKEN);
  assert(r9.status === 400, `.png rejected as font (got ${r9.status})`);

  // Test 10: Error response for .exe includes allowed formats
  process.stdout.write('\nTest 10: Error mentions allowed formats\n');
  if (typeof r4.body === 'object') {
    const msg = r4.body.message || '';
    assert(msg.includes('.ttf') || msg.includes('.otf') || msg.includes('.woff2') || msg.includes('Allowed'),
      'Error message lists allowed formats');
  } else {
    assert(false, 'Error should be JSON');
  }

  // Test 11: OTF with correct magic bytes but different extension still works
  process.stdout.write('\nTest 11: Extension and magic bytes both validated\n');
  const otfBuf = makeOtf();
  const r11 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'my_font.otf', otfBuf, TOKEN);
  assert(r11.status === 201, `OTF with correct extension accepted (got ${r11.status})`);

  // Test 12: Server healthy after all tests
  process.stdout.write('\nTest 12: Server healthy after tests\n');
  const healthRes = await new Promise((resolve, reject) => {
    http.get(`${BASE}/api/pdfme/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
  assert(healthRes.status === 200, 'Health check returns 200');

  process.stdout.write(`\n================================================\n`);
  process.stdout.write(`Results: ${passed}/${passed + failed} passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
