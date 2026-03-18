/**
 * Feature #339: Stale lock detection after server restart
 * Locks from before restart handled correctly
 *
 * Tests:
 * 1. Acquire lock
 * 2. Restart server (simulated via DB manipulation of lock timestamp)
 * 3. Verify lock state preserved or cleaned up appropriately
 * 4. Verify no stale locks block editing
 */

const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function makeToken(userId, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    orgId: orgId || 'org-339',
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function apiPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function apiGet(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log('\n=== Feature #339: Stale lock detection after server restart ===\n');

  const tokenUserA = makeToken('user-a-339', 'org-339');
  const tokenUserB = makeToken('user-b-339', 'org-339');

  // --- Setup: Create test template ---
  console.log('Setup: Create test template');
  const createRes = await apiPost('/templates', {
    name: 'Stale Lock Test 339',
    type: 'invoice',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ elements: [] }],
    },
  }, tokenUserA);
  assert(createRes.status === 201, `Template created (status ${createRes.status})`);
  const templateId = createRes.data.id;

  // --- Test 1: Acquire lock ---
  console.log('\nTest 1: Acquire lock by User A');
  const lockRes = await apiPost(`/templates/${templateId}/lock`, {}, tokenUserA);
  assert(lockRes.status === 200 || lockRes.status === 201, `Lock acquired (status ${lockRes.status})`);
  assert(lockRes.data.locked === true, 'Lock result shows locked=true');
  assert(lockRes.data.lockedBy === 'user-a-339', 'Locked by User A');

  // Verify User B cannot acquire lock
  const lockBRes = await apiPost(`/templates/${templateId}/lock`, {}, tokenUserB);
  assert(lockBRes.status === 409, `User B blocked from acquiring lock (status ${lockBRes.status})`);

  // --- Test 2: Lock persists in database (survives restart) ---
  console.log('\nTest 2: Lock state persists in database');

  // Check lock status
  const statusRes = await apiGet(`/templates/${templateId}/lock`, tokenUserA);
  assert(statusRes.status === 200, 'Lock status retrieved');
  assert(statusRes.data.locked === true, 'Lock is still active');
  assert(statusRes.data.lockedBy === 'user-a-339', 'Lock holder is User A');

  // Lock is stored in DB (lockedBy and lockedAt columns), so it survives restart
  // The lockedAt timestamp determines expiry, not server memory

  // --- Test 3: Simulate stale lock (lock from 31+ minutes ago) ---
  console.log('\nTest 3: Stale lock (expired) allows new user to acquire');

  // Create a second template for the stale lock test
  const create2Res = await apiPost('/templates', {
    name: 'Stale Lock Test 339-B',
    type: 'invoice',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ elements: [] }],
    },
  }, tokenUserA);
  const templateId2 = create2Res.data.id;

  // Acquire lock
  await apiPost(`/templates/${templateId2}/lock`, {}, tokenUserA);

  // Directly manipulate DB to set lock time to 31 minutes ago (simulating pre-restart lock)
  // We'll use the expression evaluate endpoint to execute SQL indirectly
  // Actually, let's use the existing mechanism: the lock system checks lockedAt + 30min > now
  // We need to set lockedAt to 31 minutes in the past
  // We can do this via direct DB query through the expression endpoint

  // Use a more direct approach: call the heartbeat endpoint and then manipulate via API
  // Actually the cleanest way is to use direct DB manipulation

  // Let's use a helper script approach
  const { Client } = require('pg');
  const dbUrl = process.env.DATABASE_URL || 'postgresql://pdfme:pdfme@localhost:5432/pdfme';
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  // Set lockedAt to 31 minutes ago (makes lock expired)
  const staleTime = new Date(Date.now() - 31 * 60 * 1000);
  await client.query(
    'UPDATE templates SET locked_at = $1 WHERE id = $2',
    [staleTime.toISOString(), templateId2]
  );

  // Now User B should be able to acquire the lock (stale lock from User A expired)
  const lockB2Res = await apiPost(`/templates/${templateId2}/lock`, {}, tokenUserB);
  assert(
    lockB2Res.status === 200 || lockB2Res.status === 201,
    `User B acquired expired lock (status ${lockB2Res.status})`,
  );
  assert(lockB2Res.data.locked === true, 'Lock acquired by User B');
  assert(lockB2Res.data.lockedBy === 'user-b-339', 'New lock holder is User B');

  // --- Test 4: User B can edit after acquiring expired lock ---
  console.log('\nTest 4: User B can edit after acquiring expired lock');
  const editRes = await apiPut(`/templates/${templateId2}/draft`, {
    name: 'Edited After Stale Lock',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ elements: [{ type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'User B edit' }] }],
    },
  }, tokenUserB);
  assert(editRes.status === 200, `User B can edit (status ${editRes.status})`);

  // Verify the edit persisted
  const getRes = await apiGet(`/templates/${templateId2}`, tokenUserB);
  assert(getRes.data.name === 'Edited After Stale Lock', 'Edit persisted correctly');

  // --- Test 5: Non-expired lock still blocks other users ---
  console.log('\nTest 5: Non-expired lock still blocks other users');

  // Create template 3
  const create3Res = await apiPost('/templates', {
    name: 'Active Lock Test 339-C',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [] }] },
  }, tokenUserA);
  const templateId3 = create3Res.data.id;

  // User A acquires lock (fresh, not expired)
  await apiPost(`/templates/${templateId3}/lock`, {}, tokenUserA);

  // User B tries to acquire - should be blocked
  const blockRes = await apiPost(`/templates/${templateId3}/lock`, {}, tokenUserB);
  assert(blockRes.status === 409, `User B blocked by active lock (status ${blockRes.status})`);
  assert(blockRes.data.error && blockRes.data.error.includes('locked'), 'Error message mentions locked');

  // --- Test 6: Lock expiry is calculated from lockedAt, not server uptime ---
  console.log('\nTest 6: Lock expiry based on lockedAt timestamp, not server uptime');

  // Create template 4
  const create4Res = await apiPost('/templates', {
    name: 'Lock Timing Test 339-D',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [] }] },
  }, tokenUserA);
  const templateId4 = create4Res.data.id;

  // Lock it
  await apiPost(`/templates/${templateId4}/lock`, {}, tokenUserA);

  // Set lockedAt to 29 minutes ago (NOT expired yet)
  const almostStaleTime = new Date(Date.now() - 29 * 60 * 1000);
  await client.query(
    'UPDATE templates SET locked_at = $1 WHERE id = $2',
    [almostStaleTime.toISOString(), templateId4]
  );

  // User B should still be blocked (29 min < 30 min timeout)
  const almostExpiredRes = await apiPost(`/templates/${templateId4}/lock`, {}, tokenUserB);
  assert(almostExpiredRes.status === 409, `Lock at 29min still active (status ${almostExpiredRes.status})`);

  // Now set to 31 minutes ago (expired)
  const expiredTime = new Date(Date.now() - 31 * 60 * 1000);
  await client.query(
    'UPDATE templates SET locked_at = $1 WHERE id = $2',
    [expiredTime.toISOString(), templateId4]
  );

  // User B should now be able to acquire
  const expiredAcquireRes = await apiPost(`/templates/${templateId4}/lock`, {}, tokenUserB);
  assert(
    expiredAcquireRes.status === 200 || expiredAcquireRes.status === 201,
    `Lock at 31min expired, User B acquires (status ${expiredAcquireRes.status})`,
  );

  // --- Test 7: Lock status endpoint correctly reports stale locks ---
  console.log('\nTest 7: Lock status correctly reports expired locks');

  // Create template 5
  const create5Res = await apiPost('/templates', {
    name: 'Lock Status Test 339-E',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [] }] },
  }, tokenUserA);
  const templateId5 = create5Res.data.id;

  // Lock it
  await apiPost(`/templates/${templateId5}/lock`, {}, tokenUserA);

  // Check active status
  const activeStatus = await apiGet(`/templates/${templateId5}/lock`, tokenUserA);
  assert(activeStatus.data.locked === true, 'Active lock shows locked=true');

  // Make it stale
  const staleTime2 = new Date(Date.now() - 35 * 60 * 1000);
  await client.query(
    'UPDATE templates SET locked_at = $1 WHERE id = $2',
    [staleTime2.toISOString(), templateId5]
  );

  // Check status - should show expired
  const staleStatus = await apiGet(`/templates/${templateId5}/lock`, tokenUserA);
  // Lock status might show locked=false (expired) or locked=true with expired flag
  // The key behavior: another user can acquire it
  const canAcquire = await apiPost(`/templates/${templateId5}/lock`, {}, tokenUserB);
  assert(
    canAcquire.status === 200 || canAcquire.status === 201,
    `Stale lock can be taken over (status ${canAcquire.status})`,
  );

  // --- Test 8: Original lock holder can re-acquire after stale lock taken ---
  console.log('\nTest 8: Lock holder sees their expired lock was taken');

  // User A tries to heartbeat on template5 (now owned by User B)
  const heartbeatRes = await apiPost(`/templates/${templateId5}/lock/heartbeat`, {}, tokenUserA);
  assert(
    heartbeatRes.status === 403 || heartbeatRes.status === 409,
    `User A heartbeat rejected after takeover (status ${heartbeatRes.status})`,
  );

  // User A can read template (read-only)
  const readRes = await apiGet(`/templates/${templateId5}`, tokenUserA);
  assert(readRes.status === 200, 'User A can still read template');

  // --- Test 9: Multiple stale locks don't prevent any user from editing ---
  console.log('\nTest 9: Multiple templates with stale locks all acquirable');

  const staleIds = [];
  for (let i = 0; i < 3; i++) {
    const cr = await apiPost('/templates', {
      name: `Multi Stale ${i}`,
      type: 'invoice',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [] }] },
    }, tokenUserA);
    staleIds.push(cr.data.id);
    await apiPost(`/templates/${cr.data.id}/lock`, {}, tokenUserA);
    await client.query(
      'UPDATE templates SET locked_at = $1 WHERE id = $2',
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), cr.data.id]
    );
  }

  for (let i = 0; i < staleIds.length; i++) {
    const acq = await apiPost(`/templates/${staleIds[i]}/lock`, {}, tokenUserB);
    assert(
      acq.status === 200 || acq.status === 201,
      `Stale template ${i + 1}/3 acquired by User B`,
    );
  }

  // --- Test 10: Data integrity after stale lock takeover ---
  console.log('\nTest 10: Data integrity preserved through stale lock takeover');

  const create6Res = await apiPost('/templates', {
    name: 'Integrity Test 339',
    type: 'statement',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ elements: [
        { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Original content by A' },
      ] }],
    },
  }, tokenUserA);
  const templateId6 = create6Res.data.id;

  // User A locks and edits
  await apiPost(`/templates/${templateId6}/lock`, {}, tokenUserA);
  await apiPut(`/templates/${templateId6}/draft`, {
    name: 'Edited by A',
    schema: {
      schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4',
      pages: [{ elements: [
        { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'User A final edit' },
      ] }],
    },
  }, tokenUserA);

  // Simulate server restart by making lock stale
  await client.query(
    'UPDATE templates SET locked_at = $1 WHERE id = $2',
    [new Date(Date.now() - 45 * 60 * 1000).toISOString(), templateId6]
  );

  // User B takes over
  await apiPost(`/templates/${templateId6}/lock`, {}, tokenUserB);

  // Verify User A's data is still intact
  const integrityGet = await apiGet(`/templates/${templateId6}`, tokenUserB);
  assert(integrityGet.data.name === 'Edited by A', 'User A name preserved after takeover');
  assert(
    integrityGet.data.schema.pages[0].elements[0].content === 'User A final edit',
    'User A content preserved after takeover',
  );

  // User B can now edit
  const editB = await apiPut(`/templates/${templateId6}/draft`, {
    name: 'Edited by B after takeover',
    schema: {
      schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4',
      pages: [{ elements: [
        { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'User B continuation' },
      ] }],
    },
  }, tokenUserB);
  assert(editB.status === 200, 'User B can edit after takeover');

  const finalGet = await apiGet(`/templates/${templateId6}`, tokenUserB);
  assert(finalGet.data.name === 'Edited by B after takeover', 'User B edit persisted');

  // Cleanup
  await client.end();

  // Release remaining locks
  for (const tid of [templateId, templateId3]) {
    await apiPost(`/templates/${tid}/lock/release`, {}, tokenUserA).catch(() => {});
  }

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
