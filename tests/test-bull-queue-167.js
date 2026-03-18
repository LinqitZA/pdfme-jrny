/**
 * Tests for Feature #167: Bull queue attempts 3 times
 *
 * Verifies:
 * 1. Create job that fails on first attempt - retries and succeeds
 * 2. Verify 3 attempts total for persistent failures
 * 3. If succeeds on retry - job marked done
 * 4. If fails all 3 - moved to DLQ
 */

const BASE = 'http://localhost:3000/api/pdfme/queue';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json() };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL ${msg}`);
    failed++;
  }
}

async function testSuccessNoRetry() {
  console.log('\n--- Test: Job succeeds on first attempt (no retry needed) ---');

  const { data: submitData } = await post('/test-retry', { failCount: 0 });
  assert(submitData.queued === true, 'Job queued successfully');
  assert(submitData.maxAttempts === 3, 'Max attempts is 3');

  const jobId = submitData.jobId;

  const { data: waitData } = await get(`/jobs/${jobId}/wait?timeout=10000`);
  assert(waitData.result !== null, 'Job completed');
  assert(waitData.result.status === 'done', 'Job status is done');
  assert(waitData.result.attempts === 1, 'Completed on 1st attempt');
  assert(waitData.jobStatus.state === 'completed', 'Job state is completed');
  assert(waitData.jobStatus.attemptsMade === 1, 'Only 1 attempt made');
}

async function testRetryOnceAndSucceed() {
  console.log('\n--- Test: Job fails once, succeeds on retry ---');

  const { data: submitData } = await post('/test-retry', { failCount: 1 });
  const jobId = submitData.jobId;

  // Wait longer for retry with backoff
  await sleep(3000);
  const { data: waitData } = await get(`/jobs/${jobId}/wait?timeout=15000`);

  assert(waitData.result !== null, 'Job completed after retry');
  assert(waitData.result.status === 'done', 'Job status is done');
  assert(waitData.result.attempts === 2, 'Completed on 2nd attempt');
  assert(waitData.jobStatus.state === 'completed', 'Job state is completed');
  assert(waitData.jobStatus.attemptsMade === 2, 'attemptsMade is 2');

  // Verify attempt log shows failure then success
  const log = waitData.jobStatus.attemptLog;
  assert(log.length === 2, 'Attempt log has 2 entries');
  assert(log[0] && log[0].success === false, '1st attempt was a failure');
  assert(log[1] && log[1].success === true, '2nd attempt was a success');
}

async function testRetryTwiceAndSucceed() {
  console.log('\n--- Test: Job fails twice, succeeds on 3rd attempt ---');

  const { data: submitData } = await post('/test-retry', { failCount: 2 });
  const jobId = submitData.jobId;

  // Wait longer for 2 retries with exponential backoff
  await sleep(5000);
  const { data: waitData } = await get(`/jobs/${jobId}/wait?timeout=20000`);

  assert(waitData.result !== null, 'Job completed after 2 retries');
  assert(waitData.result.status === 'done', 'Job status is done');
  assert(waitData.result.attempts === 3, 'Completed on 3rd attempt');
  assert(waitData.jobStatus.state === 'completed', 'Job state is completed');
  assert(waitData.jobStatus.attemptsMade === 3, '3 attempts made');

  // Verify attempt log
  const log = waitData.jobStatus.attemptLog;
  assert(log.length === 3, 'Attempt log has 3 entries');
  assert(log[0] && log[0].success === false, '1st attempt failed');
  assert(log[1] && log[1].success === false, '2nd attempt failed');
  assert(log[2] && log[2].success === true, '3rd attempt succeeded');
}

async function testFailAllThreeMoveToDlq() {
  console.log('\n--- Test: Job fails all 3 attempts, moved to DLQ ---');

  // Get initial DLQ count
  const { data: dlqBefore } = await get('/dlq');
  const dlqCountBefore = dlqBefore.count;

  const { data: submitData } = await post('/test-retry', { failCount: 3 });
  const jobId = submitData.jobId;
  assert(submitData.expectedOutcome === 'moved_to_dlq', 'Expected outcome is DLQ');

  // Wait for all retries with exponential backoff (1s + 2s + processing time)
  await sleep(8000);
  const { data: waitData } = await get(`/jobs/${jobId}/wait?timeout=15000`);

  assert(waitData.result !== null, 'Job result available');
  assert(waitData.result.status === 'failed', 'Job status is failed');
  assert(waitData.result.attempts === 3, 'All 3 attempts made');
  assert(waitData.jobStatus.state === 'failed', 'Job state is failed');

  // Verify attempt log shows 3 failures
  const log = waitData.jobStatus.attemptLog;
  assert(log.length === 3, 'Attempt log has 3 entries');
  assert(log.every(e => e.success === false), 'All 3 attempts failed');

  // Verify DLQ has the job
  const { data: dlqAfter } = await get('/dlq');
  assert(dlqAfter.count > dlqCountBefore, 'DLQ count increased');

  const dlqJob = dlqAfter.jobs.find(j => j.originalJobId === jobId);
  assert(dlqJob !== undefined, 'Failed job found in DLQ');
  if (dlqJob) {
    assert(dlqJob.attempts === 3, 'DLQ job shows 3 attempts');
    assert(dlqJob.error.includes('Simulated render failure'), 'DLQ job has error message');
  }
}

async function testQueueStats() {
  console.log('\n--- Test: Queue statistics ---');

  const { data } = await get('/stats');
  assert(typeof data.waiting === 'number', 'Stats includes waiting count');
  assert(typeof data.active === 'number', 'Stats includes active count');
  assert(typeof data.completed === 'number', 'Stats includes completed count');
  assert(typeof data.failed === 'number', 'Stats includes failed count');
  assert(typeof data.dlq === 'number', 'Stats includes DLQ count');
  assert(data.completed > 0, 'Some jobs completed');
  assert(data.dlq > 0, 'DLQ has failed jobs');
}

async function main() {
  console.log('=== Feature #167: Bull queue attempts 3 times ===');

  // Drain first for clean state
  await post('/drain');
  await sleep(500);

  await testSuccessNoRetry();
  await testRetryOnceAndSucceed();
  await testRetryTwiceAndSucceed();
  await testFailAllThreeMoveToDlq();
  await testQueueStats();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
