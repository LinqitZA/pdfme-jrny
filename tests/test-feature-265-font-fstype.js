/**
 * Feature #265: Font upload validates fsType flag
 * - Upload font with fsType=0 (installable) - accepted
 * - Upload font with fsType=4 (preview/print) - accepted
 * - Upload font with restricted fsType - rejected
 * - Verify error explains fsType requirement
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

const TOKEN = makeJwt({sub:'test-user-265', orgId:'test-org-265', roles:['admin']});

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
 * Create a minimal valid TTF-like buffer with a specific fsType in the OS/2 table.
 * This creates enough structure for the font controller's magic bytes and fsType parsing.
 *
 * TTF structure:
 * - Offset 0-3: Magic bytes (0x00010000 for TrueType)
 * - Offset 4-5: numTables (UInt16BE)
 * - Offset 6-11: searchRange, entrySelector, rangeShift (UInt16BE each)
 * - Offset 12+: Table directory entries (16 bytes each: tag[4], checksum[4], offset[4], length[4])
 * - Then the OS/2 table data with fsType at offset 8 within the table
 */
function makeTtfWithFsType(fsType) {
  // We need: header (12 bytes) + 1 table entry (16 bytes) + OS/2 table data
  const headerSize = 12;
  const numTables = 1;
  const tableEntrySize = 16;
  const os2TableOffset = headerSize + numTables * tableEntrySize; // 12 + 16 = 28
  const os2TableSize = 96; // Minimal OS/2 table
  const totalSize = os2TableOffset + os2TableSize;

  const buf = Buffer.alloc(totalSize);

  // TTF magic bytes
  buf[0] = 0x00; buf[1] = 0x01; buf[2] = 0x00; buf[3] = 0x00;

  // numTables = 1
  buf.writeUInt16BE(numTables, 4);

  // searchRange, entrySelector, rangeShift (don't matter for validation)
  buf.writeUInt16BE(16, 6);  // searchRange
  buf.writeUInt16BE(0, 8);   // entrySelector
  buf.writeUInt16BE(16, 10); // rangeShift

  // Table directory entry for OS/2
  buf.write('OS/2', os2TableOffset - tableEntrySize); // Actually at offset 12
  buf.write('OS/2', 12); // tag at offset 12
  buf.writeUInt32BE(0, 16); // checksum
  buf.writeUInt32BE(os2TableOffset, 20); // offset to OS/2 table data
  buf.writeUInt32BE(os2TableSize, 24); // length

  // OS/2 table: fsType is at offset 8 within the table
  buf.writeUInt16BE(fsType, os2TableOffset + 8);

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
  process.stdout.write('Feature #265: Font upload validates fsType flag\n');
  process.stdout.write('================================================\n\n');

  // Test 1: fsType=0 (installable embedding - most permissive) - accepted
  process.stdout.write('Test 1: fsType=0 (installable) accepted\n');
  const font0 = makeTtfWithFsType(0x0000);
  const r1 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'installable.ttf', font0, TOKEN);
  assert(r1.status === 201, `fsType=0 returns 201 (got ${r1.status})`);
  if (r1.body.validation) {
    assert(r1.body.validation.fsType.allowed === true, 'fsType=0 marked as allowed');
    assert(r1.body.validation.fsType.value === 0, `fsType value is 0 (got ${r1.body.validation.fsType.value})`);
    assert(r1.body.validation.valid === true, 'Validation marked as valid');
  } else {
    assert(r1.body.id, 'Upload returns asset ID');
  }

  // Test 2: fsType=4 (preview/print embedding) - accepted
  process.stdout.write('\nTest 2: fsType=4 (preview/print) accepted\n');
  const font4 = makeTtfWithFsType(0x0004);
  const r2 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'preview_print.ttf', font4, TOKEN);
  assert(r2.status === 201, `fsType=4 returns 201 (got ${r2.status})`);
  if (r2.body.validation) {
    assert(r2.body.validation.fsType.allowed === true, 'fsType=4 marked as allowed');
    assert(r2.body.validation.fsType.value === 4, `fsType value is 4 (got ${r2.body.validation.fsType.value})`);
  }

  // Test 3: fsType=8 (editable embedding) - accepted
  process.stdout.write('\nTest 3: fsType=8 (editable) accepted\n');
  const font8 = makeTtfWithFsType(0x0008);
  const r3 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'editable.ttf', font8, TOKEN);
  assert(r3.status === 201, `fsType=8 returns 201 (got ${r3.status})`);
  if (r3.body.validation) {
    assert(r3.body.validation.fsType.allowed === true, 'fsType=8 marked as allowed');
  }

  // Test 4: fsType=2 (restricted license) - rejected
  process.stdout.write('\nTest 4: fsType=2 (restricted) rejected\n');
  const font2 = makeTtfWithFsType(0x0002);
  const r4 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'restricted.ttf', font2, TOKEN);
  assert(r4.status === 400, `fsType=2 returns 400 (got ${r4.status})`);

  // Test 5: Error message explains fsType requirement
  process.stdout.write('\nTest 5: Error explains fsType requirement\n');
  const errMsg = typeof r4.body === 'object' ? JSON.stringify(r4.body) : String(r4.body);
  assert(errMsg.includes('fsType') || errMsg.includes('embedding') || errMsg.includes('restricted'),
    `Error mentions fsType/embedding restriction`);
  assert(errMsg.includes('0002') || errMsg.includes('0x0002'),
    `Error includes the actual fsType value`);

  // Test 6: Error message mentions PDF generation restriction
  process.stdout.write('\nTest 6: Error mentions PDF usage restriction\n');
  if (typeof r4.body === 'object' && r4.body.message) {
    assert(r4.body.message.includes('PDF') || r4.body.message.includes('embed') || r4.body.message.includes('document'),
      `Error explains font cannot be used for PDF generation`);
  } else {
    assert(errMsg.includes('PDF') || errMsg.includes('embed'), 'Error explains PDF restriction');
  }

  // Test 7: fsType with bit 1 set but also bit 2 (preview overrides restriction) - accepted
  process.stdout.write('\nTest 7: fsType=6 (restricted+preview, preview overrides) accepted\n');
  const font6 = makeTtfWithFsType(0x0006); // bits 1+2 = restricted + preview/print
  const r7 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'mixed_flags.ttf', font6, TOKEN);
  assert(r7.status === 201, `fsType=6 accepted (preview overrides restricted) (got ${r7.status})`);

  // Test 8: fsType with only bit 1 (restricted, no preview/editable) - rejected
  process.stdout.write('\nTest 8: fsType=0x0002 only restricted bit set - rejected\n');
  const fontRestrOnly = makeTtfWithFsType(0x0002);
  const r8 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'restricted_only.ttf', fontRestrOnly, TOKEN);
  assert(r8.status === 400, `Pure restricted font rejected (got ${r8.status})`);

  // Test 9: fsType=0x0100 (no subsetting, but not restricted) - accepted
  process.stdout.write('\nTest 9: fsType=0x0100 (no subsetting) accepted\n');
  const fontNoSub = makeTtfWithFsType(0x0100);
  const r9 = await multipartUpload(`${BASE}/api/pdfme/fonts/upload`, 'no_subsetting.ttf', fontNoSub, TOKEN);
  assert(r9.status === 201, `fsType=0x0100 accepted (got ${r9.status})`);

  // Test 10: Validation response includes fsType details for accepted font
  process.stdout.write('\nTest 10: Validation response includes fsType details\n');
  if (r1.body.validation) {
    assert(r1.body.validation.detectedFormat === 'ttf', `Detected format is ttf`);
    assert(typeof r1.body.validation.fsType === 'object', 'fsType info is object');
    assert(typeof r1.body.validation.fsType.description === 'string', 'fsType has description');
    assert(r1.body.validation.fsType.description.length > 0, 'fsType description is non-empty');
  } else {
    assert(false, 'Expected validation object in response');
  }

  // Test 11: Server healthy after all tests
  process.stdout.write('\nTest 11: Server healthy after tests\n');
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
