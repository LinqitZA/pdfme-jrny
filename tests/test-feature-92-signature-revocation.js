/**
 * Feature #92: Signature revocation works
 *
 * Steps:
 * 1. Upload signature
 * 2. DELETE signatures/me
 * 3. No active signature returned
 * 4. revokedAt set
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'test-sig-revoke-org-92';

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

const USER_ID = 'sig-revoke-user-92';
const TOKEN = makeToken(USER_ID, ORG_ID, ['admin']);
const OTHER_TOKEN = makeToken('other-user-92', ORG_ID, ['admin']);

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

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
    if (body) req.write(JSON.stringify(body));
    req.end();
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

// Create a minimal valid PNG (1x1 pixel transparent)
function createMinimalPNG() {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.from([
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
    0x60, 0x82,
  ]);
  return Buffer.concat([pngHeader, ihdr]);
}

async function run() {
  console.log('Feature #92: Signature revocation works\n');

  const pngData = createMinimalPNG();
  const base64Png = 'data:image/png;base64,' + pngData.toString('base64');

  // Step 1: Upload signature
  console.log('--- Step 1: Upload signature ---');
  const uploadRes = await request('POST', '/api/pdfme/signatures', { data: base64Png }, TOKEN);
  assert(uploadRes.status === 201, 'Upload signature returns 201');
  assert(uploadRes.body.id, 'Upload returns signature ID');
  assert(uploadRes.body.userId === USER_ID, 'Upload returns correct userId');
  assert(uploadRes.body.orgId === ORG_ID, 'Upload returns correct orgId');
  assert(uploadRes.body.capturedAt, 'Upload returns capturedAt');
  const sigId = uploadRes.body.id;
  console.log('  Signature ID:', sigId);

  // Verify signature is retrievable via GET
  console.log('\n--- Verify signature exists ---');
  const getRes1 = await request('GET', '/api/pdfme/signatures/me', null, TOKEN);
  assert(getRes1.status === 200, 'GET signatures/me returns 200');
  assert(getRes1.body.id === sigId, 'GET returns correct signature ID');
  assert(getRes1.body.revokedAt === null || getRes1.body.revokedAt === undefined, 'Signature is not revoked before delete');

  // Step 2: DELETE signatures/me
  console.log('\n--- Step 2: DELETE signatures/me ---');
  const deleteRes = await request('DELETE', '/api/pdfme/signatures/me', null, TOKEN);
  assert(deleteRes.status === 200, 'DELETE signatures/me returns 200');
  assert(deleteRes.body.message === 'Signature revoked successfully', 'Response has correct message');
  assert(deleteRes.body.id === sigId, 'Response has correct signature ID');
  assert(deleteRes.body.userId === USER_ID, 'Response has correct userId');
  assert(deleteRes.body.orgId === ORG_ID, 'Response has correct orgId');

  // Step 4: revokedAt set
  console.log('\n--- Step 4: revokedAt set ---');
  assert(deleteRes.body.revokedAt !== null && deleteRes.body.revokedAt !== undefined, 'revokedAt is set in response');
  if (deleteRes.body.revokedAt) {
    const revokedDate = new Date(deleteRes.body.revokedAt);
    assert(!isNaN(revokedDate.getTime()), 'revokedAt is a valid date');
    const now = new Date();
    const diff = Math.abs(now.getTime() - revokedDate.getTime());
    assert(diff < 60000, 'revokedAt is recent (within 60 seconds)');
  }

  // Step 3: No active signature returned
  console.log('\n--- Step 3: No active signature returned ---');
  const getRes2 = await request('GET', '/api/pdfme/signatures/me', null, TOKEN);
  assert(getRes2.status === 404, 'GET signatures/me returns 404 after revocation');
  assert(getRes2.body.message && getRes2.body.message.includes('No active signature'), 'Message says no active signature');

  // Additional: DELETE again returns 404 (no active signature to revoke)
  console.log('\n--- Additional: DELETE again returns 404 ---');
  const deleteRes2 = await request('DELETE', '/api/pdfme/signatures/me', null, TOKEN);
  assert(deleteRes2.status === 404, 'DELETE again returns 404');
  assert(deleteRes2.body.message && deleteRes2.body.message.includes('No active signature'), 'Message says no active signature to revoke');

  // Additional: Can upload a new signature after revocation
  console.log('\n--- Additional: Upload new signature after revocation ---');
  const upload2 = await request('POST', '/api/pdfme/signatures', { data: base64Png }, TOKEN);
  assert(upload2.status === 201, 'Can upload new signature after revocation');
  const newSigId = upload2.body.id;
  assert(newSigId !== sigId, 'New signature has different ID');

  const getRes3 = await request('GET', '/api/pdfme/signatures/me', null, TOKEN);
  assert(getRes3.status === 200, 'GET returns new signature');
  assert(getRes3.body.id === newSigId, 'GET returns correct new signature ID');
  assert(getRes3.body.revokedAt === null || getRes3.body.revokedAt === undefined, 'New signature is not revoked');

  // Additional: DELETE without auth returns 401
  console.log('\n--- Additional: Auth check ---');
  const deleteNoAuth = await request('DELETE', '/api/pdfme/signatures/me', null, null);
  assert(deleteNoAuth.status === 401, 'DELETE without auth returns 401');

  // Clean up - revoke the second signature
  await request('DELETE', '/api/pdfme/signatures/me', null, TOKEN);

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
