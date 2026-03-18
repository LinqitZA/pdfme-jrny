/**
 * Test Feature #373: File storage directory structure correct
 *
 * Verifies the storage directory layout follows the specification:
 * - {orgId}/documents/ exists after render
 * - {orgId}/assets/ exists after upload
 * - {orgId}/fonts/ exists after font upload
 * - {orgId}/signatures/ exists after signature
 * - system/fonts/ exists
 * - tempDir/previews/ exists
 */

const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-storage-373';
const USER_ID = 'user-storage-373';

// Generate JWT token
function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const isMultipart = body && body._multipart;

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let bodyData;
    if (isMultipart) {
      const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      const CRLF = Buffer.from('\r\n');
      const buffers = [];

      for (const [key, val] of Object.entries(body.fields || {})) {
        buffers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
      }
      for (const [key, file] of Object.entries(body.files || {})) {
        buffers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
        buffers.push(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
        buffers.push(CRLF);
      }
      buffers.push(Buffer.from(`--${boundary}--\r\n`));

      bodyData = Buffer.concat(buffers);
      headers['Content-Length'] = bodyData.length;
    } else if (body && !isMultipart) {
      bodyData = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// Create a minimal PNG buffer
function createPngBuffer() {
  // Minimal 1x1 PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(1, 8);  // width
  ihdr.writeUInt32BE(1, 12); // height
  ihdr[16] = 8; // bit depth
  ihdr[17] = 2; // RGB
  const ihdrCrc = crc32(ihdr.subarray(4, 21));
  ihdr.writeInt32BE(ihdrCrc, 21);

  const rawData = Buffer.from([0, 255, 0, 0]); // filter byte + RGB
  const deflated = require('zlib').deflateSync(rawData);
  const idat = Buffer.alloc(deflated.length + 12);
  idat.writeUInt32BE(deflated.length, 0);
  idat.write('IDAT', 4);
  deflated.copy(idat, 8);
  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), deflated]));
  idat.writeInt32BE(idatCrc, deflated.length + 8);

  const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) | 0;
}

