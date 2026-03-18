/**
 * Test for Feature #160: API returns 409 on edit lock conflict
 * Steps:
 * 1. User A acquires lock
 * 2. User B tries to save draft
 * 3. Verify 409 Conflict response
 * 4. Verify message identifies lock holder
 */

const BASE = 'http://localhost:3000/api/pdfme';

// Create JWT tokens for two different users in the same org
function makeJwt(sub, orgId = 'org-lock-test') {
  const payload = { sub, orgId, roles: ['user'] };
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

const TOKEN_A = makeJwt('user-a-160');
const TOKEN_B = makeJwt('user-b-160');

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

async function run() {
  console.log('=== Feature #160: API returns 409 on edit lock conflict ===\n');

  // 1. Create a template
  console.log('Step 1: Create template');
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
    body: JSON.stringify({
      name: 'Lock Conflict Test 160',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  const template = await createRes.json();
  assert(createRes.status === 201, `Template created (${template.id})`);
  const templateId = template.id;

  // 2. User A acquires lock
  console.log('\nStep 2: User A acquires lock');
  const lockRes = await fetch(`${BASE}/templates/${templateId}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
  });
  const lockData = await lockRes.json();
  assert(lockRes.status === 200, 'User A acquired lock (200)');
  assert(lockData.locked === true, 'Lock confirmed active');
  assert(lockData.lockedBy === 'user-a-160', 'Lock holder is user-a-160');

  // 3. User B tries to save draft -> should get 409
  console.log('\nStep 3: User B tries to save draft');
  const draftRes = await fetch(`${BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
    body: JSON.stringify({ schema: { pages: [{ elements: [{ type: 'text' }] }] } }),
  });
  const draftData = await draftRes.json();
  assert(draftRes.status === 409, `Save draft returns 409 Conflict (got ${draftRes.status})`);
  assert(draftData.error === 'Conflict', `Error field is "Conflict"`);
  assert(draftData.lockedBy === 'user-a-160', 'Response identifies lock holder (user-a-160)');
  assert(typeof draftData.message === 'string' && draftData.message.includes('user-a-160'), 'Message mentions lock holder');
  assert(draftData.expiresAt !== undefined, 'Response includes expiresAt');
  assert(draftData.lockedAt !== undefined, 'Response includes lockedAt');

  // 4. User B tries to update template -> also 409
  console.log('\nStep 4: User B tries PUT update');
  const updateRes = await fetch(`${BASE}/templates/${templateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
    body: JSON.stringify({ name: 'Hijacked Name' }),
  });
  const updateData = await updateRes.json();
  assert(updateRes.status === 409, `PUT update returns 409 (got ${updateRes.status})`);
  assert(updateData.lockedBy === 'user-a-160', 'PUT update response identifies lock holder');

  // 5. User A (lock holder) CAN still save draft
  console.log('\nStep 5: User A (lock holder) saves draft');
  const aDraftRes = await fetch(`${BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
    body: JSON.stringify({ schema: { pages: [{ elements: [{ type: 'text', name: 'by-user-a' }] }] } }),
  });
  assert(aDraftRes.status === 200, `Lock holder can save draft (${aDraftRes.status})`);

  // 6. After lock release, User B CAN save draft
  console.log('\nStep 6: Release lock, then User B saves');
  const releaseRes = await fetch(`${BASE}/templates/${templateId}/lock?force=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN_A}` },
  });
  assert(releaseRes.status === 200, 'Lock released');

  const bDraftRes = await fetch(`${BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
    body: JSON.stringify({ name: 'Updated by B after release' }),
  });
  assert(bDraftRes.status === 200, `User B can save after lock release (${bDraftRes.status})`);

  // 7. No lock -> no conflict (both can save)
  console.log('\nStep 7: No lock - User A saves without conflict');
  const noLockRes = await fetch(`${BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
    body: JSON.stringify({ name: 'No lock save' }),
  });
  assert(noLockRes.status === 200, 'No lock - save succeeds without conflict');

  // Cleanup
  await fetch(`${BASE}/templates/${templateId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN_A}` },
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
