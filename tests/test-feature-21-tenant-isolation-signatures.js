/**
 * Feature #21: Tenant isolation - signatures scoped to orgId and userId
 *
 * Verifies that signatures are private to user within their org:
 * 1. Upload signature with org-A user-1 JWT
 * 2. GET /api/pdfme/signatures/me with org-A user-1 returns signature
 * 3. GET /api/pdfme/signatures/me with org-A user-2 returns empty
 * 4. GET /api/pdfme/signatures/me with org-B user-1 returns empty
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
    sub: sub,
    orgId: orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, path, token, body) {
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
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
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

// Create a minimal valid PNG as base64 data URL
function createPngDataUrl() {
  const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c49444154789c6260f80f0000010100005018d84d0000000049454e44ae426082';
  const buf = Buffer.from(pngHex, 'hex');
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function run() {
  process.stdout.write('=== Feature #21: Tenant isolation - signatures scoped to orgId and userId ===\n\n');

  const TS = Date.now();
  const ORG_A = 'org-sig-A-' + TS;
  const ORG_B = 'org-sig-B-' + TS;
  const USER_1 = 'user1-sig-' + TS;
  const USER_2 = 'user2-sig-' + TS;

  const TOKEN_A_U1 = makeToken(ORG_A, USER_1);
  const TOKEN_A_U2 = makeToken(ORG_A, USER_2);
  const TOKEN_B_U1 = makeToken(ORG_B, USER_1);  // Same userId but different org

  const pngData = createPngDataUrl();

  // Step 1: Upload signature with org-A user-1 JWT
  process.stdout.write('Step 1: Upload signature with org-A user-1\n');
  const upload = await request('POST', '/api/pdfme/signatures', TOKEN_A_U1, { data: pngData });
  assert('Signature upload returns 201', upload.status === 201);
  assert('Upload has id', !!upload.data.id);
  assert('Upload has correct orgId', upload.data.orgId === ORG_A);
  assert('Upload has correct userId', upload.data.userId === USER_1);
  assert('Upload has filePath', !!upload.data.filePath);
  assert('Upload has capturedAt', !!upload.data.capturedAt);

  // Step 2: GET /api/pdfme/signatures/me with org-A user-1 returns signature
  process.stdout.write('\nStep 2: Org-A user-1 can see own signature\n');
  const getOwn = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('Get own signature returns 200', getOwn.status === 200);
  assert('Signature has correct userId', getOwn.data.userId === USER_1);
  assert('Signature has correct orgId', getOwn.data.orgId === ORG_A);
  assert('Signature has id', !!getOwn.data.id);

  // Step 3: GET /api/pdfme/signatures/me with org-A user-2 returns 404 (no signature)
  process.stdout.write('\nStep 3: Org-A user-2 cannot see user-1 signature\n');
  const getOther = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U2);
  assert('Org-A user-2 gets 404 (no signature)', getOther.status === 404);

  // Step 4: GET /api/pdfme/signatures/me with org-B user-1 returns 404
  // (same userId but different org - should NOT see org-A signature)
  process.stdout.write('\nStep 4: Org-B user-1 (same userId) cannot see org-A signature\n');
  const getCrossOrg = await request('GET', '/api/pdfme/signatures/me', TOKEN_B_U1);
  assert('Org-B user-1 gets 404 (different org)', getCrossOrg.status === 404);

  // Step 5: Upload signature for org-A user-2 and verify isolation
  process.stdout.write('\nStep 5: Upload and verify user-2 signature isolation\n');
  const upload2 = await request('POST', '/api/pdfme/signatures', TOKEN_A_U2, { data: pngData });
  assert('User-2 signature upload returns 201', upload2.status === 201);
  assert('User-2 upload has correct userId', upload2.data.userId === USER_2);

  // Both users in same org can see their own signatures
  const getU1Again = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('User-1 still sees own signature', getU1Again.status === 200 && getU1Again.data.userId === USER_1);

  const getU2 = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U2);
  assert('User-2 sees own signature', getU2.status === 200 && getU2.data.userId === USER_2);

  // Step 6: Upload signature for org-B user-1 and verify org isolation
  process.stdout.write('\nStep 6: Upload org-B user-1 signature and verify org isolation\n');
  const uploadB = await request('POST', '/api/pdfme/signatures', TOKEN_B_U1, { data: pngData });
  assert('Org-B user-1 signature upload returns 201', uploadB.status === 201);
  assert('Org-B upload has correct orgId', uploadB.data.orgId === ORG_B);

  // Org-B user-1 sees their own signature (not org-A user-1)
  const getBU1 = await request('GET', '/api/pdfme/signatures/me', TOKEN_B_U1);
  assert('Org-B user-1 sees own signature', getBU1.status === 200);
  assert('Org-B signature has correct orgId', getBU1.data.orgId === ORG_B);

  // Org-A user-1 still sees their org-A signature (not org-B one)
  const getAU1Again = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('Org-A user-1 still sees org-A signature', getAU1Again.status === 200 && getAU1Again.data.orgId === ORG_A);

  // Step 7: Revoke org-A user-1 signature doesn't affect others
  process.stdout.write('\nStep 7: Revoking one signature does not affect others\n');
  const revoke = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('Revoke org-A user-1 returns 200', revoke.status === 200);

  // Org-A user-1 no longer has a signature
  const getRevoked = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('Org-A user-1 signature gone after revoke (404)', getRevoked.status === 404);

  // Org-A user-2 signature unaffected
  const getU2After = await request('GET', '/api/pdfme/signatures/me', TOKEN_A_U2);
  assert('Org-A user-2 signature unaffected', getU2After.status === 200 && getU2After.data.userId === USER_2);

  // Org-B user-1 signature unaffected
  const getBU1After = await request('GET', '/api/pdfme/signatures/me', TOKEN_B_U1);
  assert('Org-B user-1 signature unaffected', getBU1After.status === 200 && getBU1After.data.orgId === ORG_B);

  // Step 8: Cross-org revoke doesn't work
  process.stdout.write('\nStep 8: Cross-org revoke does not work\n');
  const crossRevoke = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A_U1);
  assert('Cross-org revoke returns 404 (no signature for this user/org)', crossRevoke.status === 404);

  // Org-B user-1 signature still exists
  const getBFinal = await request('GET', '/api/pdfme/signatures/me', TOKEN_B_U1);
  assert('Org-B user-1 signature still exists', getBFinal.status === 200);

  // Cleanup
  await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A_U2);
  await request('DELETE', '/api/pdfme/signatures/me', TOKEN_B_U1);

  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
