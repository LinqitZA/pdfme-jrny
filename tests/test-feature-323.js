const http = require('http');
const crypto = require('crypto');

function makeJwt(sub, orgId) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles:['super-admin']})).toString('base64url');
  const sig = crypto.createHmac('sha256','pdfme-dev-secret').update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

const JWT = makeJwt('test-user-323', 'test-org');

function request(method, path, body, jwt) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (jwt || JWT),
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
  console.log('=== Feature #323: Lock timestamp tracks acquisition time ===\n');

  // Create a template
  console.log('Step 1: Create template');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'LockTimestampTest323',
    type: 'invoice',
    version: 1,
    schema: { pages: [{ elements: [] }] },
    createdBy: 'test-user-323'
  });
  assert(createRes.status === 201 || createRes.status === 200, 'Template created: status ' + createRes.status);
  const templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + '\n');

  // Step 2: Note time before acquiring lock
  console.log('Step 2: Acquire lock and note time');
  const beforeLock = new Date();
  const lockRes = await request('POST', '/api/pdfme/templates/' + templateId + '/lock');
  const afterLock = new Date();

  assert(lockRes.status === 200 || lockRes.status === 201, 'Lock acquired: status ' + lockRes.status);
  console.log('  Before lock: ' + beforeLock.toISOString());
  console.log('  After lock: ' + afterLock.toISOString());
  console.log('  Lock response: ' + JSON.stringify(lockRes.body).substring(0, 200));

  // Step 3: GET template to check lockedAt
  console.log('\nStep 3: GET template and verify lockedAt');
  const getRes = await request('GET', '/api/pdfme/templates/' + templateId);
  assert(getRes.status === 200, 'Template retrieved: status ' + getRes.status);

  const lockedAt = new Date(getRes.body.lockedAt);
  console.log('  lockedAt from template: ' + lockedAt.toISOString());
  console.log('  lockedBy from template: ' + getRes.body.lockedBy);

  // Verify lockedAt is present
  assert(getRes.body.lockedAt !== null && getRes.body.lockedAt !== undefined, 'lockedAt field is present');
  assert(getRes.body.lockedBy === 'test-user-323', 'lockedBy is correct user');

  // Verify lockedAt is close to acquisition time (within 5 seconds)
  const lockedAtMs = lockedAt.getTime();
  const beforeMs = beforeLock.getTime();
  const afterMs = afterLock.getTime();

  assert(!isNaN(lockedAtMs), 'lockedAt is a valid date');
  assert(lockedAtMs >= beforeMs - 2000, 'lockedAt >= beforeLock (with 2s tolerance): ' + (lockedAtMs - beforeMs) + 'ms diff');
  assert(lockedAtMs <= afterMs + 2000, 'lockedAt <= afterLock (with 2s tolerance): ' + (afterMs - lockedAtMs) + 'ms diff');

  const diffMs = Math.abs(lockedAtMs - beforeMs);
  assert(diffMs < 5000, 'lockedAt is within 5 seconds of acquisition time: ' + diffMs + 'ms');

  // Also check lock status endpoint
  console.log('\nStep 4: Check lock status endpoint');
  const lockStatusRes = await request('GET', '/api/pdfme/templates/' + templateId + '/lock');
  assert(lockStatusRes.status === 200, 'Lock status retrieved: status ' + lockStatusRes.status);
  console.log('  Lock status: ' + JSON.stringify(lockStatusRes.body).substring(0, 200));

  if (lockStatusRes.body.lockedAt) {
    const statusLockedAt = new Date(lockStatusRes.body.lockedAt);
    assert(!isNaN(statusLockedAt.getTime()), 'Lock status lockedAt is valid date');
    const statusDiff = Math.abs(statusLockedAt.getTime() - lockedAtMs);
    assert(statusDiff < 1000, 'Lock status lockedAt matches template lockedAt: ' + statusDiff + 'ms diff');
  }

  // Release lock
  console.log('\nStep 5: Release lock and verify timestamp cleared');
  const releaseRes = await request('DELETE', '/api/pdfme/templates/' + templateId + '/lock');
  assert(releaseRes.status === 200 || releaseRes.status === 204, 'Lock released: status ' + releaseRes.status);

  const afterRelease = await request('GET', '/api/pdfme/templates/' + templateId);
  assert(afterRelease.body.lockedBy === null || afterRelease.body.lockedBy === undefined || afterRelease.body.lockedBy === '', 'lockedBy cleared after release');

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId);

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
