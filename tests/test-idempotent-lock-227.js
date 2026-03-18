/**
 * Feature #227: Idempotent lock acquisition
 * Re-acquiring own lock is idempotent (heartbeat pattern)
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const token = signJwt({ sub: 'user-227', orgId: 'org-227', roles: ['template:edit'] });
const otherToken = signJwt({ sub: 'user-227-other', orgId: 'org-227', roles: ['template:edit'] });

let passed = 0;
let failed = 0;
let templateId = null;

function request(method, path, body, authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${authToken || token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
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

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

async function setup() {
  // Create a template
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Lock Test Template 227',
    type: 'invoice',
    orgId: 'org-227',
    schema: {
      pages: [{ elements: [{ type: 'text', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
      basePdf: { width: 210, height: 297 },
    },
  });
  templateId = res.body.id || res.body.template?.id;
}

async function runTests() {
  console.log('\n=== Feature #227: Idempotent lock acquisition ===\n');

  await setup();
  assert('Template created', !!templateId);

  // Test 1: First lock acquisition
  console.log('\n--- Test 1: Initial lock acquisition ---');
  const lock1 = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
  assert('First lock succeeds (200)', lock1.status === 200);
  assert('Lock is held', lock1.body.locked === true);
  assert('Locked by correct user', lock1.body.lockedBy === 'user-227');
  assert('Has lockedAt timestamp', !!lock1.body.lockedAt);
  assert('Has expiresAt timestamp', !!lock1.body.expiresAt);
  const firstLockedAt = new Date(lock1.body.lockedAt).getTime();

  // Wait a bit so timestamps differ
  await new Promise(r => setTimeout(r, 50));

  // Test 2: Re-acquire lock (heartbeat) - should succeed
  console.log('\n--- Test 2: Re-acquire own lock (heartbeat) ---');
  const lock2 = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
  assert('Re-acquire succeeds (200)', lock2.status === 200);
  assert('No error returned', !('error' in lock2.body));
  assert('Still locked', lock2.body.locked === true);
  assert('Still held by same user', lock2.body.lockedBy === 'user-227');
  const secondLockedAt = new Date(lock2.body.lockedAt).getTime();
  assert('lockedAt updated (newer timestamp)', secondLockedAt >= firstLockedAt);

  // Test 3: Multiple rapid re-acquisitions
  console.log('\n--- Test 3: Multiple rapid heartbeats ---');
  const results = [];
  for (let i = 0; i < 5; i++) {
    const res = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
    results.push(res);
  }
  const allSucceeded = results.every(r => r.status === 200);
  const allSameUser = results.every(r => r.body.lockedBy === 'user-227');
  assert('All 5 rapid re-acquisitions succeed', allSucceeded);
  assert('All held by same user', allSameUser);
  assert('No errors in any response', results.every(r => !('error' in r.body)));

  // Test 4: Another user cannot acquire while locked
  console.log('\n--- Test 4: Other user rejected ---');
  const otherLock = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {}, otherToken);
  assert('Other user gets 409', otherLock.status === 409);
  assert('Error mentions locked', typeof otherLock.body.message === 'string');

  // Test 5: After heartbeat, other user still can't take lock
  console.log('\n--- Test 5: After heartbeat, other user still blocked ---');
  const heartbeat = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
  assert('Heartbeat succeeds', heartbeat.status === 200);
  const otherLock2 = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {}, otherToken);
  assert('Other user still blocked after heartbeat', otherLock2.status === 409);

  // Test 6: Verify lock status shows correct holder
  console.log('\n--- Test 6: Lock status correct ---');
  const status = await request('GET', `/api/pdfme/templates/${templateId}/lock`);
  assert('Lock status returns 200', status.status === 200);
  assert('Lock status shows correct user', status.body.lockedBy === 'user-227');

  // Test 7: Release and re-acquire cycle
  console.log('\n--- Test 7: Release and re-acquire ---');
  const release = await request('DELETE', `/api/pdfme/templates/${templateId}/lock`);
  assert('Lock released', release.status === 200);
  const reAcquire = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
  assert('Re-acquire after release succeeds', reAcquire.status === 200);
  assert('Lock holder correct after re-acquire', reAcquire.body.lockedBy === 'user-227');

  // Test 8: Verify expiresAt is extended on heartbeat
  console.log('\n--- Test 8: ExpiresAt extended on heartbeat ---');
  const firstExpiry = new Date(reAcquire.body.expiresAt).getTime();
  await new Promise(r => setTimeout(r, 50));
  const heartbeat2 = await request('POST', `/api/pdfme/templates/${templateId}/lock`, {});
  const secondExpiry = new Date(heartbeat2.body.expiresAt).getTime();
  assert('ExpiresAt extended after heartbeat', secondExpiry >= firstExpiry);

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
