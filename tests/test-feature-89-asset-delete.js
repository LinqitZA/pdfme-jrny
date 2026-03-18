/**
 * Feature #89: Asset delete removes file
 *
 * Steps:
 * 1. Upload asset
 * 2. DELETE asset
 * 3. GET returns 404
 * 4. File removed from disk
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'test-asset-delete-org-89';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('asset-delete-user', ORG_ID, ['admin']);
const OTHER_ORG_TOKEN = makeToken('other-user', 'other-org-89', ['admin']);

function request(method, urlPath, body, token, isMultipart) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {},
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    if (isMultipart) {
      const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
      options.headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;

      const fileContent = Buffer.from('FAKE_PNG_CONTENT_' + Date.now());
      const bodyParts = [
        '--' + boundary + '\r\n',
        'Content-Disposition: form-data; name="file"; filename="' + (body.filename || 'test.png') + '"\r\n',
        'Content-Type: image/png\r\n\r\n',
      ];
      const bodyEnd = '\r\n--' + boundary + '--\r\n';
      const bodyBuffer = Buffer.concat([
        Buffer.from(bodyParts.join('')),
        fileContent,
        Buffer.from(bodyEnd),
      ]);
      options.headers['Content-Length'] = bodyBuffer.length;

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    } else {
      if (!isMultipart) options.headers['Content-Type'] = 'application/json';
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      if (body && !isMultipart) req.write(JSON.stringify(body));
      req.end();
    }
  });
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + name);
  } else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}

async function uploadAsset(filename) {
  const result = await request('POST', '/api/pdfme/assets/upload', { filename }, TOKEN, true);
  return result;
}

async function run() {
  console.log('Feature #89: Asset delete removes file\n');

  // Step 1: Upload an asset
  console.log('--- Step 1: Upload asset ---');
  const uploadRes = await uploadAsset('test-delete-89.png');
  assert(uploadRes.status === 201, 'Upload returns 201 Created');
  assert(uploadRes.body.id, 'Upload returns asset ID');
  assert(uploadRes.body.storagePath, 'Upload returns storagePath');
  const assetId = uploadRes.body.id;
  const storagePath = uploadRes.body.storagePath;
  console.log('  Asset ID:', assetId);
  console.log('  Storage path:', storagePath);

  // Verify asset exists via GET
  console.log('\n--- Verify asset exists via GET ---');
  const getRes1 = await request('GET', '/api/pdfme/assets/' + assetId, null, TOKEN);
  assert(getRes1.status === 200, 'GET asset returns 200 before delete');

  // Verify asset appears in list
  const listRes1 = await request('GET', '/api/pdfme/assets', null, TOKEN);
  assert(listRes1.status === 200, 'List assets returns 200');
  const found1 = listRes1.body.data && listRes1.body.data.some(a => a.id === assetId);
  assert(found1, 'Asset appears in list before delete');

  // Verify file exists on disk
  const storageRoot = path.resolve(__dirname, '..', 'storage');
  const diskPath = path.join(storageRoot, storagePath);
  const fileExistsBefore = fs.existsSync(diskPath);
  assert(fileExistsBefore, 'File exists on disk before delete');

  // Step 2: DELETE asset
  console.log('\n--- Step 2: DELETE asset ---');
  const deleteRes = await request('DELETE', '/api/pdfme/assets/' + assetId + '?confirm=true', null, TOKEN);
  assert(deleteRes.status === 200, 'DELETE returns 200');
  assert(deleteRes.body.deleted === true, 'Response has deleted: true');
  assert(deleteRes.body.id === assetId, 'Response has correct asset ID');

  // Step 3: GET returns 404
  console.log('\n--- Step 3: GET returns 404 after delete ---');
  const getRes2 = await request('GET', '/api/pdfme/assets/' + assetId, null, TOKEN);
  assert(getRes2.status === 404, 'GET asset returns 404 after delete');
  assert(getRes2.body.error === 'Not Found', 'Error message is Not Found');

  // Verify asset not in list
  const listRes2 = await request('GET', '/api/pdfme/assets', null, TOKEN);
  const found2 = listRes2.body.data && listRes2.body.data.some(a => a.id === assetId);
  assert(!found2, 'Asset no longer appears in list after delete');

  // Step 4: File removed from disk
  console.log('\n--- Step 4: File removed from disk ---');
  const fileExistsAfter = fs.existsSync(diskPath);
  assert(!fileExistsAfter, 'File no longer exists on disk after delete');

  // Additional tests: DELETE non-existent asset returns 404
  console.log('\n--- Additional: DELETE non-existent asset ---');
  const deleteRes2 = await request('DELETE', '/api/pdfme/assets/' + assetId + '?confirm=true', null, TOKEN);
  assert(deleteRes2.status === 404, 'DELETE already-deleted asset returns 404');

  // Additional: DELETE without auth returns 401
  console.log('\n--- Additional: DELETE without auth ---');
  const deleteNoAuth = await request('DELETE', '/api/pdfme/assets/' + assetId, null, null);
  assert(deleteNoAuth.status === 401, 'DELETE without auth returns 401');

  // Additional: Upload another and delete to confirm repeatable
  console.log('\n--- Additional: Upload second asset and delete ---');
  const upload2 = await uploadAsset('second-delete-89.png');
  assert(upload2.status === 201, 'Second upload returns 201');
  const assetId2 = upload2.body.id;
  const storagePath2 = upload2.body.storagePath;

  const del2 = await request('DELETE', '/api/pdfme/assets/' + assetId2 + '?confirm=true', null, TOKEN);
  assert(del2.status === 200, 'Second DELETE returns 200');
  assert(del2.body.deleted === true, 'Second delete has deleted: true');

  const get3 = await request('GET', '/api/pdfme/assets/' + assetId2, null, TOKEN);
  assert(get3.status === 404, 'Second asset GET returns 404 after delete');

  const diskPath2 = path.join(storageRoot, storagePath2);
  assert(!fs.existsSync(diskPath2), 'Second file removed from disk');

  // Summary
  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
