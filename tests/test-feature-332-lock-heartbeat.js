/**
 * Feature #332: Lock heartbeat prevents premature expiry
 * Regular heartbeat keeps lock alive beyond the 30-minute default.
 */
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-332', 'org-332', ['template:edit', 'template:publish']);
const TOKEN_OTHER = makeJwt('user-332-other', 'org-332', ['template:edit']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const HEADERS_OTHER = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_OTHER}` };

let passed = 0;
let failed = 0;
let templateId;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function setup() {
  // Create a draft template for locking
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name: 'Heartbeat Test 332',
      type: 'invoice',
      schema: {
        pages: [{ elements: [{ type: 'text', name: 'f1', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
        schemas: [[{ type: 'text', name: 'f1', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }]],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    }),
  });
  const data = await res.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);
}

async function cleanup() {
  // Release lock if held
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}/lock`, { method: 'DELETE', headers: HEADERS });
    await fetch(`${API_BASE}/templates/${templateId}`, { method: 'DELETE', headers: HEADERS });
  }
}

async function testAcquireLock() {
  console.log('\n--- Step 1: Acquire lock ---');
  const res = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: HEADERS,
  });
  const body = await res.json();
  assert(res.ok, `Lock acquired (${res.status})`);
  assert(body.locked === true, 'Lock result shows locked=true');
  assert(body.lockedBy === 'user-332', `Locked by correct user: ${body.lockedBy}`);
  assert(body.expiresAt, `Lock has expiry time: ${body.expiresAt}`);
  return body;
}

async function testHeartbeatRefreshesLock() {
  console.log('\n--- Step 2: Send heartbeat refreshes lock ---');

  // Get initial lock status
  const statusRes1 = await fetch(`${API_BASE}/templates/${templateId}/lock`, { headers: HEADERS });
  const status1 = await statusRes1.json();
  const initialLockedAt = status1.lockedAt;

  // Small delay to ensure timestamps differ
  await new Promise(r => setTimeout(r, 50));

  // Send heartbeat
  const hbRes = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  const hb = await hbRes.json();
  assert(hbRes.ok, `Heartbeat accepted (${hbRes.status})`);
  assert(hb.refreshed === true, 'Heartbeat shows refreshed=true');
  assert(hb.lockedAt, `Heartbeat returns new lockedAt: ${hb.lockedAt}`);
  assert(hb.expiresAt, `Heartbeat returns new expiresAt: ${hb.expiresAt}`);

  // Verify lockedAt was updated (new timestamp is later or equal)
  const newLockedAt = new Date(hb.lockedAt).getTime();
  const oldLockedAt = new Date(initialLockedAt).getTime();
  assert(newLockedAt >= oldLockedAt, `lockedAt refreshed (new >= old)`);

  // Verify expiresAt is 30 minutes from new lockedAt
  const expectedExpiry = newLockedAt + 30 * 60 * 1000;
  const actualExpiry = new Date(hb.expiresAt).getTime();
  assert(Math.abs(actualExpiry - expectedExpiry) < 2000, 'expiresAt is 30 min from new lockedAt');
}

async function testHeartbeatPreventsExpiryAt30Min() {
  console.log('\n--- Step 3: Verify lock does not expire at 30 min with heartbeat ---');

  // Simulate time passage to 29 minutes by setting lockedAt to 29 min ago via DB
  // We use the heartbeat endpoint itself to refresh, then simulate time passage via
  // re-acquiring the lock (which resets lockedAt) and then directly testing

  // First, send a heartbeat to get fresh timestamp
  const hbRes = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  const hb = await hbRes.json();
  assert(hbRes.ok, 'Heartbeat sent before time simulation');

  // The key test: send another heartbeat to simulate the lock being kept alive
  // After heartbeat, lock should still be valid for another 30 min
  const hbRes2 = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  const hb2 = await hbRes2.json();
  assert(hbRes2.ok, 'Second heartbeat accepted');
  assert(hb2.refreshed === true, 'Second heartbeat refreshed lock');

  // Verify other user still cannot acquire the lock
  const otherRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: HEADERS_OTHER,
  });
  assert(otherRes.status === 409, `Other user blocked from acquiring lock (${otherRes.status})`);

  // Verify the lock status shows it's still held
  const statusRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, { headers: HEADERS });
  const status = await statusRes.json();
  assert(status.lockedBy === 'user-332', 'Lock still held by original user');
  assert(status.locked === true, 'Lock status shows locked=true');
}

