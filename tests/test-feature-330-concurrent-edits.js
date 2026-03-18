/**
 * Feature #330: Concurrent template edits detected
 *
 * Tests that two users editing same template is handled via locking.
 * User A acquires lock, User B gets conflict, sees read-only mode.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-concurrent-330';

function generateToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN_A = generateToken('user-A-330');
const TOKEN_B = generateToken('user-B-330');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || TOKEN_A}`,
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function runTests() {
  console.log('Feature #330: Concurrent template edits detected\n');

  // Setup: Create a template
  console.log('Setup: Creating test template...');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'CONCURRENT_TEST_330',
    type: 'invoice',
    orgId: ORG_ID,
    schema: { pages: [{ elements: [] }] },
    createdBy: 'user-A-330',
  }, TOKEN_A);
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  templateId = createRes.body.id;

  // Step 1: User A acquires lock
  console.log('\nStep 1: User A acquires lock...');
  const lockA = await request('POST', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_A);
  assert(lockA.status === 200, `User A lock acquired (${lockA.status})`);
  assert(lockA.body.locked === true || lockA.body.lockedBy === 'user-A-330', 'Lock response shows User A as holder');

  // Step 2: User A edits template (should succeed)
  console.log('\nStep 2: User A edits template...');
  const editA = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'CONCURRENT_TEST_330_EDITED',
  }, TOKEN_A);
  assert(editA.status === 200, `User A edit succeeds (${editA.status})`);

  // Step 3: User B tries to acquire lock - should get conflict
  console.log('\nStep 3: User B tries to acquire lock...');
  const lockB = await request('POST', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_B);
  assert(lockB.status === 409, `User B gets 409 Conflict (${lockB.status})`);
  assert(lockB.body.lockedBy === 'user-A-330', `Conflict shows User A as lock holder (${lockB.body.lockedBy})`);
  assert(lockB.body.message !== undefined, 'Conflict includes error message');
  assert(lockB.body.expiresAt !== undefined, 'Conflict includes lock expiry time');

  // Step 4: User B tries to edit - should get conflict
  console.log('\nStep 4: User B tries to edit locked template...');
  const editB = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'CONCURRENT_TEST_330_USER_B',
  }, TOKEN_B);
  assert(editB.status === 409, `User B edit blocked with 409 (${editB.status})`);
  assert(editB.body.lockedBy === 'user-A-330', `Edit conflict shows User A as lock holder`);

  // Step 5: User B can still read the template (read-only)
  console.log('\nStep 5: User B reads template (read-only mode)...');
  const readB = await request('GET', `/api/pdfme/templates/${templateId}`, null, TOKEN_B);
  assert(readB.status === 200, `User B can read template (${readB.status})`);
  assert(readB.body.id === templateId, 'User B sees correct template');

  // Step 6: User B checks lock status
  console.log('\nStep 6: User B checks lock status...');
  const lockStatus = await request('GET', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_B);
  assert(lockStatus.status === 200, `Lock status query returns 200`);
  assert(lockStatus.body.locked === true, 'Lock status shows locked=true');
  assert(lockStatus.body.lockedBy === 'user-A-330', 'Lock status shows User A as holder');

  // Step 7: User A releases lock
  console.log('\nStep 7: User A releases lock...');
  const releaseA = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_A);
  assert(releaseA.status === 200, `User A releases lock (${releaseA.status})`);

  // Step 8: Now User B can acquire lock
  console.log('\nStep 8: User B acquires lock after release...');
  const lockB2 = await request('POST', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_B);
  assert(lockB2.status === 200, `User B lock acquired (${lockB2.status})`);

  // Step 9: User B can now edit
  console.log('\nStep 9: User B edits template...');
  const editB2 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'CONCURRENT_TEST_330_USER_B_EDIT',
  }, TOKEN_B);
  assert(editB2.status === 200, `User B edit succeeds after acquiring lock (${editB2.status})`);

  // Step 10: User A now gets conflict
  console.log('\nStep 10: User A tries to edit - now blocked...');
  const editA2 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'CONCURRENT_TEST_330_USER_A_RETRY',
  }, TOKEN_A);
  assert(editA2.status === 409, `User A blocked when B holds lock (${editA2.status})`);

  // Cleanup
  console.log('\nCleaning up...');
  await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_B);
  await request('DELETE', `/api/pdfme/templates/${templateId}`, null, TOKEN_A);

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`========================================`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  if (templateId) {
    request('DELETE', `/api/pdfme/templates/${templateId}/lock`, null, TOKEN_A)
      .then(() => request('DELETE', `/api/pdfme/templates/${templateId}`, null, TOKEN_A))
      .then(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
