/**
 * Feature #218: Signature endpoint prevents multiple active
 * User can only have one active signature
 *
 * Steps:
 * 1. Upload first signature - succeeds
 * 2. Upload second signature
 * 3. Verify first is replaced or error returned
 * 4. Verify only one active signature per user+org
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000';
const ORG_ID = 'test-sig-single-' + Date.now();
const USER_A = 'sig-user-a-' + Date.now();
const USER_B = 'sig-user-b-' + Date.now();
const TOKEN_A = signJwt({ sub: USER_A, orgId: ORG_ID, roles: ['admin'] });
const TOKEN_B = signJwt({ sub: USER_B, orgId: ORG_ID, roles: ['admin'] });

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (chunk) => chunks += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: chunks });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Create a small base64-encoded "signature" PNG
function makeFakeSignature(label) {
  const text = `SIGNATURE_${label}_${Date.now()}`;
  return Buffer.from(text).toString('base64');
}

async function runTests() {
  console.log('Feature #218: Signature endpoint prevents multiple active\n');

  // 1. Upload first signature for user A - succeeds
  console.log('Test 1: Upload first signature for user A');
  const sig1Data = makeFakeSignature('FIRST');
  const sig1 = await request('POST', '/api/pdfme/signatures', TOKEN_A, { data: sig1Data });
  assert(sig1.status === 201, `First upload should return 201, got ${sig1.status}`);
  assert(sig1.body && sig1.body.id, 'First upload should return id');
  assert(sig1.body && sig1.body.userId === USER_A, 'First upload userId matches');
  const firstSigId = sig1.body?.id;

  // 2. Verify first signature can be retrieved
  console.log('Test 2: Get first signature');
  const get1 = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(get1.status === 200, `Get signature should return 200, got ${get1.status}`);
  assert(get1.body && get1.body.id === firstSigId, 'Retrieved signature matches uploaded one');

  // 3. Upload second signature for same user A
  console.log('Test 3: Upload second signature for user A (replaces first)');
  const sig2Data = makeFakeSignature('SECOND');
  const sig2 = await request('POST', '/api/pdfme/signatures', TOKEN_A, { data: sig2Data });
  assert(sig2.status === 201, `Second upload should return 201, got ${sig2.status}`);
  assert(sig2.body && sig2.body.id, 'Second upload should return id');
  const secondSigId = sig2.body?.id;
  assert(secondSigId !== firstSigId, 'Second signature should have different id from first');

  // 4. Verify only the second signature is active (first replaced)
  console.log('Test 4: Only second signature is active');
  const get2 = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(get2.status === 200, `Get signature should return 200, got ${get2.status}`);
  assert(get2.body && get2.body.id === secondSigId, 'Active signature should be the second one');
  assert(get2.body && get2.body.id !== firstSigId, 'First signature should no longer be active');

  // 5. Upload third signature - still only one active
  console.log('Test 5: Upload third signature - still only one active');
  const sig3Data = makeFakeSignature('THIRD');
  const sig3 = await request('POST', '/api/pdfme/signatures', TOKEN_A, { data: sig3Data });
  assert(sig3.status === 201, `Third upload should return 201, got ${sig3.status}`);
  const thirdSigId = sig3.body?.id;

  const get3 = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(get3.status === 200, 'Get after third upload returns 200');
  assert(get3.body && get3.body.id === thirdSigId, 'Active signature should be the third one');

  // 6. Different user (B) can have their own signature
  console.log('Test 6: User B can have independent signature');
  const sigB = await request('POST', '/api/pdfme/signatures', TOKEN_B, { data: makeFakeSignature('USER_B') });
  assert(sigB.status === 201, `User B upload should return 201, got ${sigB.status}`);
  assert(sigB.body && sigB.body.userId === USER_B, 'User B signature belongs to user B');

  // 7. User A still has only their own signature
  console.log('Test 7: User A still has their own signature');
  const getA = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getA.status === 200, 'User A still has signature');
  assert(getA.body && getA.body.id === thirdSigId, 'User A signature unchanged by user B upload');

  // 8. User B has their own separate signature
  console.log('Test 8: User B has their own signature');
  const getB = await request('GET', '/api/pdfme/signatures/me', TOKEN_B);
  assert(getB.status === 200, 'User B has signature');
  assert(getB.body && getB.body.userId === USER_B, 'User B signature belongs to user B');
  assert(getB.body && getB.body.id !== thirdSigId, 'User B signature is different from user A');

  // 9. Revoke user A signature, then re-upload
  console.log('Test 9: Revoke then re-upload');
  const revoke = await request('DELETE', '/api/pdfme/signatures/me', TOKEN_A);
  assert(revoke.status === 200, `Revoke should return 200, got ${revoke.status}`);

  const getAfterRevoke = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getAfterRevoke.status === 404, `After revoke, get should return 404, got ${getAfterRevoke.status}`);

  const sig4 = await request('POST', '/api/pdfme/signatures', TOKEN_A, { data: makeFakeSignature('FOURTH') });
  assert(sig4.status === 201, `Re-upload after revoke should return 201, got ${sig4.status}`);

  const getAfterReupload = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getAfterReupload.status === 200, 'Get after re-upload returns 200');
  assert(getAfterReupload.body && getAfterReupload.body.id === sig4.body?.id, 'New upload is the active one');

  // 10. Upload replaces even after revoke+reupload cycle
  console.log('Test 10: Upload replaces after revoke+reupload cycle');
  const sig5 = await request('POST', '/api/pdfme/signatures', TOKEN_A, { data: makeFakeSignature('FIFTH') });
  assert(sig5.status === 201, 'Fifth upload succeeds');
  const getFinal = await request('GET', '/api/pdfme/signatures/me', TOKEN_A);
  assert(getFinal.status === 200, 'Get final returns 200');
  assert(getFinal.body && getFinal.body.id === sig5.body?.id, 'Only the latest signature is active');

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