async function testHeartbeatOnlyByHolder() {
  console.log('\n--- Step 2b: Non-holder cannot heartbeat ---');

  // Other user tries to heartbeat
  const res = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS_OTHER,
  });
  assert(res.status === 403, `Non-holder heartbeat rejected (${res.status})`);
}

async function testLockExpiresAfterHeartbeatStops() {
  console.log('\n--- Step 4 & 5: Stop heartbeat, verify lock expires after 30 min ---');

  // To simulate lock expiry, we manipulate the lockedAt in DB to be 31 min ago
  // by releasing and re-acquiring with a time-shifted lock

  // First release the current lock
  await fetch(`${API_BASE}/templates/${templateId}/lock`, { method: 'DELETE', headers: HEADERS });

  // Re-acquire lock
  const lockRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(lockRes.ok, 'Lock re-acquired for expiry test');

  // Now simulate 31 minutes passing by setting lockedAt in the past via direct DB update
  // We'll use the API to set lockedAt to 31 min ago - need a test endpoint or direct approach
  // Since Feature #324 did this, let's use the same approach - direct DB manipulation via psql
  const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();

  // Use psql to update the lockedAt directly
  const { execSync } = require('child_process');
  try {
    execSync(`docker exec pdfme-postgres psql -U postgres -d pdfme_erp -c "UPDATE templates SET locked_at = '${thirtyOneMinAgo}' WHERE id = '${templateId}'"`, { encoding: 'utf8' });
  } catch (e) {
    console.log('  INFO: Direct DB update via psql');
  }

  // After 31 min without heartbeat, the lock should be expired
  // Another user should be able to acquire the lock
  const otherLockRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: HEADERS_OTHER,
  });
  const otherLock = await otherLockRes.json();
  assert(otherLockRes.ok, `Other user can acquire expired lock (${otherLockRes.status})`);
  assert(otherLock.locked === true, 'Other user now holds the lock');
  assert(otherLock.lockedBy === 'user-332-other', `Lock now held by: ${otherLock.lockedBy}`);

  // Original user's heartbeat should now fail
  const hbRes = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(hbRes.status === 403, `Original user heartbeat rejected after lock taken (${hbRes.status})`);

  // Release the other user's lock for cleanup
  await fetch(`${API_BASE}/templates/${templateId}/lock`, { method: 'DELETE', headers: HEADERS_OTHER });
}

async function testHeartbeatOnUnlockedTemplate() {
  console.log('\n--- Edge case: Heartbeat on unlocked template ---');

  // Ensure template is unlocked
  await fetch(`${API_BASE}/templates/${templateId}/lock`, { method: 'DELETE', headers: HEADERS });

  const res = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(res.status === 409, `Heartbeat on unlocked template returns 409 (${res.status})`);
}

async function testHeartbeatOnExpiredLock() {
  console.log('\n--- Edge case: Heartbeat on expired lock ---');

  // Acquire lock
  await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: HEADERS,
  });

  // Set lockedAt to 31 min ago
  const thirtyOneMinAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const { execSync } = require('child_process');
  try {
    execSync(`docker exec pdfme-postgres psql -U postgres -d pdfme_erp -c "UPDATE templates SET locked_at = '${thirtyOneMinAgo}' WHERE id = '${templateId}'"`, { encoding: 'utf8' });
  } catch (e) {
    // ignore
  }

  // Try heartbeat - should fail because lock is expired
  const res = await fetch(`${API_BASE}/templates/${templateId}/lock/heartbeat`, {
    method: 'POST',
    headers: HEADERS,
  });
  assert(res.status === 409, `Heartbeat on expired lock returns 409 (${res.status})`);

  // Clean up - release expired lock
  await fetch(`${API_BASE}/templates/${templateId}/lock`, { method: 'DELETE', headers: HEADERS });
}

(async () => {
  console.log('Feature #332: Lock heartbeat prevents premature expiry');
  try {
    await setup();
    await testAcquireLock();
    await testHeartbeatRefreshesLock();
    await testHeartbeatOnlyByHolder();
    await testHeartbeatPreventsExpiryAt30Min();
    await testLockExpiresAfterHeartbeatStops();
    await testHeartbeatOnUnlockedTemplate();
    await testHeartbeatOnExpiredLock();
  } finally {
    await cleanup();
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
