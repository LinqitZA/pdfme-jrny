/**
 * Feature #205: API rejects tampered JWT claims
 *
 * Tests that modified JWT claims (orgId, roles) are detected and rejected with 401.
 * Uses HMAC-SHA256 signature verification with the dev secret.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

let passed = 0;
let failed = 0;

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function tamperPayload(token, modifications) {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  Object.assign(payload, modifications);
  // Re-encode payload but keep original signature (simulates tampering)
  const newPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${parts[0]}.${newPayload}.${parts[2]}`;
}

function tamperSignature(token) {
  const parts = token.split('.');
  // Corrupt the signature
  return `${parts[0]}.${parts[1]}.corrupted_signature_abc123`;
}

function request(method, path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) {
      opts.headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

async function runTests() {
  console.log('\n=== Feature #205: API rejects tampered JWT claims ===\n');

  // Create a valid JWT
  const validPayload = { sub: 'test-user-205', orgId: 'org-205', roles: ['admin', 'template:edit'] };
  const validToken = signJwt(validPayload);

  // 1. Valid token should work
  console.log('--- Valid token acceptance ---');
  const r1 = await request('GET', '/api/pdfme/templates', validToken);
  assert('Valid JWT returns 200', r1.status === 200);

  // 2. Tampered orgId claim
  console.log('\n--- Tampered orgId claim ---');
  const tamperedOrgToken = tamperPayload(validToken, { orgId: 'hacked-org' });
  const r2 = await request('GET', '/api/pdfme/templates', tamperedOrgToken);
  assert('Tampered orgId returns 401', r2.status === 401);
  assert('Response says Unauthorized', r2.body && r2.body.error === 'Unauthorized');
  assert('Response has error message', r2.body && typeof r2.body.message === 'string');

  // 3. Tampered roles claim
  console.log('\n--- Tampered roles claim ---');
  const tamperedRolesToken = tamperPayload(validToken, { roles: ['super-admin', 'system:seed'] });
  const r3 = await request('GET', '/api/pdfme/templates', tamperedRolesToken);
  assert('Tampered roles returns 401', r3.status === 401);
  assert('Response says Unauthorized for roles tampering', r3.body && r3.body.error === 'Unauthorized');

  // 4. Tampered sub claim
  console.log('\n--- Tampered sub claim ---');
  const tamperedSubToken = tamperPayload(validToken, { sub: 'admin-user' });
  const r4 = await request('GET', '/api/pdfme/templates', tamperedSubToken);
  assert('Tampered sub returns 401', r4.status === 401);

  // 5. Corrupted signature
  console.log('\n--- Corrupted signature ---');
  const corruptedSigToken = tamperSignature(validToken);
  const r5 = await request('GET', '/api/pdfme/templates', corruptedSigToken);
  assert('Corrupted signature returns 401', r5.status === 401);

  // 6. Token signed with wrong secret
  console.log('\n--- Wrong secret ---');
  const wrongHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const wrongBody = Buffer.from(JSON.stringify(validPayload)).toString('base64url');
  const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(`${wrongHeader}.${wrongBody}`).digest('base64url');
  const wrongSecretToken = `${wrongHeader}.${wrongBody}.${wrongSig}`;
  const r6 = await request('GET', '/api/pdfme/templates', wrongSecretToken);
  assert('Wrong secret returns 401', r6.status === 401);

  // 7. Multiple claims tampered at once
  console.log('\n--- Multiple claims tampered ---');
  const multiTampered = tamperPayload(validToken, { orgId: 'evil-org', roles: ['super-admin'], sub: 'evil-user' });
  const r7 = await request('GET', '/api/pdfme/templates', multiTampered);
  assert('Multiple tampered claims returns 401', r7.status === 401);

  // 8. Empty payload token with valid-looking structure
  console.log('\n--- Edge cases ---');
  const r8 = await request('GET', '/api/pdfme/templates', 'a.b');
  assert('Two-part token (missing signature) returns 401', r8.status === 401);

  // 9. No token at all
  const r9 = await request('GET', '/api/pdfme/templates', null);
  assert('No token returns 401', r9.status === 401);

  // 10. Adding extra claims doesn't bypass (signature still invalid)
  console.log('\n--- Extra claims injection ---');
  const extraClaimsToken = tamperPayload(validToken, { isAdmin: true, superUser: true });
  const r10 = await request('GET', '/api/pdfme/templates', extraClaimsToken);
  assert('Extra claims injection returns 401', r10.status === 401);

  // 11. Valid token still works on other endpoints
  console.log('\n--- Valid token on multiple endpoints ---');
  const r11 = await request('GET', '/api/pdfme/health', validToken);
  assert('Health check still works (public endpoint)', r11.status === 200);

  // 12. Different valid tokens for different users both work
  const otherPayload = { sub: 'other-user-205', orgId: 'org-other', roles: ['template:view'] };
  const otherToken = signJwt(otherPayload);
  const r12 = await request('GET', '/api/pdfme/templates', otherToken);
  assert('Different valid user token works', r12.status === 200);

  // 13. Tampered orgId on the second token also rejected
  const tamperedOtherToken = tamperPayload(otherToken, { orgId: 'org-205' });
  const r13 = await request('GET', '/api/pdfme/templates', tamperedOtherToken);
  assert('Tampered orgId on second user also rejected', r13.status === 401);

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  if (failed > 0) {
    throw new Error(`${failed} tests failed`);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err);
});
