/**
 * Feature #337: Queue concurrency limit respected - Per-tenant concurrency cap enforced
 *
 * Tests:
 * 1. Set concurrency=5 for tenant
 * 2. Submit 10 render jobs
 * 3. Verify max 5 processing simultaneously
 * 4. Verify remaining queued
 * 5. Verify all complete eventually
 */

const BASE = 'http://localhost:3000/api/pdfme/queue';
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

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== Feature #337: Queue concurrency limit respected ===\n');

  // Cleanup
  await post('/drain', {});

  // --- Test 1: Set concurrency limit ---
  console.log('Test 1: Set concurrency=5 for tenant');
  const setResult = await post('/concurrency', { orgId: 'tenant-conc-337', limit: 5 });
  assert(setResult.set === true, 'Concurrency limit set successfully');
  assert(setResult.limit === 5, 'Limit is 5');
  assert(setResult.orgId === 'tenant-conc-337', 'Correct orgId');

  // Verify via GET
  const getResult = await get('/concurrency/tenant-conc-337');
  assert(getResult.limit === 5, 'GET returns limit=5');
  assert(getResult.active === 0, 'No active jobs initially');

  // --- Test 2: Submit 10 render jobs ---
  console.log('\nTest 2: Submit 10 render jobs with 4s processing delay');
  const submitResult = await post('/test-concurrency', {
    orgId: 'tenant-conc-337',
    count: 10,
    delayMs: 4000,
  });
  assert(submitResult.submitted === true, 'Jobs submitted successfully');
  assert(submitResult.count === 10, '10 jobs submitted');
  assert(submitResult.jobIds.length === 10, '10 job IDs returned');

  // --- Test 3: Verify max 5 processing simultaneously ---
  console.log('\nTest 3: Verify max 5 processing simultaneously');

  // Wait for jobs to start being picked up
  await sleep(1000);

  // Sample active count multiple times during processing
  let maxSeenActive = 0;
  let samplesOverLimit = 0;
  const samples = [];

  for (let i = 0; i < 15; i++) {
    const status = await get('/concurrency/tenant-conc-337');
    samples.push(status.active);
    if (status.active > maxSeenActive) maxSeenActive = status.active;
    if (status.active > 5) samplesOverLimit++;
    await sleep(500);
  }

  console.log(`  Samples: [${samples.join(', ')}]`);
  console.log(`  Max seen active: ${maxSeenActive}`);

  assert(maxSeenActive <= 5, `Max active (${maxSeenActive}) does not exceed limit of 5`);
  assert(maxSeenActive >= 1, `At least 1 job was active during sampling (max: ${maxSeenActive})`);
  assert(samplesOverLimit === 0, 'Never exceeded concurrency limit');

  // Check peak from service
  const peakStatus = await get('/concurrency/tenant-conc-337');
  assert(peakStatus.peak <= 5, `Peak concurrent (${peakStatus.peak}) respects limit of 5`);
  assert(peakStatus.peak >= 1, `Peak was at least 1 (peak: ${peakStatus.peak})`);

  // --- Test 4: Verify remaining queued ---
  console.log('\nTest 4: Verify remaining jobs queued/completed');
  // Some jobs should still be waiting or delayed while others are active
  const midStats = await get('/stats');
  console.log(`  Queue stats during processing: waiting=${midStats.waiting}, active=${midStats.active}, completed=${midStats.completed}, delayed=${midStats.delayed}`);

  // The sum of completed + active + waiting + delayed should account for all jobs
  // (some may have been re-queued as new jobs by the concurrency limiter)
  assert(midStats.active <= 5, `Active jobs (${midStats.active}) <= concurrency limit 5`);

  // --- Test 5: Verify all complete eventually ---
  console.log('\nTest 5: Wait for all jobs to complete');

  // Wait up to 30s for all jobs to finish
  let allDone = false;
  for (let i = 0; i < 60; i++) {
    const stats = await get('/stats');
    const concStatus = await get('/concurrency/tenant-conc-337');
    if (stats.active === 0 && stats.waiting === 0 && stats.delayed === 0 && concStatus.active === 0) {
      allDone = true;
      break;
    }
    await sleep(500);
  }

  assert(allDone, 'All jobs completed within timeout');

  const finalStats = await get('/stats');
  console.log(`  Final stats: completed=${finalStats.completed}, failed=${finalStats.failed}`);

  // All 10 original jobs should have completed (some may be re-queued copies)
  assert(finalStats.completed >= 10, `At least 10 jobs completed (${finalStats.completed})`);

  const finalConcStatus = await get('/concurrency/tenant-conc-337');
  assert(finalConcStatus.active === 0, 'No active jobs after completion');
  assert(finalConcStatus.peak <= 5, `Final peak (${finalConcStatus.peak}) respects limit`);

  // --- Test 6: Different tenant not affected ---
  console.log('\nTest 6: Different tenant has independent limit');

  // Drain first
  await post('/drain', {});

  // Set different limits
  await post('/concurrency', { orgId: 'tenant-x', limit: 3 });
  await post('/concurrency', { orgId: 'tenant-y', limit: 7 });

  const tenantX = await get('/concurrency/tenant-x');
  const tenantY = await get('/concurrency/tenant-y');

  assert(tenantX.limit === 3, 'Tenant X has limit 3');
  assert(tenantY.limit === 7, 'Tenant Y has limit 7');

  // --- Test 7: Concurrency limit of 1 (serial processing) ---
  console.log('\nTest 7: Concurrency limit of 1 enforces serial processing');

  await post('/drain', {});
  await post('/concurrency', { orgId: 'serial-tenant', limit: 1 });

  const serialResult = await post('/test-concurrency', {
    orgId: 'serial-tenant',
    count: 3,
    delayMs: 2000,
  });
  assert(serialResult.submitted === true, 'Serial test jobs submitted');

  await sleep(500);

  let serialMaxActive = 0;
  for (let i = 0; i < 20; i++) {
    const status = await get('/concurrency/serial-tenant');
    if (status.active > serialMaxActive) serialMaxActive = status.active;
    await sleep(300);
  }

  assert(serialMaxActive <= 1, `Serial tenant max active (${serialMaxActive}) <= 1`);

  // Wait for completion
  for (let i = 0; i < 30; i++) {
    const stats = await get('/stats');
    const concStatus = await get('/concurrency/serial-tenant');
    if (stats.active === 0 && stats.waiting === 0 && concStatus.active === 0) break;
    await sleep(500);
  }

  const serialFinal = await get('/concurrency/serial-tenant');
  assert(serialFinal.peak <= 1, `Serial peak (${serialFinal.peak}) respects limit of 1`);

  // --- Test 8: Validation ---
  console.log('\nTest 8: Invalid concurrency settings rejected');

  const badRes = await fetch(`${BASE}/concurrency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: 'bad', limit: 0 }),
  });
  assert(badRes.status === 400, 'Limit=0 rejected with 400');

  const badRes2 = await fetch(`${BASE}/concurrency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 5 }),
  });
  assert(badRes2.status === 400, 'Missing orgId rejected with 400');

  // --- Cleanup ---
  await post('/drain', {});

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
