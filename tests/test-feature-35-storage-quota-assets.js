/**
 * Feature #35: Storage quota enforcement for assets
 *
 * Steps:
 * 1. Configure low asset quota for test tenant
 * 2. Upload assets until quota exceeded
 * 3. Verify 413 response on quota exceed
 * 4. Verify error mentions asset storage quota
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const roles = ['template:view','template:edit','template:publish','render:trigger','render:bulk','system:seed'];
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now()/1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

const ORG_ID = 'org-asset-quota-35';
const USER_ID = 'user-asset-quota-35';
const TOKEN = makeToken(USER_ID, ORG_ID);

const ORG_ID_B = 'org-asset-quota-35b';
const TOKEN_B = makeToken('user-asset-quota-35b', ORG_ID_B);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Upload a file using multipart/form-data (raw HTTP)
 */
function uploadFile(token, filename, buffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
    const url = new URL('/api/pdfme/assets/upload', BASE);

    // Build multipart body
    const header_part = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(header_part),
      buffer,
      Buffer.from(footer),
    ]);

    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Create a minimal valid PNG (1x1 pixel, ~67 bytes)
function createSmallPng() {
  // Minimal 1x1 white PNG
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c626000000002000198e195280000000049454e44ae426082',
    'hex'
  );
}

// Create a larger PNG-like buffer for quota testing
function createLargeBuffer(sizeBytes) {
  // Start with PNG header then fill with data
  const pngHeader = createSmallPng();
  if (sizeBytes <= pngHeader.length) return pngHeader;
  const buf = Buffer.alloc(sizeBytes);
  pngHeader.copy(buf);
  return buf;
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  \u2713 ' + msg);
  } else {
    failed++;
    console.log('  \u2717 ' + msg);
  }
}

async function setOrgQuota(token, quotaBytes) {
  return await request('PUT', '/api/pdfme/org-settings', token, {
    assetsQuotaBytes: quotaBytes,
  });
}

async function resetOrgSettings(token) {
  return await request('POST', '/api/pdfme/org-settings/reset', token);
}

async function run() {
  console.log('Feature #35: Storage quota enforcement for assets\n');

  // Step 1: Configure very low asset quota
  console.log('Step 1: Configure low asset quota for test tenant');
  const setRes = await setOrgQuota(TOKEN, 100); // 100 bytes
  assert(setRes.status === 200, 'Quota set to 100 bytes (status ' + setRes.status + ')');

  // Step 2: Try upload with quota too small
  console.log('\nStep 2: Upload asset with very low quota (100 bytes)');
  const smallPng = createSmallPng();
  console.log('  PNG size: ' + smallPng.length + ' bytes');
  const uploadRes1 = await uploadFile(TOKEN, 'test-asset-1.png', smallPng);
  // PNG is ~67 bytes but with storage path overhead this may or may not fit in 100 bytes
  // Let's check what happens
  if (uploadRes1.status === 413) {
    assert(true, 'Upload rejected with 413 (quota too low for even a small file)');
    assert(uploadRes1.body.error === 'Payload Too Large', 'Error is "Payload Too Large"');
    assert(
      uploadRes1.body.message && uploadRes1.body.message.toLowerCase().includes('quota'),
      'Error mentions quota: "' + uploadRes1.body.message + '"'
    );
  } else {
    // If first file fits, we need to try to exceed with another upload
    assert(uploadRes1.status === 201, 'First upload succeeded (status ' + uploadRes1.status + ')');

    // Set quota to 1 byte so next upload fails
    await setOrgQuota(TOKEN, 1);
    const uploadRes2 = await uploadFile(TOKEN, 'test-asset-2.png', smallPng);
    assert(uploadRes2.status === 413, 'Second upload rejected with 413 (status ' + uploadRes2.status + ')');
    assert(uploadRes2.body.error === 'Payload Too Large', 'Error is "Payload Too Large"');
    assert(
      uploadRes2.body.message && uploadRes2.body.message.toLowerCase().includes('quota'),
      'Error mentions quota: "' + uploadRes2.body.message + '"'
    );
  }

  // Step 3: Set generous quota and upload successfully
  console.log('\nStep 3: Increase quota - upload succeeds');
  await setOrgQuota(TOKEN, 50 * 1024 * 1024); // 50MB
  const uploadOk = await uploadFile(TOKEN, 'test-asset-ok.png', smallPng);
  assert(uploadOk.status === 201, 'Upload succeeds with generous quota (status ' + uploadOk.status + ')');
  assert(uploadOk.body.id, 'Response has asset id');
  assert(uploadOk.body.category === 'image', 'Category is image');

  // Step 4: Set quota just below current usage + new file
  console.log('\nStep 4: Set quota below usage + new file size');
  await setOrgQuota(TOKEN, 1); // 1 byte, already have files stored
  const uploadFail = await uploadFile(TOKEN, 'test-asset-fail.png', smallPng);
  assert(uploadFail.status === 413, 'Upload rejected when quota is 1 byte (status ' + uploadFail.status + ')');
  assert(uploadFail.body.quotaExceeded === true, 'quotaExceeded flag is true');
  assert(typeof uploadFail.body.currentUsageBytes === 'number', 'currentUsageBytes is a number: ' + uploadFail.body.currentUsageBytes);
  assert(typeof uploadFail.body.quotaBytes === 'number', 'quotaBytes is a number: ' + uploadFail.body.quotaBytes);

  // Step 5: Verify error mentions asset storage quota specifically
  console.log('\nStep 5: Verify error mentions asset storage quota');
  assert(
    uploadFail.body.message && uploadFail.body.message.toLowerCase().includes('asset storage quota'),
    'Error message mentions "asset storage quota": "' + uploadFail.body.message + '"'
  );

  // Step 6: Increase quota again - upload resumes
  console.log('\nStep 6: Increase quota - upload resumes');
  await setOrgQuota(TOKEN, 100 * 1024 * 1024); // 100MB
  const uploadResume = await uploadFile(TOKEN, 'test-asset-resume.png', smallPng);
  assert(uploadResume.status === 201, 'Upload succeeds after quota increase (status ' + uploadResume.status + ')');

  // Step 7: Reset to defaults - should use global default (500MB)
  console.log('\nStep 7: Reset to defaults - uploads work with default quota');
  await resetOrgSettings(TOKEN);
  const uploadDefault = await uploadFile(TOKEN, 'test-asset-default.png', smallPng);
  assert(uploadDefault.status === 201, 'Upload succeeds with default quota (status ' + uploadDefault.status + ')');

  // Step 8: Tenant isolation
  console.log('\nStep 8: Tenant isolation - other org not affected');
  await setOrgQuota(TOKEN, 1); // Restrict org A to 1 byte

  // Org B should be unaffected
  const uploadB = await uploadFile(TOKEN_B, 'test-asset-b.png', smallPng);
  assert(uploadB.status === 201, 'Org B upload succeeds despite Org A quota limit (status ' + uploadB.status + ')');

  // Org A should still be blocked
  const uploadA = await uploadFile(TOKEN, 'test-asset-blocked.png', smallPng);
  assert(uploadA.status === 413, 'Org A still blocked (status ' + uploadA.status + ')');

  // Cleanup
  await resetOrgSettings(TOKEN);

  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ---');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
