/**
 * Feature #20: Tenant isolation - assets scoped to orgId
 *
 * Verifies that asset uploads and listings are tenant-isolated:
 * 1. Upload asset with org-A JWT
 * 2. Upload asset with org-B JWT
 * 3. GET /api/pdfme/assets with org-A - only org-A assets
 * 4. Attempt to access org-B asset with org-A JWT returns 404
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function makeToken(orgId, sub) {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'user-' + orgId,
    orgId: orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function requestJson(method, path, token) {
  return new Promise(function(resolve, reject) {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        let parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function uploadFile(path, token, filename, buffer, contentType) {
  return new Promise(function(resolve, reject) {
    const boundary = '----FormBoundary' + Date.now();
    const url = new URL(BASE + path);

    // Build multipart body
    const parts = [];
    parts.push('--' + boundary + '\r\n');
    parts.push('Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n');
    parts.push('Content-Type: ' + contentType + '\r\n\r\n');

    const header = Buffer.from(parts.join(''));
    const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([header, buffer, footer]);

    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(opts, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        let parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write('  ✅ ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  ❌ ' + name + '\n');
  }
}

// Create a minimal valid PNG (1x1 pixel)
function createMinimalPng() {
  // Minimal valid 1x1 red PNG
  const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c49444154789c6260f80f0000010100005018d84d0000000049454e44ae426082';
  return Buffer.from(pngHex, 'hex');
}

async function run() {
  process.stdout.write('=== Feature #20: Tenant isolation - assets scoped to orgId ===\n\n');

  const TS = Date.now();
  const ORG_A = 'org-asset-A-' + TS;
  const ORG_B = 'org-asset-B-' + TS;
  const TOKEN_A = makeToken(ORG_A, 'user-A-20');
  const TOKEN_B = makeToken(ORG_B, 'user-B-20');

  const pngBuffer = createMinimalPng();

  // Step 1: Upload asset with org-A JWT
  process.stdout.write('Step 1: Upload asset with org-A JWT\n');
  const uploadA = await uploadFile('/api/pdfme/assets/upload', TOKEN_A, 'logo-orgA.png', pngBuffer, 'image/png');
  assert('Org-A upload returns 201', uploadA.status === 201);
  assert('Org-A upload has id', !!uploadA.data.id);
  assert('Org-A upload has orgId', uploadA.data.orgId === ORG_A);
  assert('Org-A upload category is image', uploadA.data.category === 'image');
  const assetIdA = uploadA.data.id;
  const storagePathA = uploadA.data.storagePath;

  // Step 2: Upload asset with org-B JWT
  process.stdout.write('\nStep 2: Upload asset with org-B JWT\n');
  const uploadB = await uploadFile('/api/pdfme/assets/upload', TOKEN_B, 'logo-orgB.png', pngBuffer, 'image/png');
  assert('Org-B upload returns 201', uploadB.status === 201);
  assert('Org-B upload has id', !!uploadB.data.id);
  assert('Org-B upload has orgId', uploadB.data.orgId === ORG_B);
  const assetIdB = uploadB.data.id;
  const storagePathB = uploadB.data.storagePath;

  // Step 3: GET /api/pdfme/assets with org-A - only org-A assets
  process.stdout.write('\nStep 3: Org-A asset list shows only org-A assets\n');
  const listA = await requestJson('GET', '/api/pdfme/assets', TOKEN_A);
  assert('Org-A list returns 200', listA.status === 200);
  assert('Org-A list has data array', Array.isArray(listA.data.data));

  const orgAAssets = listA.data.data || [];
  const orgAHasOwnAsset = orgAAssets.some(function(f) { return f.includes(assetIdA); });
  const orgAHasOtherAsset = orgAAssets.some(function(f) { return f.includes(assetIdB); });
  assert('Org-A list contains own asset', orgAHasOwnAsset);
  assert('Org-A list does NOT contain org-B asset', !orgAHasOtherAsset);

  // Step 4: GET /api/pdfme/assets with org-B - only org-B assets
  process.stdout.write('\nStep 4: Org-B asset list shows only org-B assets\n');
  const listB = await requestJson('GET', '/api/pdfme/assets', TOKEN_B);
  assert('Org-B list returns 200', listB.status === 200);

  const orgBAssets = listB.data.data || [];
  const orgBHasOwnAsset = orgBAssets.some(function(f) { return f.includes(assetIdB); });
  const orgBHasOtherAsset = orgBAssets.some(function(f) { return f.includes(assetIdA); });
  assert('Org-B list contains own asset', orgBHasOwnAsset);
  assert('Org-B list does NOT contain org-A asset', !orgBHasOtherAsset);

  // Step 5: Attempt to access org-B asset with org-A JWT returns 404
  process.stdout.write('\nStep 5: Cross-tenant asset access blocked\n');
  const crossAccess = await requestJson('GET', '/api/pdfme/assets/' + assetIdB, TOKEN_A);
  assert('Org-A cannot access org-B asset (404)', crossAccess.status === 404);

  const crossAccess2 = await requestJson('GET', '/api/pdfme/assets/' + assetIdA, TOKEN_B);
  assert('Org-B cannot access org-A asset (404)', crossAccess2.status === 404);

  // Step 6: Same-tenant asset access works
  process.stdout.write('\nStep 6: Same-tenant asset access works\n');
  const ownAccess = await requestJson('GET', '/api/pdfme/assets/' + assetIdA, TOKEN_A);
  assert('Org-A can access own asset (200)', ownAccess.status === 200);

  const ownAccessB = await requestJson('GET', '/api/pdfme/assets/' + assetIdB, TOKEN_B);
  assert('Org-B can access own asset (200)', ownAccessB.status === 200);

  // Step 7: Cross-tenant asset deletion blocked
  process.stdout.write('\nStep 7: Cross-tenant asset deletion blocked\n');
  const crossDelete = await requestJson('DELETE', '/api/pdfme/assets/' + assetIdB + '?confirm=true', TOKEN_A);
  assert('Org-A cannot delete org-B asset (404)', crossDelete.status === 404);

  // Verify org-B asset still exists after cross-tenant delete attempt
  const stillExistsB = await requestJson('GET', '/api/pdfme/assets/' + assetIdB, TOKEN_B);
  assert('Org-B asset still exists after cross-delete attempt', stillExistsB.status === 200);

  // Step 8: Same-tenant asset deletion works
  process.stdout.write('\nStep 8: Same-tenant asset deletion works\n');
  const deleteA = await requestJson('DELETE', '/api/pdfme/assets/' + assetIdA + '?confirm=true', TOKEN_A);
  assert('Org-A can delete own asset', deleteA.status === 200 && deleteA.data.deleted === true);

  // Verify org-A asset is gone
  const goneA = await requestJson('GET', '/api/pdfme/assets/' + assetIdA, TOKEN_A);
  assert('Org-A asset gone after deletion (404)', goneA.status === 404);

  // Verify org-B asset unaffected by org-A deletion
  const unaffectedB = await requestJson('GET', '/api/pdfme/assets/' + assetIdB, TOKEN_B);
  assert('Org-B asset unaffected by org-A deletion', unaffectedB.status === 200);

  // Step 9: Upload multiple assets and verify isolation
  process.stdout.write('\nStep 9: Multiple assets maintain isolation\n');
  const uploadA2 = await uploadFile('/api/pdfme/assets/upload', TOKEN_A, 'icon-orgA.png', pngBuffer, 'image/png');
  assert('Org-A second upload succeeds', uploadA2.status === 201);
  const assetIdA2 = uploadA2.data.id;

  const listA2 = await requestJson('GET', '/api/pdfme/assets', TOKEN_A);
  const orgA2Assets = listA2.data.data || [];
  const a2HasNew = orgA2Assets.some(function(f) { return f.includes(assetIdA2); });
  const a2HasBAsset = orgA2Assets.some(function(f) { return f.includes(assetIdB); });
  assert('Org-A list includes new asset', a2HasNew);
  assert('Org-A list still excludes org-B assets', !a2HasBAsset);

  // Cleanup: delete test asset from org-B
  await requestJson('DELETE', '/api/pdfme/assets/' + assetIdB + '?confirm=true', TOKEN_B);
  await requestJson('DELETE', '/api/pdfme/assets/' + assetIdA2 + '?confirm=true', TOKEN_A);

  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
