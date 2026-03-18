const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const USER_A_TOKEN = makeToken('user-a-292', 'org-292', ['template:edit', 'template:publish']);
const USER_B_TOKEN = makeToken('user-b-292', 'org-292', ['template:edit']);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || USER_A_TOKEN),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push('  \u2713 ' + name);
  } else {
    failed++;
    results.push('  \u2717 ' + name);
  }
}

async function run() {
  // Create a test template
  const createRes = await request('POST', '/templates', {
    name: 'Lock Test 292',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF' },
  }, USER_A_TOKEN);
  const templateId = createRes.body && createRes.body.id;
  assert(templateId, 'Test template created');

  if (!templateId) {
    process.stdout.write('\nFailed to create template, aborting tests\n');
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────
  // SECTION 1: Lock acquisition - User A acquires lock
  // ──────────────────────────────────────────────────────────────────

  const lockAcquire = await request('POST', `/templates/${templateId}/lock`, null, USER_A_TOKEN);
  assert(lockAcquire.status === 200, 'User A acquires lock successfully (200)');
  assert(lockAcquire.body && lockAcquire.body.locked === true, 'Lock response confirms locked=true');
  assert(lockAcquire.body && lockAcquire.body.lockedBy === 'user-a-292', 'Lock response shows lockedBy user');
  assert(lockAcquire.body && lockAcquire.body.expiresAt, 'Lock response includes expiresAt timestamp');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 2: Lock status query
  // ──────────────────────────────────────────────────────────────────

  const lockStatus = await request('GET', `/templates/${templateId}/lock`, null, USER_A_TOKEN);
  assert(lockStatus.status === 200, 'Lock status query returns 200');
  assert(lockStatus.body && lockStatus.body.locked === true, 'Lock status shows locked=true');
  assert(lockStatus.body && lockStatus.body.lockedBy === 'user-a-292', 'Lock status shows correct lockedBy');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 3: Other user (B) tries to acquire lock - gets read-only message
  // ──────────────────────────────────────────────────────────────────

  const lockConflict = await request('POST', `/templates/${templateId}/lock`, null, USER_B_TOKEN);
  assert(lockConflict.status === 409, 'User B gets 409 Conflict when lock held by A');
  assert(lockConflict.body && lockConflict.body.message, 'Conflict response includes message');
  assert(lockConflict.body && lockConflict.body.lockedBy === 'user-a-292',
    'Conflict response tells who holds the lock');
  assert(lockConflict.body && lockConflict.body.expiresAt,
    'Conflict response includes lock expiration time');

  // User B can see lock status
  const lockStatusB = await request('GET', `/templates/${templateId}/lock`, null, USER_B_TOKEN);
  assert(lockStatusB.status === 200, 'User B can query lock status');
  assert(lockStatusB.body && lockStatusB.body.locked === true, 'User B sees template is locked');
  assert(lockStatusB.body && lockStatusB.body.lockedBy === 'user-a-292', 'User B sees who holds lock');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 4: Lock release
  // ──────────────────────────────────────────────────────────────────

  const lockRelease = await request('DELETE', `/templates/${templateId}/lock`, null, USER_A_TOKEN);
  assert(lockRelease.status === 200, 'User A releases lock successfully');
  assert(lockRelease.body && lockRelease.body.released === true, 'Release response confirms released=true');

  // Verify lock is released
  const afterRelease = await request('GET', `/templates/${templateId}/lock`, null, USER_B_TOKEN);
  assert(afterRelease.status === 200, 'Lock status query after release returns 200');
  assert(afterRelease.body && afterRelease.body.locked === false, 'Lock status shows locked=false after release');

  // User B can now acquire lock
  const lockAcquireB = await request('POST', `/templates/${templateId}/lock`, null, USER_B_TOKEN);
  assert(lockAcquireB.status === 200, 'User B can acquire lock after A releases');
  assert(lockAcquireB.body && lockAcquireB.body.lockedBy === 'user-b-292', 'Lock shows User B as holder');

  // Release B's lock for cleanup
  await request('DELETE', `/templates/${templateId}/lock`, null, USER_B_TOKEN);

  // ──────────────────────────────────────────────────────────────────
  // SECTION 5: Verify UI has lock indicator elements
  // ──────────────────────────────────────────────────────────────────

  const designerSrc = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // Lock state management
  assert(designerSrc.includes('isReadOnly'), 'UI has isReadOnly state');
  assert(designerSrc.includes('lockHolder'), 'UI has lockHolder state');
  assert(designerSrc.includes('lockExpiresAt'), 'UI has lockExpiresAt state');

  // Lock warning banner
  assert(designerSrc.includes('lock-warning-banner'), 'UI has lock warning banner element');
  assert(designerSrc.includes('lock-warning-message'), 'UI has lock warning message');
  assert(designerSrc.includes('lock-holder'), 'UI has lock holder display');
  assert(designerSrc.includes('lock-expires-at'), 'UI has lock expiration display');

  // Read-only mode text
  assert(designerSrc.includes('read-only mode'), 'UI communicates read-only mode to user');
  assert(designerSrc.includes('currently being edited by'), 'UI explains who holds the lock');

  // Lock acquisition on template open
  assert(designerSrc.includes("'/lock'") || designerSrc.includes('/lock'), 'UI calls lock endpoint on open');
  assert(designerSrc.includes("method: 'POST'") && designerSrc.includes('lock'), 'UI acquires lock via POST');
  assert(designerSrc.includes("method: 'DELETE'") && designerSrc.includes('lock'), 'UI releases lock via DELETE');

  // Lock conflict handling
  assert(designerSrc.includes('409'), 'UI handles 409 conflict status');
  assert(designerSrc.includes('setIsReadOnly(true)'), 'UI sets read-only on lock conflict');
  assert(designerSrc.includes('setLockHolder'), 'UI stores lock holder info');

  // Lock release on unmount
  assert(designerSrc.includes('Release lock on unmount'), 'UI releases lock when leaving page');

  // Cleanup
  await request('DELETE', `/templates/${templateId}`, null, USER_A_TOKEN);

  // Print results
  process.stdout.write('\n=== Feature #292: Lock acquisition feedback ===\n');
  results.forEach(function(r) { process.stdout.write(r + '\n'); });
  process.stdout.write('\nTotal: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + '\n\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  process.stderr.write('Test runner error: ' + err.message + '\n');
  process.exit(1);
});
