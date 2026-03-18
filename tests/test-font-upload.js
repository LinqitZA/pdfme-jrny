/**
 * Test script for Feature #150: Font management upload and validation
 *
 * Tests:
 * 1. Upload valid TTF font — succeeds
 * 2. Upload font with restricted fsType — rejected
 * 3. Upload invalid file format — rejected
 * 4. Upload >10MB font — rejected
 * 5. Verify accepted fonts stored in org fonts directory
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
let PASS = 0;
let FAIL = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-font-test', 'org-font-test', ['template:edit']);

function assert(desc, condition) {
  if (condition) {
    PASS++;
    console.log('  PASS:', desc);
  } else {
    FAIL++;
    console.log('  FAIL:', desc);
  }
}

/**
 * Build a minimal valid TrueType font binary.
 * This creates a minimal font with required tables (head, hhea, maxp, OS/2, name, cmap, post).
 * The OS/2 table includes fsType at offset 8.
 */
function buildMinimalTTF(fsType) {
  // TrueType header: sfVersion(4) + numTables(2) + searchRange(2) + entrySelector(2) + rangeShift(2) = 12 bytes
  const numTables = 7;
  const headerSize = 12;
  const tableRecordSize = 16;
  const tableDirectorySize = numTables * tableRecordSize;
  const dataStart = headerSize + tableDirectorySize;

  // Build table data
  const tables = [];

  // head table (54 bytes minimum)
  const headData = Buffer.alloc(54, 0);
  headData.writeUInt32BE(0x00010000, 0); // version 1.0
  headData.writeUInt32BE(0x00010000, 4); // fontRevision
  headData.writeUInt16BE(0x0001, 44); // indexToLocFormat
  headData.writeUInt16BE(2, 50); // macStyle
  headData.writeUInt16BE(8, 52); // lowestRecPPEM
  tables.push({ tag: 'head', data: headData });

  // hhea table (36 bytes)
  const hheaData = Buffer.alloc(36, 0);
  hheaData.writeUInt32BE(0x00010000, 0); // version
  hheaData.writeInt16BE(800, 4); // ascender
  hheaData.writeInt16BE(-200, 6); // descender
  tables.push({ tag: 'hhea', data: hheaData });

  // maxp table (6 bytes for TrueType)
  const maxpData = Buffer.alloc(6, 0);
  maxpData.writeUInt32BE(0x00005000, 0); // version 0.5
  maxpData.writeUInt16BE(1, 4); // numGlyphs
  tables.push({ tag: 'maxp', data: maxpData });

  // OS/2 table (78 bytes minimum for version 1)
  const os2Data = Buffer.alloc(78, 0);
  os2Data.writeUInt16BE(0x0001, 0); // version
  os2Data.writeInt16BE(500, 2); // xAvgCharWidth
  os2Data.writeUInt16BE(400, 4); // usWeightClass (regular)
  os2Data.writeUInt16BE(5, 6); // usWidthClass (medium)
  os2Data.writeUInt16BE(fsType, 8); // fsType — THIS IS WHAT WE'RE TESTING
  os2Data.writeInt16BE(800, 68); // sTypoAscender
  os2Data.writeInt16BE(-200, 70); // sTypoDescender
  tables.push({ tag: 'OS/2', data: os2Data });

  // name table (minimal - just 1 name record)
  // UTF-16BE encoding (manual swap)
  const nameUtf16le = Buffer.from('TestFont', 'utf16le');
  const nameString = Buffer.alloc(nameUtf16le.length);
  for (let i = 0; i < nameUtf16le.length; i += 2) {
    nameString[i] = nameUtf16le[i + 1];
    nameString[i + 1] = nameUtf16le[i];
  }
  const nameRecordOffset = 6 + 12; // header(6) + 1 record(12)
  const nameData = Buffer.alloc(nameRecordOffset + nameString.length);
  nameData.writeUInt16BE(0, 0); // format
  nameData.writeUInt16BE(1, 2); // count
  nameData.writeUInt16BE(nameRecordOffset, 4); // stringOffset
  // Record: platformID(2) + encodingID(2) + languageID(2) + nameID(2) + length(2) + offset(2)
  nameData.writeUInt16BE(3, 6); // platformID (Windows)
  nameData.writeUInt16BE(1, 8); // encodingID (Unicode BMP)
  nameData.writeUInt16BE(0x0409, 10); // languageID (English)
  nameData.writeUInt16BE(4, 12); // nameID (full name)
  nameData.writeUInt16BE(nameString.length, 14); // length
  nameData.writeUInt16BE(0, 16); // offset
  nameString.copy(nameData, nameRecordOffset);
  tables.push({ tag: 'name', data: nameData });

  // cmap table (minimal - format 0)
  const cmapData = Buffer.alloc(262 + 4, 0);
  cmapData.writeUInt16BE(0, 0); // version
  cmapData.writeUInt16BE(1, 2); // numTables
  // Encoding record
  cmapData.writeUInt16BE(1, 4); // platformID (Mac)
  cmapData.writeUInt16BE(0, 6); // encodingID
  cmapData.writeUInt32BE(12, 8); // offset
  // Format 0 subtable
  cmapData.writeUInt16BE(0, 12); // format
  cmapData.writeUInt16BE(262, 14); // length
  tables.push({ tag: 'cmap', data: cmapData });

  // post table (32 bytes for format 3.0)
  const postData = Buffer.alloc(32, 0);
  postData.writeUInt32BE(0x00030000, 0); // format 3.0
  tables.push({ tag: 'post', data: postData });

  // Calculate offsets
  let currentOffset = dataStart;
  for (const table of tables) {
    table.offset = currentOffset;
    // Pad to 4-byte boundary
    table.paddedLength = Math.ceil(table.data.length / 4) * 4;
    currentOffset += table.paddedLength;
  }

  // Build the font buffer
  const totalSize = currentOffset;
  const font = Buffer.alloc(totalSize, 0);

  // Write header
  font.writeUInt32BE(0x00010000, 0); // sfVersion (TrueType)
  font.writeUInt16BE(numTables, 4);
  // searchRange, entrySelector, rangeShift (not critical for our test)
  font.writeUInt16BE(64, 6);
  font.writeUInt16BE(2, 8);
  font.writeUInt16BE(numTables * 16 - 64, 10);

  // Write table directory
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const offset = headerSize + i * tableRecordSize;
    font.write(t.tag, offset, 'ascii');
    font.writeUInt32BE(0, offset + 4); // checksum (0 for simplicity)
    font.writeUInt32BE(t.offset, offset + 8);
    font.writeUInt32BE(t.data.length, offset + 12);
  }

  // Write table data
  for (const t of tables) {
    t.data.copy(font, t.offset);
  }

  return font;
}

