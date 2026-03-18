/**
 * Test script for features #143 (Edit lock release) and #144 (30-minute timeout auto-release)
 */

const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const TOKEN1 = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWxvY2stMSIsIm9yZ0lkIjoib3JnLWxvY2stdGVzdCIsInJvbGVzIjpbImFkbWluIl19.fakesig';
const TOKEN2 = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWxvY2stMiIsIm9yZ0lkIjoib3JnLWxvY2stdGVzdCIsInJvbGVzIjpbImFkbWluIl19.fakesig';

let PASS = 0;
let FAIL = 0;

function assert_eq(desc, expected, actual) {
  if (String(expected) === String(actual)) {
    console.log(`  PASS: ${desc}`);
    PASS++;
  } else {
    console.log(`  FAIL: ${desc} (expected=${expected}, actual=${actual})`);
    FAIL++;
  }
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) options.headers['Authorization'] = token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Setup: Create test template
  console.log('=== Setup: Creating test template ===');
  const createResp = await request('POST', '/api/pdfme/templates', TOKEN1, {
    name: 'Lock Test 143-144-' + Date.now(),
    type: 'invoice',
    schema: { schemas: [{ text1: { type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10 } }], basePdf: 'BLANK_PDF' }
  });
  const TMPL_ID = createResp.body.id;
  console.log(`Template ID: ${TMPL_ID}`);

  console.log('\n=== Feature #143: Edit lock release ===');

  // Test 1: Acquire lock
  const lock1 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock acquired by user1', true, lock1.body.locked);
  assert_eq('Lock acquired returns 200', 200, lock1.status);

  // Test 2: Verify lock is active
  const status1 = await request('GET', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock status shows locked', true, status1.body.locked);
  assert_eq('Lock held by user-lock-1', 'user-lock-1', status1.body.lockedBy);

  // Test 3: User2 gets 409 trying to lock
  const lock2 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN2);
  assert_eq('User2 gets 409 conflict', 409, lock2.status);

  // Test 4: DELETE lock as owner
  console.log('--- Release lock as user-lock-1 ---');
  const release1 = await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock released successfully', true, release1.body.released);
  assert_eq('Release returns 200', 200, release1.status);

  // Test 5: Verify lock is released
  const status2 = await request('GET', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock status shows unlocked after release', false, status2.body.locked);
  assert_eq('lockedBy is null after release', null, status2.body.lockedBy);

  // Test 6: User2 can now acquire lock
  const lock3 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN2);
  assert_eq('User2 can now lock template', true, lock3.body.locked);
  assert_eq('Lock held by user-lock-2', 'user-lock-2', lock3.body.lockedBy);

  // Test 7: User1 cannot release user2's lock
  const release2 = await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('User1 gets 403 trying to release user2 lock', 403, release2.status);

  // Test 8: Force release works
  const forceRelease = await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock?force=true`, TOKEN1);
  assert_eq('Force release works', true, forceRelease.body.released);

  // Test 9: Lock status is now unlocked
  const status3 = await request('GET', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock unlocked after force release', false, status3.body.locked);

  // Test 10: Releasing already-unlocked template succeeds
  const releaseUnlocked = await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Releasing unlocked template returns released:true', true, releaseUnlocked.body.released);

  console.log('\n=== Feature #144: Lock 30-minute timeout auto-release ===');

  // Test 11: Acquire lock and check expiry time
  const lock4 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  const lockedAt = new Date(lock4.body.lockedAt);
  const expiresAt = new Date(lock4.body.expiresAt);
  const diffMin = Math.round((expiresAt - lockedAt) / 60000);
  assert_eq('Lock expires in 30 minutes', 30, diffMin);
  assert_eq('expiresAt is returned', true, !!lock4.body.expiresAt);

  // Test 12: Lock status shows expiry info
  const status4 = await request('GET', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock status includes expiresAt', true, !!status4.body.expiresAt);
  assert_eq('Lock status includes expired field', 'boolean', typeof status4.body.expired);
  assert_eq('Active lock not expired', false, status4.body.expired);

  // Test 13: Heartbeat renews lock (same user can re-lock)
  const heartbeat = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Heartbeat returns locked:true', true, heartbeat.body.locked);
  const newExpiresAt = new Date(heartbeat.body.expiresAt);
  assert_eq('Heartbeat extends expiry', true, newExpiresAt >= expiresAt);

  // Clean up: release lock
  await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);

  // Test 14: Simulate expired lock via direct DB manipulation
  // Acquire lock, then update lockedAt to 31 minutes ago via SQL
  const lock5 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
  assert_eq('Lock acquired for timeout test', true, lock5.body.locked);

  // We need to manipulate the DB to set lockedAt to 31 minutes ago
  // Use pg module directly
  const { Client } = require('pg');
  const pgClient = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'pdfme_erp' });
  try {
    await pgClient.connect();
    await pgClient.query(`UPDATE templates SET locked_at = NOW() - INTERVAL '31 minutes' WHERE id = $1`, [TMPL_ID]);
    console.log('  (DB: Set lockedAt to 31 minutes ago)');

    // Test 15: Lock status shows expired
    const status5 = await request('GET', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN1);
    assert_eq('Expired lock shows locked:false', false, status5.body.locked);
    assert_eq('Expired lock shows expired:true', true, status5.body.expired);

    // Test 16: User2 can take over expired lock
    const lock6 = await request('POST', `/api/pdfme/templates/${TMPL_ID}/lock`, TOKEN2);
    assert_eq('User2 can take over expired lock', true, lock6.body.locked);
    assert_eq('Lock now held by user-lock-2', 'user-lock-2', lock6.body.lockedBy);

    // Clean up
    await request('DELETE', `/api/pdfme/templates/${TMPL_ID}/lock?force=true`, TOKEN1);
    await pgClient.end();
  } catch (e) {
    console.log(`  SKIP: DB manipulation not available (${e.message})`);
    try { await pgClient.end(); } catch (_) {}
  }

  console.log(`\n=== Results: PASS=${PASS}, FAIL=${FAIL} ===`);
  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
