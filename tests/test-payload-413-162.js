/**
 * Test for Feature #162: API returns 413 on payload too large
 * Steps:
 * 1. Upload asset exceeding size limit -> 413
 * 2. Verify message mentions size limit
 * 3. Upload font >10MB -> 413
 * 4. Verify 413 response
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function makeJwt(sub = 'test-user-162', orgId = 'org-payload-162') {
  const payload = { sub, orgId, roles: ['user'] };
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

const TOKEN = makeJwt();
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

/**
 * Create a multipart form data buffer for file upload.
 */
function createMultipartBody(fieldName, filename, content) {
  const boundary = '----TestBoundary162' + Date.now();
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBuf = Buffer.from(header);
  const footerBuf = Buffer.from(footer);
  const body = Buffer.concat([headerBuf, content, footerBuf]);

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function run() {
  console.log('=== Feature #162: API returns 413 on payload too large ===\n');

  // Test 1: Upload oversized asset (>10MB) to /assets/upload
  console.log('Test 1: Upload >10MB asset');
  const bigAsset = Buffer.alloc(11 * 1024 * 1024, 0x89); // 11MB
  // Write PNG header so it looks like an image
  bigAsset[0] = 0x89; bigAsset[1] = 0x50; bigAsset[2] = 0x4E; bigAsset[3] = 0x47;
  const { body: assetBody, contentType: assetCT } = createMultipartBody('file', 'huge-image.png', bigAsset);

  const assetRes = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': assetCT,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: assetBody,
  });
  // Multer may reject at file level returning 413 or the server may catch it
  const assetStatus = assetRes.status;
  console.log(`  Asset upload response status: ${assetStatus}`);
  assert(assetStatus === 413, `Oversized asset returns 413 (got ${assetStatus})`);

  if (assetStatus === 413) {
    const assetData = await assetRes.json();
    assert(
      typeof assetData.message === 'string' &&
      (assetData.message.toLowerCase().includes('size') || assetData.message.toLowerCase().includes('large') || assetData.message.toLowerCase().includes('limit')),
      'Asset 413 message mentions size/limit'
    );
  }

  // Test 2: Upload oversized font (>10MB) to /fonts/upload
  console.log('\nTest 2: Upload >10MB font');
  const bigFont = Buffer.alloc(11 * 1024 * 1024, 0x00);
  // TTF magic bytes
  bigFont[0] = 0x00; bigFont[1] = 0x01; bigFont[2] = 0x00; bigFont[3] = 0x00;
  const { body: fontBody, contentType: fontCT } = createMultipartBody('file', 'huge-font.ttf', bigFont);

  const fontRes = await fetch(`${BASE}/fonts/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': fontCT,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: fontBody,
  });
  const fontStatus = fontRes.status;
  console.log(`  Font upload response status: ${fontStatus}`);
  assert(fontStatus === 413, `Oversized font returns 413 (got ${fontStatus})`);

  if (fontStatus === 413) {
    const fontData = await fontRes.json();
    assert(
      typeof fontData.message === 'string' &&
      (fontData.message.toLowerCase().includes('size') || fontData.message.toLowerCase().includes('10mb') || fontData.message.toLowerCase().includes('large') || fontData.message.toLowerCase().includes('limit')),
      'Font 413 message mentions size limit'
    );
    assert(fontData.error === 'Payload Too Large', 'Error is "Payload Too Large"');
  }

  // Test 3: Upload valid-sized asset (under 10MB) works fine
  console.log('\nTest 3: Valid-sized asset upload works');
  // Create a small valid PNG (1x1 pixel)
  const smallPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6260000000060003000160' +
    '0000000049454e44ae426082',
    'hex'
  );
  const { body: smallBody, contentType: smallCT } = createMultipartBody('file', 'small-image.png', smallPng);

  const smallRes = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': smallCT,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: smallBody,
  });
  assert(smallRes.status === 201, `Small asset upload succeeds with 201 (got ${smallRes.status})`);

  // Test 4: Just under 10MB should be accepted
  console.log('\nTest 4: Just under 10MB file');
  const justUnder = Buffer.alloc(9 * 1024 * 1024, 0x89);  // 9MB
  justUnder[0] = 0x89; justUnder[1] = 0x50; justUnder[2] = 0x4E; justUnder[3] = 0x47;
  const { body: underBody, contentType: underCT } = createMultipartBody('file', 'under-10mb.png', justUnder);

  const underRes = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': underCT,
      Authorization: `Bearer ${TOKEN}`,
    },
    body: underBody,
  });
  assert(underRes.status === 201 || underRes.status === 200, `Under 10MB accepted (got ${underRes.status})`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