// Create a synthetic TTF font with fsType=0x0000 (installable)
function createTtfFont() {
  // Minimal TTF file structure
  const buf = Buffer.alloc(512);
  // TrueType magic
  buf.writeUInt32BE(0x00010000, 0);
  // Number of tables: 1 (OS/2)
  buf.writeUInt16BE(1, 4);
  // Search range, entry selector, range shift
  buf.writeUInt16BE(16, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(16, 10);
  // Table directory entry for OS/2
  buf.write('OS/2', 12);
  buf.writeUInt32BE(0, 16); // checksum
  buf.writeUInt32BE(28, 20); // offset to table data
  buf.writeUInt32BE(78, 24); // length
  // OS/2 table data starting at offset 28
  // version
  buf.writeUInt16BE(4, 28);
  // xAvgCharWidth
  buf.writeInt16BE(500, 30);
  // usWeightClass
  buf.writeUInt16BE(400, 32);
  // usWidthClass
  buf.writeUInt16BE(5, 34);
  // fsType at offset 8 within OS/2 table = offset 36
  buf.writeUInt16BE(0x0000, 36); // Installable embedding
  return buf;
}

let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

async function run() {
  console.log('=== Feature #373: File storage directory structure correct ===\n');

  // Step 1: Check system/fonts/ exists (created on startup)
  console.log('Step 1: Verify system/fonts/ exists');
  {
    const res = await request('GET', '/api/pdfme/health/storage-structure');
    assert(res.status === 200, 'Storage structure endpoint returns 200');
    assert(res.data.structure['system/fonts'].exists === true, 'system/fonts/ directory exists');
    assert(res.data.structure['tempDir/previews'].exists === true, 'tempDir/previews/ directory exists');
  }

  // Step 2: Create a template for rendering
  console.log('\nStep 2: Create template in test org');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      name: 'Storage Test Template 373',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'title',
            type: 'text',
            content: 'Storage Test',
            position: { x: 20, y: 20 },
            width: 100,
            height: 15,
            fontSize: 14,
          }],
          basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        }],
      },
    }, TOKEN);
    assert(res.status === 201, `Template created (status ${res.status})`);
    templateId = res.data.id;
    assert(!!templateId, `Template ID: ${templateId}`);
  }

  // Step 3: Publish the template (required for rendering)
  console.log('\nStep 3: Publish template');
  {
    const res = await request('POST', `/api/pdfme/templates/${templateId}/publish`, {}, TOKEN);
    assert(res.status === 200 || res.status === 201, `Template published (status ${res.status})`);
  }

  // Step 4: Render a document → creates {orgId}/documents/
  console.log('\nStep 4: Render document to create {orgId}/documents/');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      templateId,
      entityType: 'invoice',
      entityId: 'STORAGE-TEST-373',
      channel: 'email',
      inputs: { 'document.number': 'INV-STORAGE-373' },
    }, TOKEN);
    assert(res.status === 200 || res.status === 201 || res.status === 202, `Render succeeded (status ${res.status})`);
    if (res.data.documentId) {
      assert(true, `Document generated: ${res.data.documentId}`);
    }
  }

  // Verify {orgId}/documents/ exists
  console.log('\nStep 5: Verify {orgId}/documents/ exists after render');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    assert(res.status === 200, 'Storage structure check returns 200');
    assert(res.data.structure[`${ORG_ID}/documents`].exists === true, `${ORG_ID}/documents/ directory exists after render`);
  }

  // Step 6: Upload an image asset → creates {orgId}/assets/
  console.log('\nStep 6: Upload image asset to create {orgId}/assets/');
  {
    const pngData = createPngBuffer();
    const res = await request('POST', '/api/pdfme/assets/upload', {
      _multipart: true,
      files: {
        file: {
          filename: 'test-storage-373.png',
          contentType: 'image/png',
          data: pngData,
        },
      },
    }, TOKEN);
    assert(res.status === 201 || res.status === 200, `Asset uploaded (status ${res.status})`);
    if (res.data.category) {
      assert(res.data.category === 'image', `Asset category is image`);
    }
  }

  // Verify {orgId}/assets/ exists
  console.log('\nStep 7: Verify {orgId}/assets/ exists after upload');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    assert(res.data.structure[`${ORG_ID}/assets`].exists === true, `${ORG_ID}/assets/ directory exists after asset upload`);
  }

  // Step 8: Upload a font → creates {orgId}/fonts/
  console.log('\nStep 8: Upload font to create {orgId}/fonts/');
  {
    const ttfData = createTtfFont();
    const res = await request('POST', '/api/pdfme/fonts/upload', {
      _multipart: true,
      files: {
        file: {
          filename: 'test-storage-373.ttf',
          contentType: 'font/ttf',
          data: ttfData,
        },
      },
    }, TOKEN);
    if (res.status !== 201 && res.status !== 200) {
      console.log('  Font upload error:', JSON.stringify(res.data).substring(0, 300));
    }
    assert(res.status === 201 || res.status === 200, `Font uploaded (status ${res.status})`);
    if (res.data.category) {
      assert(res.data.category === 'font', `Asset category is font`);
    }
  }

  // Verify {orgId}/fonts/ exists
  console.log('\nStep 9: Verify {orgId}/fonts/ exists after font upload');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    assert(res.data.structure[`${ORG_ID}/fonts`].exists === true, `${ORG_ID}/fonts/ directory exists after font upload`);
  }

  // Step 10: Upload a signature → creates {orgId}/signatures/
  console.log('\nStep 10: Upload signature to create {orgId}/signatures/');
  {
    const pngData = createPngBuffer();
    const base64Data = 'data:image/png;base64,' + pngData.toString('base64');
    const res = await request('POST', '/api/pdfme/signatures', {
      data: base64Data,
    }, TOKEN);
    assert(res.status === 201 || res.status === 200, `Signature uploaded (status ${res.status})`);
  }

  // Verify {orgId}/signatures/ exists
  console.log('\nStep 11: Verify {orgId}/signatures/ exists after signature upload');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    assert(res.data.structure[`${ORG_ID}/signatures`].exists === true, `${ORG_ID}/signatures/ directory exists after signature upload`);
  }

  // Step 12: Verify complete structure in a single call
  console.log('\nStep 12: Verify complete directory structure');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    assert(res.status === 200, 'Full structure check returns 200');

    const s = res.data.structure;
    assert(s['system/fonts'].exists === true, 'system/fonts/ confirmed');
    assert(s['tempDir/previews'].exists === true, 'tempDir/previews/ confirmed');
    assert(s[`${ORG_ID}/documents`].exists === true, `${ORG_ID}/documents/ confirmed`);
    assert(s[`${ORG_ID}/assets`].exists === true, `${ORG_ID}/assets/ confirmed`);
    assert(s[`${ORG_ID}/fonts`].exists === true, `${ORG_ID}/fonts/ confirmed`);
    assert(s[`${ORG_ID}/signatures`].exists === true, `${ORG_ID}/signatures/ confirmed`);
  }

  // Step 13: Verify a fresh org has no dirs yet
  console.log('\nStep 13: Verify fresh org has no directories');
  {
    const freshOrg = 'org-fresh-never-used-373';
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${freshOrg}`);
    assert(res.data.structure[`${freshOrg}/documents`].exists === false, 'Fresh org has no documents/');
    assert(res.data.structure[`${freshOrg}/assets`].exists === false, 'Fresh org has no assets/');
    assert(res.data.structure[`${freshOrg}/fonts`].exists === false, 'Fresh org has no fonts/');
    assert(res.data.structure[`${freshOrg}/signatures`].exists === false, 'Fresh org has no signatures/');
    // system dirs still exist
    assert(res.data.structure['system/fonts'].exists === true, 'system/fonts/ still exists');
    assert(res.data.structure['tempDir/previews'].exists === true, 'tempDir/previews/ still exists');
  }

  // Step 14: Verify paths use org-level isolation
  console.log('\nStep 14: Verify org-level path isolation');
  {
    const res = await request('GET', `/api/pdfme/health/storage-structure?orgId=${ORG_ID}`);
    const s = res.data.structure;

    // All org paths should contain the orgId
    assert(s[`${ORG_ID}/documents`].path.includes(ORG_ID), 'documents path contains orgId');
    assert(s[`${ORG_ID}/assets`].path.includes(ORG_ID), 'assets path contains orgId');
    assert(s[`${ORG_ID}/fonts`].path.includes(ORG_ID), 'fonts path contains orgId');
    assert(s[`${ORG_ID}/signatures`].path.includes(ORG_ID), 'signatures path contains orgId');

    // system/fonts path should contain 'system'
    assert(s['system/fonts'].path.includes('system'), 'system/fonts path contains system');
    // tempDir/previews path should contain 'tmp' or 'temp'
    assert(s['tempDir/previews'].path.includes('tmp') || s['tempDir/previews'].path.includes('temp'), 'tempDir/previews path contains tmp/temp');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
