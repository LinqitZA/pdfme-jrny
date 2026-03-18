/**
 * Tests for Feature #166: Database retry 2x on transient failure
 *
 * Verifies:
 * 1. Simulated transient DB error triggers first retry
 * 2. Second retry succeeds after two failures
 * 3. Failure after 2 attempts with proper error
 * 4. Non-transient errors are NOT retried
 */

const BASE = 'http://localhost:3000/api/pdfme';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

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

async function testFirstRetry() {
  console.log('\n--- Test: First retry on transient error ---');
  const { data } = await post('/health/test-db-retry', {
    failCount: 1,
    errorCode: '08006',
  });

  assert(data.success === true, 'Operation succeeds after 1 retry');
  assert(data.totalAttempts === 2, 'Total attempts is 2 (1 fail + 1 success)');
  assert(data.retriesNeeded === 1, 'Retries needed is 1');
  assert(data.retryLog.length === 2, 'Retry log has 2 entries');
  assert(data.retryLog[0].success === false, 'First attempt failed');
  assert(data.retryLog[1].success === true, 'Second attempt succeeded');
  assert(data.serverTime != null, 'Server time returned from real DB query');
}

async function testSecondRetry() {
  console.log('\n--- Test: Second retry on transient error ---');
  const { data } = await post('/health/test-db-retry', {
    failCount: 2,
    errorCode: '08006',
  });

  assert(data.success === true, 'Operation succeeds after 2 retries');
  assert(data.totalAttempts === 3, 'Total attempts is 3 (2 fails + 1 success)');
  assert(data.retriesNeeded === 2, 'Retries needed is 2');
  assert(data.retryLog.length === 3, 'Retry log has 3 entries');
  assert(data.retryLog[0].success === false, 'First attempt failed');
  assert(data.retryLog[1].success === false, 'Second attempt failed');
  assert(data.retryLog[2].success === true, 'Third attempt succeeded');
}

async function testFailureAfterMaxRetries() {
  console.log('\n--- Test: Failure after 2 retries exhausted ---');
  const { data } = await post('/health/test-db-retry', {
    failCount: 3,
    errorCode: '08006',
  });

  assert(data.success === false, 'Operation fails when retries exhausted');
  assert(data.totalAttempts === 3, 'Total attempts is 3 (max retries + 1)');
  assert(data.errorCode === 'DB_RETRY_EXHAUSTED', 'Error code is DB_RETRY_EXHAUSTED');
  assert(
    data.error.includes('failed after 3 attempts'),
    'Error message mentions 3 attempts',
  );
  assert(data.retryLog.length === 3, 'Retry log has 3 entries');
  assert(
    data.retryLog.every((e) => e.success === false),
    'All attempts failed',
  );
}

async function testTransientErrorCodes() {
  console.log('\n--- Test: Transient error code detection ---');

  const transientCodes = ['08000', '08006', '40001', '40P01', '57P03', 'ECONNRESET', 'ETIMEDOUT'];
  for (const code of transientCodes) {
    const { data } = await post('/health/check-transient-error', { code });
    assert(data.isTransient === true, `Code ${code} detected as transient`);
  }

  const nonTransientCodes = ['23505', '42P01', '22P02', '28000'];
  for (const code of nonTransientCodes) {
    const { data } = await post('/health/check-transient-error', { code });
    assert(data.isTransient === false, `Code ${code} detected as non-transient`);
  }
}

async function testTransientErrorMessages() {
  console.log('\n--- Test: Transient error message detection ---');

  const transientMessages = [
    'connection terminated unexpectedly',
    'connection reset by peer',
    'connection timed out',
    'the database system is starting up',
  ];
  for (const msg of transientMessages) {
    const { data } = await post('/health/check-transient-error', { message: msg });
    assert(data.isTransient === true, `Message "${msg}" detected as transient`);
  }

  const nonTransientMessages = ['syntax error at position 5', 'relation "foo" does not exist'];
  for (const msg of nonTransientMessages) {
    const { data } = await post('/health/check-transient-error', { message: msg });
    assert(data.isTransient === false, `Message "${msg}" detected as non-transient`);
  }
}

async function testDifferentTransientCodes() {
  console.log('\n--- Test: Retry works with different transient error codes ---');

  const codes = ['08006', '40001', '40P01', 'ECONNRESET'];
  for (const code of codes) {
    const { data } = await post('/health/test-db-retry', {
      failCount: 1,
      errorCode: code,
    });
    assert(
      data.success === true && data.totalAttempts === 2,
      `Retry succeeds with error code ${code}`,
    );
  }
}

async function testNoRetryOnSuccess() {
  console.log('\n--- Test: No retry needed on success ---');
  const { data } = await post('/health/test-db-retry', {
    failCount: 0,
    errorCode: '08006',
  });

  assert(data.success === true, 'Operation succeeds immediately');
  assert(data.totalAttempts === 1, 'Only 1 attempt needed');
  assert(data.retriesNeeded === 0, 'No retries needed');
  assert(data.retryLog.length === 1, 'Retry log has 1 entry');
  assert(data.retryLog[0].success === true, 'First attempt succeeded');
}

async function main() {
  console.log('=== Feature #166: Database retry 2x on transient failure ===');

  await testFirstRetry();
  await testSecondRetry();
  await testFailureAfterMaxRetries();
  await testTransientErrorCodes();
  await testTransientErrorMessages();
  await testDifferentTransientCodes();
  await testNoRetryOnSuccess();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
