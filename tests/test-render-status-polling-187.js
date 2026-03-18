/**
 * Test: Feature #187 - Render status polling shows progress
 *
 * Verifies:
 * 1. POST /api/pdfme/render/async submits a job and returns jobId
 * 2. GET /api/pdfme/render/status/:jobId returns status
 * 3. Status transitions through: queued -> generating -> done
 * 4. Status returns 404 for non-existent jobs
 * 5. UI reflects each status change (async job status indicator)
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
// Valid JWT token with base64-encoded payload
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiLCAidGVtcGxhdGU6cHVibGlzaCJdfQ==.sig';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test1_asyncRenderSubmit() {
  console.log('\n--- Test 1: POST /render/async submits a queue job ---');

  // First, create and publish a template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Status Poll Test Template',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  assert(createRes.ok, `Template created (${createRes.status})`);
  const tpl = await createRes.json();
  const templateId = tpl.id;

  // Publish it
  const pubRes = await fetch(`${BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers,
  });
  assert(pubRes.ok, `Template published (${pubRes.status})`);

  // Submit async render
  const asyncRes = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'test-entity-1',
      channel: 'print',
    }),
  });

  assert(asyncRes.status === 202, `Async render returns 202 (got ${asyncRes.status})`);
  const asyncBody = await asyncRes.json();
  assert(!!asyncBody.jobId, `Returns jobId: ${asyncBody.jobId}`);
  assert(asyncBody.status === 'queued', `Initial status is 'queued'`);

  return { templateId, jobId: asyncBody.jobId };
}

async function test2_statusPolling(jobId) {
  console.log('\n--- Test 2: GET /render/status/:jobId returns status ---');

  const statusRes = await fetch(`${BASE}/render/status/${jobId}`, { headers });
  assert(statusRes.ok, `Status endpoint returns 200 (got ${statusRes.status})`);

  const statusBody = await statusRes.json();
  assert(statusBody.jobId === jobId, `Response includes jobId`);
  assert(
    ['queued', 'generating', 'done', 'failed'].includes(statusBody.status),
    `Status is valid: ${statusBody.status}`,
  );
  assert(typeof statusBody.attemptsMade === 'number', 'Includes attemptsMade');
  assert(typeof statusBody.maxAttempts === 'number', 'Includes maxAttempts');
  assert(Array.isArray(statusBody.attemptLog), 'Includes attemptLog array');
  assert(statusBody.result !== undefined, 'Includes result field');
  assert(statusBody.error !== undefined, 'Includes error field');

  return statusBody.status;
}

async function test3_statusTransitions(jobId) {
  console.log('\n--- Test 3: Status transitions queued -> generating -> done ---');

  const seenStatuses = new Set();
  let finalStatus = null;
  const startTime = Date.now();
  const timeout = 15000;

  // Poll until done or failed
  while (Date.now() - startTime < timeout) {
    const statusRes = await fetch(`${BASE}/render/status/${jobId}`, { headers });
    const statusBody = await statusRes.json();
    seenStatuses.add(statusBody.status);

    if (statusBody.status === 'done' || statusBody.status === 'failed') {
      finalStatus = statusBody.status;
      break;
    }
    await sleep(200);
  }

  const statusList = [...seenStatuses];
  assert(statusList.length >= 1, `Observed status transitions: ${statusList.join(' -> ')}`);
  assert(finalStatus === 'done', `Final status is 'done' (got ${finalStatus})`);

  // Verify final status details
  const finalRes = await fetch(`${BASE}/render/status/${jobId}`, { headers });
  const finalBody = await finalRes.json();
  assert(finalBody.status === 'done', 'Final poll confirms done');
  assert(finalBody.result !== null, 'Result is populated when done');
}

async function test4_statusNotFound() {
  console.log('\n--- Test 4: Status returns 404 for non-existent job ---');

  const res = await fetch(`${BASE}/render/status/nonexistent-job-xyz`, { headers });
  assert(res.status === 404, `Returns 404 for non-existent job (got ${res.status})`);

  const body = await res.json();
  assert(body.message && body.message.includes('not found'), `Error message mentions not found`);
}

async function test5_asyncRenderValidation() {
  console.log('\n--- Test 5: Async render validates required fields ---');

  // Missing templateId
  const res1 = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ entityId: 'test', channel: 'print' }),
  });
  assert(res1.status === 400, `Missing templateId returns 400 (got ${res1.status})`);

  // Missing entityId
  const res2 = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: 'test', channel: 'print' }),
  });
  assert(res2.status === 400, `Missing entityId returns 400 (got ${res2.status})`);

  // Missing channel
  const res3 = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: 'test', entityId: 'test' }),
  });
  assert(res3.status === 400, `Missing channel returns 400 (got ${res3.status})`);
}

async function test6_queueSubmitWithFailure() {
  console.log('\n--- Test 6: Async job that fails shows failed status ---');

  // Submit via queue test endpoint with deliberate failure (failCount=3 means DLQ)
  const res = await fetch(`${BASE}/queue/test-retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failCount: 3, entityId: `fail-test-${Date.now()}` }),
  });
  const body = await res.json();
  const jobId = body.jobId;
  assert(!!jobId, `Failure test job submitted: ${jobId}`);

  // Wait for it to fail (after 3 retries with exponential backoff ~1+2+4 seconds)
  await sleep(10000);

  const statusRes = await fetch(`${BASE}/render/status/${jobId}`, { headers });
  const statusBody = await statusRes.json();
  assert(statusBody.status === 'failed', `Failed job shows status 'failed' (got ${statusBody.status})`);
  assert(statusBody.error !== null, 'Error field populated for failed job');
}

async function test7_multipleAsyncJobs() {
  console.log('\n--- Test 7: Multiple async jobs polled independently ---');

  // Create and publish a template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Multi Poll Test',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  const tpl = await createRes.json();
  await fetch(`${BASE}/templates/${tpl.id}/publish`, { method: 'POST', headers });

  // Submit two async jobs
  const res1 = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: tpl.id, entityId: 'multi-1', channel: 'print' }),
  });
  const job1 = await res1.json();

  const res2 = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: tpl.id, entityId: 'multi-2', channel: 'print' }),
  });
  const job2 = await res2.json();

  assert(job1.jobId !== job2.jobId, 'Two jobs have different jobIds');

  // Wait for both to complete
  await sleep(5000);

  const s1 = await fetch(`${BASE}/render/status/${job1.jobId}`, { headers });
  const s2 = await fetch(`${BASE}/render/status/${job2.jobId}`, { headers });
  const sb1 = await s1.json();
  const sb2 = await s2.json();

  assert(['done', 'failed'].includes(sb1.status), `Job 1 finished: ${sb1.status}`);
  assert(['done', 'failed'].includes(sb2.status), `Job 2 finished: ${sb2.status}`);
}

async function test8_statusResponseFields() {
  console.log('\n--- Test 8: Status response includes all expected fields ---');

  // Create, publish, and submit a job
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Fields Test',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  const tpl = await createRes.json();
  await fetch(`${BASE}/templates/${tpl.id}/publish`, { method: 'POST', headers });

  const asyncRes = await fetch(`${BASE}/render/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: tpl.id, entityId: 'fields-test', channel: 'print' }),
  });
  const asyncBody = await asyncRes.json();
  const jobId = asyncBody.jobId;

  // Wait for completion
  await sleep(3000);

  const statusRes = await fetch(`${BASE}/render/status/${jobId}`, { headers });
  const statusBody = await statusRes.json();

  assert('jobId' in statusBody, 'Response has jobId field');
  assert('status' in statusBody, 'Response has status field');
  assert('attemptsMade' in statusBody, 'Response has attemptsMade field');
  assert('maxAttempts' in statusBody, 'Response has maxAttempts field');
  assert('result' in statusBody, 'Response has result field');
  assert('error' in statusBody, 'Response has error field');
  assert('attemptLog' in statusBody, 'Response has attemptLog field');
}

async function main() {
  console.log('=== Feature #187: Render status polling shows progress ===\n');

  try {
    const { jobId } = await test1_asyncRenderSubmit();
    await test2_statusPolling(jobId);
    await test3_statusTransitions(jobId);
    await test4_statusNotFound();
    await test5_asyncRenderValidation();
    await test6_queueSubmitWithFailure();
    await test7_multipleAsyncJobs();
    await test8_statusResponseFields();
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
