/**
 * Feature #24: Force-release edit lock requires admin permission
 *
 * Tests that only Template Admin (template:publish) can force-release
 * another user's edit lock on a template.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

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

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
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

async function run() {
  process.stdout.write('=== Feature #24: Force-release edit lock requires admin permission ===\n\n');

  const TS = Date.now();
  const ORG = `org-lock-${TS}`;

  // User-A: template editor who acquires lock
  const tokenA = makeToken('user-A-lock', ORG, ['template:view', 'template:edit']);
  // User-B: template editor only (no publish) - should NOT be able to force-release
  const tokenB = makeToken('user-B-lock', ORG, ['template:view', 'template:edit']);
  // User-C: template admin with publish permission - CAN force-release
  const tokenC = makeToken('user-C-admin', ORG, ['template:view', 'template:edit', 'template:publish']);

  // Create a template first
  const createRes = await request('POST', '/api/pdfme/templates', tokenA, {
    name: `Lock-Test-${TS}`,
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Lock Test', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Template created', createRes.status === 201);
  const templateId = createRes.data.id;

  // ============================================================
  // Step 1: User-A acquires lock on template
  // ============================================================
  process.stdout.write('\nStep 1: User-A acquires lock\n');

  const lockRes = await request('POST', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('User-A acquires lock', lockRes.status === 200 || lockRes.status === 201);
  assert('Lock acquired by user-A', lockRes.data.lockedBy === 'user-A-lock');

  // Verify lock status
  const lockStatus = await request('GET', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('Lock status shows locked', lockStatus.data.locked === true);
  assert('Lock held by user-A', lockStatus.data.lockedBy === 'user-A-lock');

  // ============================================================
  // Step 2: User-B (template:edit only) tries DELETE lock with force=true → 403
  // ============================================================
  process.stdout.write('\nStep 2: User-B (edit only) tries force-release → 403\n');

  const forceB = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, tokenB);
  assert('User-B force-release returns 403', forceB.status === 403);
  assert('Error message mentions permission', typeof forceB.data.message === 'string' && forceB.data.message.includes('template:publish'));

  // Verify lock is still held by user-A
  const lockAfterB = await request('GET', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('Lock still held after user-B attempt', lockAfterB.data.locked === true);
  assert('Lock still held by user-A', lockAfterB.data.lockedBy === 'user-A-lock');

  // ============================================================
  // Step 3: User-B tries normal (non-force) release → 403 (not their lock)
  // ============================================================
  process.stdout.write('\nStep 3: User-B tries normal release (not their lock) → 403\n');

  const normalB = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, tokenB);
  assert('User-B normal release returns 403', normalB.status === 403);

  // ============================================================
  // Step 4: User-C (template:publish admin) tries DELETE lock with force=true → 200
  // ============================================================
  process.stdout.write('\nStep 4: User-C (admin) force-releases lock → 200\n');

  const forceC = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, tokenC);
  assert('User-C force-release returns 200', forceC.status === 200);
  assert('Lock is released', forceC.data.released === true);

  // ============================================================
  // Step 5: Verify lock is released
  // ============================================================
  process.stdout.write('\nStep 5: Verify lock is released\n');

  const lockAfterC = await request('GET', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('Lock is no longer held', lockAfterC.data.locked === false || lockAfterC.data.lockedBy === null);

  // ============================================================
  // Step 6: User-A can re-acquire lock (it's free now)
  // ============================================================
  process.stdout.write('\nStep 6: Lock can be re-acquired after force-release\n');

  const reLock = await request('POST', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('User-A can re-acquire lock', reLock.status === 200 || reLock.status === 201);

  // ============================================================
  // Step 7: User-A can release their own lock without admin permission
  // ============================================================
  process.stdout.write('\nStep 7: User can release own lock without admin permission\n');

  const ownRelease = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('User-A releases own lock (200)', ownRelease.status === 200);
  assert('Own lock released', ownRelease.data.released === true);

  // ============================================================
  // Step 8: No auth → 401
  // ============================================================
  process.stdout.write('\nStep 8: No auth on lock release → 401\n');

  const noAuth = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, null);
  assert('No auth returns 401', noAuth.status === 401);

  // ============================================================
  // Step 9: Verify force=false doesn't require admin permission
  // ============================================================
  process.stdout.write('\nStep 9: Non-force release by lock owner does not require admin\n');

  // User-B acquires a lock
  const lockB = await request('POST', `/api/pdfme/templates/${templateId}/lock`, tokenB);
  assert('User-B acquires lock', lockB.status === 200 || lockB.status === 201);

  // User-B releases their own lock without force (no admin needed)
  const selfRelease = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`, tokenB);
  assert('User-B releases own lock without admin', selfRelease.status === 200);

  // ============================================================
  // Step 10: Admin force-release scenario end-to-end
  // ============================================================
  process.stdout.write('\nStep 10: Full end-to-end admin force-release\n');

  // User-A locks
  await request('POST', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  // User-B (non-admin) fails to force-release
  const e2eB = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, tokenB);
  assert('E2E: non-admin force-release blocked', e2eB.status === 403);
  // User-C (admin) succeeds
  const e2eC = await request('DELETE', `/api/pdfme/templates/${templateId}/lock?force=true`, tokenC);
  assert('E2E: admin force-release succeeds', e2eC.status === 200);
  // Verify released
  const finalStatus = await request('GET', `/api/pdfme/templates/${templateId}/lock`, tokenA);
  assert('E2E: lock is released', finalStatus.data.locked === false || finalStatus.data.lockedBy === null);

  // ============================================================
  // Cleanup
  // ============================================================
  process.stdout.write('\nCleanup\n');
  const delToken = makeToken('cleaner', ORG, ['template:view', 'template:edit', 'template:delete']);
  await request('DELETE', `/api/pdfme/templates/${templateId}`, delToken);

  // ============================================================
  // Summary
  // ============================================================
  process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