/**
 * Multipart form upload
 */
function uploadFont(filename, buffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----FontTestBoundary' + Date.now();
    const url = new URL('/api/pdfme/fonts/upload', BASE_URL);

    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
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

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
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
    req.end();
  });
}

async function main() {
  console.log('=== Feature #150: Font management upload and validation ===\n');

  // Step 1: Upload valid TTF font — should succeed
  console.log('Step 1: Upload valid TTF font (fsType=0x0000 - installable)...');
  const validTTF = buildMinimalTTF(0x0000); // Installable embedding
  const resp1 = await uploadFont('TestFont-Valid.ttf', validTTF);
  console.log('  Status:', resp1.status);
  if (resp1.status !== 201) console.log('  Body:', JSON.stringify(resp1.body));
  assert('Valid TTF upload returns 201', resp1.status === 201);
  assert('Response has id', !!resp1.body.id);
  assert('Category is font', resp1.body.category === 'font');
  assert('Validation detectedFormat is ttf', resp1.body.validation && resp1.body.validation.detectedFormat === 'ttf');
  assert('Validation valid is true', resp1.body.validation && resp1.body.validation.valid === true);
  assert('fsType allowed', resp1.body.validation && resp1.body.validation.fsType && resp1.body.validation.fsType.allowed === true);
  const validFontId = resp1.body.id;
  console.log('  Font ID:', validFontId);
  console.log('  Storage path:', resp1.body.storagePath);

  // Step 1b: Upload TTF with editable embedding (fsType=0x0008) — should succeed
  console.log('\nStep 1b: Upload TTF with editable embedding (fsType=0x0008)...');
  const editableTTF = buildMinimalTTF(0x0008);
  const resp1b = await uploadFont('TestFont-Editable.ttf', editableTTF);
  assert('Editable TTF upload returns 201', resp1b.status === 201);
  assert('fsType allowed for editable', resp1b.body.validation && resp1b.body.validation.fsType && resp1b.body.validation.fsType.allowed === true);

  // Step 1c: Upload TTF with preview/print embedding (fsType=0x0004) — should succeed
  console.log('\nStep 1c: Upload TTF with preview/print embedding (fsType=0x0004)...');
  const previewTTF = buildMinimalTTF(0x0004);
  const resp1c = await uploadFont('TestFont-Preview.ttf', previewTTF);
  assert('Preview/Print TTF upload returns 201', resp1c.status === 201);

  // Step 2: Upload font with restricted fsType — should be rejected
  console.log('\nStep 2: Upload font with restricted fsType (0x0002)...');
  const restrictedTTF = buildMinimalTTF(0x0002); // Restricted license
  const resp2 = await uploadFont('TestFont-Restricted.ttf', restrictedTTF);
  console.log('  Status:', resp2.status);
  assert('Restricted fsType returns 400', resp2.status === 400);
  assert('Error message mentions restricted', resp2.body.message && resp2.body.message.includes('restricted'));

  // Step 3: Upload invalid file format — should be rejected
  console.log('\nStep 3a: Upload file with wrong extension (.txt)...');
  const invalidExt = Buffer.from('This is not a font file at all');
  const resp3a = await uploadFont('notafont.txt', invalidExt);
  console.log('  Status:', resp3a.status);
  assert('Wrong extension returns 400', resp3a.status === 400);
  assert('Error mentions format', resp3a.body.message && (resp3a.body.message.includes('format') || resp3a.body.message.includes('supported')));

  console.log('\nStep 3b: Upload file with .ttf extension but invalid magic bytes...');
  const fakeTTF = Buffer.alloc(1000, 0xFF); // All 0xFF bytes - not valid TTF
  const resp3b = await uploadFont('fake-font.ttf', fakeTTF);
  console.log('  Status:', resp3b.status);
  assert('Invalid magic bytes returns 400', resp3b.status === 400);
  assert('Error mentions magic bytes', resp3b.body.message && resp3b.body.message.includes('magic bytes'));

  // Step 4: Upload >10MB font — should be rejected
  console.log('\nStep 4: Upload >10MB font...');
  // Build a valid TTF header but pad to >10MB
  const bigTTF = buildMinimalTTF(0x0000);
  const padding = Buffer.alloc(11 * 1024 * 1024, 0); // 11MB padding
  const oversizedFont = Buffer.concat([bigTTF, padding]);
  const resp4 = await uploadFont('TooBig.ttf', oversizedFont);
  console.log('  Status:', resp4.status);
  // Multer will likely return 413 or the server may cut the request
  assert('Oversized font rejected (400 or 413)', resp4.status === 400 || resp4.status === 413);

  // Step 5: Verify accepted fonts stored in org fonts directory
  console.log('\nStep 5: List fonts to verify storage...');
  const listResp = await request('GET', '/api/pdfme/fonts');
  console.log('  Status:', listResp.status);
  console.log('  Font count:', listResp.body.count);
  assert('GET /fonts returns 200', listResp.status === 200);
  assert('At least 3 fonts stored', listResp.body.count >= 3);

  // Check that fonts are in the org fonts directory
  const fontPaths = listResp.body.data;
  const inOrgDir = fontPaths.every((p) => p.startsWith('org-font-test/fonts/'));
  assert('All fonts in org fonts directory', inOrgDir);
  console.log('  Font paths:', fontPaths);

  // Step 5b: Verify font file exists on disk
  const storageRoot = path.join(__dirname, '..', 'storage');
  if (resp1.body.storagePath) {
    const fontPath = path.join(storageRoot, resp1.body.storagePath);
    const exists = fs.existsSync(fontPath);
    assert('Font file exists on disk', exists);
    if (exists) {
      const stat = fs.statSync(fontPath);
      assert('Font file size > 0', stat.size > 0);
    }
  }

  // Summary
  console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===');
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
