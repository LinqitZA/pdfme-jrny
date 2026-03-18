/**
 * Test Feature #197: Multi-tab editing shows lock warning
 *
 * Verifies that opening the same template in two tabs shows a warning:
 * 1. Open template in tab A - lock acquired
 * 2. Open same template in tab B
 * 3. Verify tab B shows read-only warning
 * 4. Verify lock holder identified
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

// Two different user tokens to simulate two tabs
const TOKEN_USER_A = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidXNlci1hbGljZSIsICJvcmdJZCI6ICJ0ZXN0LW9yZyIsICJyb2xlcyI6IFsidGVtcGxhdGU6ZWRpdCIsICJ0ZW1wbGF0ZTp2aWV3IiwgInRlbXBsYXRlOnB1Ymxpc2giLCAidGVtcGxhdGU6ZGVsZXRlIl19.sig';
const TOKEN_USER_B = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidXNlci1ib2IiLCAib3JnSWQiOiAidGVzdC1vcmciLCAicm9sZXMiOiBbInRlbXBsYXRlOmVkaXQiLCAidGVtcGxhdGU6dmlldyJdfQ==.sig';

let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

async function apiCall(method, path, body, token = TOKEN_USER_A) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function setup() {
  const res = await apiCall('POST', '/templates', {
    name: 'LOCK_TEST_197',
    type: 'invoice',
    orgId: 'test-org',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [] }
  });
  templateId = res.data?.id;
  console.log(`Created template: ${templateId}`);
  return templateId;
}

async function cleanup() {
  if (templateId) {
    // Release any locks first
    await apiCall('DELETE', `/templates/${templateId}/lock?force=true`, null, TOKEN_USER_A);
    await apiCall('DELETE', `/templates/${templateId}?orgId=test-org`, null, TOKEN_USER_A);
    console.log(`Cleaned up template: ${templateId}`);
  }
}

async function runTests() {
  console.log('\n=== Feature #197: Multi-tab editing shows lock warning ===\n');

  await setup();
  assert(!!templateId, 'Template created successfully');

  // Test 1: User A acquires lock (simulating opening in tab A)
  console.log('\n--- Test: User A acquires edit lock (tab A) ---');
  {
    const res = await apiCall('POST', `/templates/${templateId}/lock`, null, TOKEN_USER_A);
    assert(res.status === 200, `Lock acquired by user A (status: ${res.status})`);
    assert(res.data?.locked === true, `Lock confirmed: ${res.data?.locked}`);
    assert(res.data?.lockedBy === 'user-alice', `Lock held by user-alice: ${res.data?.lockedBy}`);
  }

  // Test 2: User B tries to acquire lock (simulating opening in tab B)
  console.log('\n--- Test: User B gets 409 conflict (tab B) ---');
  {
    const res = await apiCall('POST', `/templates/${templateId}/lock`, null, TOKEN_USER_B);
    assert(res.status === 409, `Lock conflict for user B (status: ${res.status})`);
    assert(res.data?.lockedBy === 'user-alice', `Lock holder identified as user-alice: ${res.data?.lockedBy}`);
    assert(!!res.data?.lockedAt, `Lock time provided: ${res.data?.lockedAt}`);
    assert(!!res.data?.expiresAt, `Lock expiry provided: ${res.data?.expiresAt}`);
    assert(res.data?.error === 'Conflict', `Error type is Conflict: ${res.data?.error}`);
    assert(res.data?.message?.includes('locked'), `Message mentions lock: "${res.data?.message}"`);
  }

  // Test 3: User B can still read the template (view in read-only)
  console.log('\n--- Test: User B can still read template ---');
  {
    const res = await apiCall('GET', `/templates/${templateId}?orgId=test-org`, null, TOKEN_USER_B);
    assert(res.status === 200, `Template readable by user B (status: ${res.status})`);
    assert(res.data?.name === 'LOCK_TEST_197', `Template data accessible: ${res.data?.name}`);
  }

  // Test 4: User B cannot save draft (409 lock conflict on draft save)
  console.log('\n--- Test: User B cannot save draft ---');
  {
    const res = await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'LOCK_TEST_197_MODIFIED_BY_B',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [] }
    }, TOKEN_USER_B);
    assert(res.status === 409, `Draft save blocked for user B (status: ${res.status})`);
    assert(res.data?.lockedBy === 'user-alice', `Lock holder in 409 response: ${res.data?.lockedBy}`);
  }

  // Test 5: Lock status endpoint shows lock info
  console.log('\n--- Test: Lock status endpoint ---');
  {
    const res = await apiCall('GET', `/templates/${templateId}/lock?orgId=test-org`, null, TOKEN_USER_B);
    assert(res.status === 200, `Lock status retrieved (status: ${res.status})`);
    assert(res.data?.locked === true, `Template is locked: ${res.data?.locked}`);
    assert(res.data?.lockedBy === 'user-alice', `Locked by user-alice: ${res.data?.lockedBy}`);
    assert(!!res.data?.expiresAt, `Expiry time available: ${res.data?.expiresAt}`);
    assert(res.data?.expired === false, `Lock not expired: ${res.data?.expired}`);
  }

  // Test 6: Same user (User A) can re-acquire lock (heartbeat/refresh)
  console.log('\n--- Test: Same user can refresh lock (heartbeat) ---');
  {
    const res = await apiCall('POST', `/templates/${templateId}/lock`, null, TOKEN_USER_A);
    assert(res.status === 200, `Lock refreshed by user A (status: ${res.status})`);
    assert(res.data?.locked === true, `Lock still held: ${res.data?.locked}`);
    assert(res.data?.lockedBy === 'user-alice', `Still held by user-alice: ${res.data?.lockedBy}`);
  }

  // Test 7: User A can save draft (lock holder can still save)
  console.log('\n--- Test: Lock holder (User A) can save draft ---');
  {
    const res = await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'LOCK_TEST_197_SAVED_BY_A',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ id: 'p1', label: 'Page 1', elements: [] }] }
    }, TOKEN_USER_A);
    assert(res.status === 200, `Draft saved by lock holder (status: ${res.status})`);
  }

  // Test 8: Release lock, then User B can acquire
  console.log('\n--- Test: After lock release, User B can acquire ---');
  {
    const releaseRes = await apiCall('DELETE', `/templates/${templateId}/lock`, null, TOKEN_USER_A);
    assert(releaseRes.data?.released === true, `Lock released by user A: ${releaseRes.data?.released}`);

    const acquireRes = await apiCall('POST', `/templates/${templateId}/lock`, null, TOKEN_USER_B);
    assert(acquireRes.status === 200, `Lock acquired by user B after release (status: ${acquireRes.status})`);
    assert(acquireRes.data?.lockedBy === 'user-bob', `Now locked by user-bob: ${acquireRes.data?.lockedBy}`);

    // Now user A gets 409
    const conflictRes = await apiCall('POST', `/templates/${templateId}/lock`, null, TOKEN_USER_A);
    assert(conflictRes.status === 409, `User A now gets conflict (status: ${conflictRes.status})`);
    assert(conflictRes.data?.lockedBy === 'user-bob', `Lock holder is user-bob: ${conflictRes.data?.lockedBy}`);
  }

  // Test 9: Verify UI component renders lock warning (code structure)
  console.log('\n--- Test: UI component has lock warning elements ---');
  {
    // Read ErpDesigner source to verify lock warning implementation
    const fs = require('fs');
    const source = fs.readFileSync('apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

    assert(source.includes('lock-warning-banner'), 'Component has lock-warning-banner test ID');
    assert(source.includes('lock-warning-message'), 'Component has lock-warning-message test ID');
    assert(source.includes('lock-holder'), 'Component has lock-holder test ID');
    assert(source.includes('isReadOnly'), 'Component has isReadOnly state');
    assert(source.includes('lockHolder'), 'Component has lockHolder state');
    assert(source.includes('read-only mode'), 'Component shows read-only mode message');
    assert(source.includes('/lock'), 'Component calls lock API endpoint');
    assert(source.includes('409'), 'Component handles 409 conflict');
    assert(source.includes('lockExpiresAt'), 'Component tracks lock expiry');

    // Verify save button disabled when read-only
    assert(source.includes("disabled={saveStatus === 'saving' || isReadOnly}"), 'Save button disabled when read-only');
    assert(source.includes("disabled={publishStatus === 'publishing' || isReadOnly}"), 'Publish button disabled when read-only');

    // Verify auto-save skips when read-only
    assert(source.includes('isReadOnly) return'), 'Auto-save skips when read-only');
  }

  // Clean up: release lock from user B, then delete
  await apiCall('DELETE', `/templates/${templateId}/lock?force=true`, null, TOKEN_USER_A);
  await cleanup();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed (${passed + failed} total) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  cleanup().then(() => process.exit(1));
});
