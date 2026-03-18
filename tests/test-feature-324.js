const http = require('http');
const crypto = require('crypto');
const { Client } = require('pg');

function makeJwt(sub, orgId) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles:['super-admin']})).toString('base64url');
  const sig = crypto.createHmac('sha256','pdfme-dev-secret').update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

const JWT_USER1 = makeJwt('user-324-a', 'test-org');
const JWT_USER2 = makeJwt('user-324-b', 'test-org');

function request(method, path, body, jwt) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (jwt || JWT_USER1),
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch(e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

async function main() {
  console.log('=== Feature #324: Lock timeout calculated from lockedAt ===\n');

  const pgClient = new Client({
    host: 'localhost', port: 5432,
    database: 'pdfme_erp', user: 'postgres', password: 'postgres'
  });
  await pgClient.connect();

  // Create template
  console.log('Step 1: Create template');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'LockTimeoutTest324',
    type: 'invoice',
    version: 1,
    schema: { pages: [{ elements: [] }] },
    createdBy: 'user-324-a'
  });
  assert(createRes.status === 201 || createRes.status === 200, 'Template created');
  const templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + '\n');

  // Acquire lock
  console.log('Step 2: Acquire lock at time T');
  const lockRes = await request('POST', '/api/pdfme/templates/' + templateId + '/lock');
  assert(lockRes.status === 200, 'Lock acquired');

  const lockedAt = new Date(lockRes.body.lockedAt);
  const expiresAt = new Date(lockRes.body.expiresAt);
  console.log('  lockedAt: ' + lockedAt.toISOString());
  console.log('  expiresAt: ' + expiresAt.toISOString());

  // Verify expiresAt = lockedAt + 30 minutes
  const expectedExpiry = new Date(lockedAt.getTime() + 30 * 60 * 1000);
  const expiryDiff = Math.abs(expiresAt.getTime() - expectedExpiry.getTime());
  assert(expiryDiff < 1000, 'expiresAt = lockedAt + 30min (diff: ' + expiryDiff + 'ms)');

  // Step 3: Simulate T+29min (set lockedAt to 29 minutes ago)
  console.log('\nStep 3: Simulate T+29min (lock should still be active)');
  const twentyNineMinAgo = new Date(Date.now() - 29 * 60 * 1000);
  await pgClient.query('UPDATE templates SET locked_at = $1 WHERE id = $2', [twentyNineMinAgo, templateId]);

  const lockStatusAt29 = await request('GET', '/api/pdfme/templates/' + templateId + '/lock');
  assert(lockStatusAt29.status === 200, 'Lock status retrieved at T+29');
  console.log('  Lock status at T+29: locked=' + lockStatusAt29.body.locked + ', expired=' + lockStatusAt29.body.expired);
  assert(lockStatusAt29.body.locked === true, 'Lock still active at T+29min');
  assert(lockStatusAt29.body.expired === false, 'Lock not expired at T+29min');

  // Verify another user cannot acquire
  const tryLock29 = await request('POST', '/api/pdfme/templates/' + templateId + '/lock', null, JWT_USER2);
  assert(tryLock29.status === 409 || tryLock29.status === 423 || (tryLock29.body && tryLock29.body.error), 'Another user blocked at T+29min');
  console.log('  User2 lock attempt at T+29: status=' + tryLock29.status);

  // Verify the expiresAt from lock status is calculated from lockedAt
  if (lockStatusAt29.body.expiresAt) {
    const statusExpires = new Date(lockStatusAt29.body.expiresAt);
    const statusLockedAt = new Date(lockStatusAt29.body.lockedAt);
    const calcExpiry = new Date(statusLockedAt.getTime() + 30 * 60 * 1000);
    const calcDiff = Math.abs(statusExpires.getTime() - calcExpiry.getTime());
    assert(calcDiff < 1000, 'Lock status expiresAt = lockedAt + 30min (diff: ' + calcDiff + 'ms)');
  }

  // Step 4: Simulate T+31min (set lockedAt to 31 minutes ago)
  console.log('\nStep 4: Simulate T+31min (lock should be expired)');
  const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000);
  await pgClient.query('UPDATE templates SET locked_at = $1 WHERE id = $2', [thirtyOneMinAgo, templateId]);

  const lockStatusAt31 = await request('GET', '/api/pdfme/templates/' + templateId + '/lock');
  assert(lockStatusAt31.status === 200, 'Lock status retrieved at T+31');
  console.log('  Lock status at T+31: locked=' + lockStatusAt31.body.locked + ', expired=' + lockStatusAt31.body.expired);
  assert(lockStatusAt31.body.locked === false, 'Lock not active at T+31min');
  assert(lockStatusAt31.body.expired === true, 'Lock expired at T+31min');

  // Verify another user CAN acquire after expiry
  const tryLock31 = await request('POST', '/api/pdfme/templates/' + templateId + '/lock', null, JWT_USER2);
  assert(tryLock31.status === 200, 'Another user can acquire lock after expiry: status ' + tryLock31.status);
  console.log('  User2 lock attempt at T+31: status=' + tryLock31.status);

  if (tryLock31.body.lockedBy) {
    assert(tryLock31.body.lockedBy === 'user-324-b', 'New lock held by user2');
  }

  // Verify correct timeout calculation: expiresAt - lockedAt = 30 minutes
  console.log('\nStep 5: Verify timeout calculation consistency');
  const newLockStatus = await request('GET', '/api/pdfme/templates/' + templateId + '/lock');
  if (newLockStatus.body.lockedAt && newLockStatus.body.expiresAt) {
    const newLockedAt = new Date(newLockStatus.body.lockedAt);
    const newExpiresAt = new Date(newLockStatus.body.expiresAt);
    const duration = newExpiresAt.getTime() - newLockedAt.getTime();
    const expectedDuration = 30 * 60 * 1000;
    assert(duration === expectedDuration, 'Lock duration is exactly 30 minutes (' + duration + 'ms = ' + (duration / 60000) + 'min)');
  }

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId + '/lock', null, JWT_USER2);
  await request('DELETE', '/api/pdfme/templates/' + templateId);
  await pgClient.end();

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
