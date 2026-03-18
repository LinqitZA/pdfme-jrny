/**
 * Feature #202: Template edit lock visible to other users
 *
 * Verifies that when User A locks a template, User B can see the lock
 * indicator (lockedBy, lockedAt) in the template list API response.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const ORG_ID = 'test-org-202';
const USER_A = 'user-a-202';
const USER_B = 'user-b-202';
const TOKEN_A = makeJwt(USER_A, ORG_ID);
const TOKEN_B = makeJwt(USER_B, ORG_ID);

let templateId = null;

async function setup() {
  // Create a test template
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN_A}` },
    body: JSON.stringify({
      name: 'Lock Visible Test 202',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  const data = await res.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);
}

async function cleanup() {
  if (templateId) {
    // Release lock if any
    await fetch(`${API_BASE}/templates/${templateId}/lock?force=true`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN_A}` },
    });
    // Archive template
    await fetch(`${API_BASE}/templates/${templateId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN_A}` },
    });
  }
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

async function test_unlocked_template_has_no_lock_info() {
  console.log('\nTest: Unlocked template has no lock info in list');
  const res = await fetch(`${API_BASE}/templates?orgId=${ORG_ID}`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const data = await res.json();
  const tmpl = data.data.find(t => t.id === templateId);
  assert(tmpl !== undefined, 'Template found in list');
  assert(!tmpl.lockedBy, 'lockedBy is null/empty when unlocked');
  assert(!tmpl.lockedAt, 'lockedAt is null/empty when unlocked');
}

async function test_locked_template_shows_lock_info() {
  console.log('\nTest: User A locks template, User B sees lock info in list');

  // User A acquires lock
  const lockRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN_A}` },
  });
  const lockData = await lockRes.json();
  assert(lockRes.status === 200, `Lock acquired (status ${lockRes.status})`);
  assert(lockData.locked === true, 'Lock response indicates locked');
  assert(lockData.lockedBy === USER_A, `Lock holder is ${lockData.lockedBy}`);

  // User B lists templates
  const listRes = await fetch(`${API_BASE}/templates?orgId=${ORG_ID}`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const listData = await listRes.json();
  const tmpl = listData.data.find(t => t.id === templateId);

  assert(tmpl !== undefined, 'Template found in list by User B');
  assert(tmpl.lockedBy === USER_A, `lockedBy shows "${tmpl.lockedBy}" (expected "${USER_A}")`);
  assert(tmpl.lockedAt !== null && tmpl.lockedAt !== undefined, `lockedAt is present: ${tmpl.lockedAt}`);
}

async function test_lock_status_endpoint_by_other_user() {
  console.log('\nTest: User B can query lock status directly');
  const res = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const data = await res.json();
  assert(res.status === 200, `Lock status endpoint returns 200`);
  assert(data.locked === true, 'Lock status shows locked');
  assert(data.lockedBy === USER_A, `Lock holder is ${data.lockedBy}`);
  assert(data.expiresAt !== null, `expiresAt is present: ${data.expiresAt}`);
}

async function test_lock_holder_name_shown() {
  console.log('\nTest: Lock holder name is the user who locked it');
  const res = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const data = await res.json();
  assert(data.lockedBy === USER_A, `Lock holder name "${data.lockedBy}" matches User A "${USER_A}"`);
}

async function test_lock_release_clears_indicator() {
  console.log('\nTest: After lock release, lock info is cleared');

  // User A releases lock
  const releaseRes = await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${TOKEN_A}` },
  });
  const releaseData = await releaseRes.json();
  assert(releaseData.released === true, 'Lock released successfully');

  // User B checks list
  const listRes = await fetch(`${API_BASE}/templates?orgId=${ORG_ID}`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const listData = await listRes.json();
  const tmpl = listData.data.find(t => t.id === templateId);
  assert(tmpl !== undefined, 'Template still in list');
  assert(!tmpl.lockedBy, `lockedBy cleared after release (value: ${tmpl.lockedBy})`);
}

async function test_get_by_id_shows_lock() {
  console.log('\nTest: GET template by ID shows lock info');

  // Re-lock
  await fetch(`${API_BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN_A}` },
  });

  // User B gets by ID
  const res = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN_B}` },
  });
  const data = await res.json();
  assert(res.status === 200, 'Template returned successfully');
  assert(data.lockedBy === USER_A, `lockedBy on single template is "${data.lockedBy}"`);
  assert(data.lockedAt !== null, 'lockedAt present on single template');
}

async function run() {
  console.log('=== Feature #202: Template edit lock visible to other users ===');

  try {
    await setup();

    await test_unlocked_template_has_no_lock_info();
    await test_locked_template_shows_lock_info();
    await test_lock_status_endpoint_by_other_user();
    await test_lock_holder_name_shown();
    await test_lock_release_clears_indicator();
    await test_get_by_id_shows_lock();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
