/**
 * Test Feature #165: Dead letter queue for failed render jobs
 * - Failed jobs after all retries go to DLQ
 */
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
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

async function cleanup() {
  console.log('  Draining queues...');
  await request('POST', '/api/pdfme/queue/drain');
}

async function test1_submitJobThatSucceeds() {
  console.log('\nTest 1: Submit job that succeeds (no DLQ)');
  const res = await request('POST', '/api/pdfme/queue/test-retry', {
    failCount: 0,
    entityId: `success-${Date.now()}`,
  });
  assert('Job queued', res.body.queued === true);
  assert('Has jobId', !!res.body.jobId);
  assert('Expected outcome: success', res.body.expectedOutcome === 'success_after_retries');

  // Wait for job
  const waitRes = await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}/wait?timeout=15000`);
  assert('Job completed', waitRes.body.result?.status === 'done');

  // DLQ should be empty
  const dlqRes = await request('GET', '/api/pdfme/queue/dlq');
  assert('DLQ count is 0', dlqRes.body.count === 0);
}

async function test2_submitJobThatFailsOnceAndRetries() {
  console.log('\nTest 2: Job fails once then succeeds on retry');
  const entityId = `retry1-${Date.now()}`;
  const res = await request('POST', '/api/pdfme/queue/test-retry', {
    failCount: 1,
    entityId,
  });
  assert('Job queued', res.body.queued === true);

  // Wait for completion
  const waitRes = await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}/wait?timeout=15000`);
  assert('Job succeeded after retry', waitRes.body.result?.status === 'done');

  // Check attempt log
  const statusRes = await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}`);
  assert('Attempt log has entries', statusRes.body.attemptLog?.length >= 1);

  // DLQ should still be empty
  const dlqRes = await request('GET', '/api/pdfme/queue/dlq');
  assert('DLQ still empty', dlqRes.body.count === 0);
}

async function test3_submitJobThatExhaustsRetries() {
  console.log('\nTest 3: Job fails all 3 attempts -> moved to DLQ');
  const entityId = `dlq-${Date.now()}`;
  const res = await request('POST', '/api/pdfme/queue/test-retry', {
    failCount: 3,
    entityId,
  });
  assert('Job queued', res.body.queued === true);
  assert('Expected outcome: moved_to_dlq', res.body.expectedOutcome === 'moved_to_dlq');

  // Wait for job to fail all attempts (takes a few seconds with backoff)
  const waitRes = await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}/wait?timeout=30000`);
  assert('Job ultimately failed', waitRes.body.result?.status === 'failed');

  // Check that job was moved to DLQ
  // Give a moment for DLQ insertion
  await new Promise(r => setTimeout(r, 1000));
  const dlqRes = await request('GET', '/api/pdfme/queue/dlq');
  assert('DLQ has at least 1 job', dlqRes.body.count >= 1);

  // Verify DLQ job contains error details
  const dlqJobs = dlqRes.body.jobs;
  const dlqJob = dlqJobs.find(j => j.originalJobId === res.body.jobId);
  assert('DLQ job has original job ID', !!dlqJob);
  assert('DLQ job has error message', !!dlqJob?.error);
  assert('Error mentions simulated failure', dlqJob?.error?.includes('Simulated'));
  assert('DLQ job has original data', !!dlqJob?.data);
  assert('DLQ job has failedAt timestamp', !!dlqJob?.failedAt);
  assert('DLQ job shows 3 attempts', dlqJob?.attempts === 3);
}

async function test4_verifyRetryAttemptsInLog() {
  console.log('\nTest 4: Verify 3 retry attempts logged');
  const entityId = `log-${Date.now()}`;
  const res = await request('POST', '/api/pdfme/queue/test-retry', {
    failCount: 3,
    entityId,
  });

  // Wait for failure
  await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}/wait?timeout=30000`);

  // Check attempt log
  const statusRes = await request('GET', `/api/pdfme/queue/jobs/${res.body.jobId}`);
  const log = statusRes.body.attemptLog || [];
  assert('Has 3 attempt log entries', log.length === 3);
  assert('All attempts failed', log.every(e => e.success === false));
  assert('Attempt 1 logged', log.some(e => e.attempt === 1));
  assert('Attempt 2 logged', log.some(e => e.attempt === 2));
  assert('Attempt 3 logged', log.some(e => e.attempt === 3));
}

async function test5_queueStatsReflectDlq() {
  console.log('\nTest 5: Queue stats reflect DLQ count');
  const statsRes = await request('GET', '/api/pdfme/queue/stats');
  assert('Stats has dlq count', typeof statsRes.body.dlq === 'number');
  assert('DLQ count >= 2 (from tests 3 & 4)', statsRes.body.dlq >= 2);
  assert('Stats has failed count', typeof statsRes.body.failed === 'number');
}

async function main() {
  console.log('=== Feature #165: Dead letter queue for failed render jobs ===\n');

  await cleanup();

  await test1_submitJobThatSucceeds();
  await test2_submitJobThatFailsOnceAndRetries();
  await test3_submitJobThatExhaustsRetries();
  await test4_verifyRetryAttemptsInLog();
  await test5_queueStatsReflectDlq();

  // Cleanup
  await cleanup();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
