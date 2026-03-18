/**
 * Test: Feature #188 - SSE batch progress updates UI
 *
 * Verifies:
 * 1. Start bulk render returns batchId
 * 2. SSE stream delivers progress events (job_completed, job_failed, batch_complete)
 * 3. Progress bar updates with each event
 * 4. Individual job status shown
 * 5. Completion state works
 */

const http = require('http');
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
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

/**
 * Connect to SSE endpoint and collect events
 */
function connectSSE(url, authToken, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const events = [];
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${authToken}`,
      },
    };

    const req = http.request(options, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push(data);

              if (data.type === 'batch_complete') {
                req.destroy();
                resolve(events);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      });

      res.on('end', () => {
        resolve(events);
      });
    });

    req.on('error', () => {
      resolve(events);
    });

    // Timeout
    setTimeout(() => {
      req.destroy();
      resolve(events);
    }, timeoutMs);

    req.end();
  });
}

async function test1_bulkRenderReturns() {
  console.log('\n--- Test 1: Bulk render returns batchId ---');

  // Create and publish a template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'SSE Batch Test Template',
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    }),
  });
  const tpl = await createRes.json();
  const templateId = tpl.id;
  assert(!!templateId, 'Template created');

  await fetch(`${BASE}/templates/${templateId}/publish`, { method: 'POST', headers });

  // Submit bulk render
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['entity-1', 'entity-2', 'entity-3'],
      channel: 'print',
    }),
  });

  assert(bulkRes.status === 202, `Bulk render returns 202 (got ${bulkRes.status})`);
  const bulkBody = await bulkRes.json();
  assert(!!bulkBody.batchId, `Returns batchId: ${bulkBody.batchId}`);
  assert(bulkBody.status === 'running' || bulkBody.status === 'accepted', `Status is running/accepted: ${bulkBody.status}`);
  assert(bulkBody.totalJobs === 3, `TotalJobs is 3 (got ${bulkBody.totalJobs})`);

  return { templateId, batchId: bulkBody.batchId };
}

async function test2_sseStreamEvents(templateId) {
  console.log('\n--- Test 2: SSE stream delivers progress events ---');

  // Submit another bulk render
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['sse-1', 'sse-2', 'sse-3'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;
  assert(!!batchId, `Batch submitted for SSE test: ${batchId}`);

  // Connect to SSE and collect events
  const events = await connectSSE(
    `${BASE}/render/batch/${batchId}/progress`,
    TOKEN,
    20000,
  );

  assert(events.length > 0, `Received ${events.length} SSE events`);

  // Check for job events
  const jobEvents = events.filter(
    (e) => e.type === 'job_completed' || e.type === 'job_complete' || e.type === 'job_failed',
  );
  assert(jobEvents.length >= 1, `Received ${jobEvents.length} job progress events`);

  // Check for batch_complete
  const completeEvents = events.filter((e) => e.type === 'batch_complete');
  assert(completeEvents.length === 1, `Received exactly 1 batch_complete event`);

  return events;
}

async function test3_progressBarUpdates(templateId) {
  console.log('\n--- Test 3: Progress updates with each event ---');

  // Submit bulk render with 5 entities
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['prog-1', 'prog-2', 'prog-3', 'prog-4', 'prog-5'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;

  // Collect SSE events
  const events = await connectSSE(
    `${BASE}/render/batch/${batchId}/progress`,
    TOKEN,
    20000,
  );

  // Verify job events have progress counts
  const jobEvents = events.filter(
    (e) => e.type === 'job_completed' || e.type === 'job_complete' || e.type === 'job_failed',
  );

  // Each job event should have completedJobs and totalJobs
  for (const event of jobEvents) {
    assert(typeof event.completedJobs === 'number', `Job event has completedJobs: ${event.completedJobs}`);
    assert(typeof event.totalJobs === 'number', `Job event has totalJobs: ${event.totalJobs}`);
  }

  // completedJobs should increase monotonically
  if (jobEvents.length >= 2) {
    const completed = jobEvents.map((e) => (e.completedJobs || 0) + (e.failedJobs || 0));
    let increasing = true;
    for (let i = 1; i < completed.length; i++) {
      if (completed[i] < completed[i - 1]) {
        increasing = false;
        break;
      }
    }
    assert(increasing, 'Progress counts increase monotonically');
  }

  // Final batch_complete event should have total counts
  const batchComplete = events.find((e) => e.type === 'batch_complete');
  if (batchComplete) {
    assert(
      (batchComplete.completedJobs || 0) + (batchComplete.failedJobs || 0) === 5,
      `Batch complete shows all 5 jobs processed (completed: ${batchComplete.completedJobs}, failed: ${batchComplete.failedJobs})`,
    );
  }
}

async function test4_individualJobStatus(templateId) {
  console.log('\n--- Test 4: Individual job status shown ---');

  // Submit bulk render
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['ind-1', 'ind-2'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;

  // Collect events
  const events = await connectSSE(
    `${BASE}/render/batch/${batchId}/progress`,
    TOKEN,
    15000,
  );

  // Check individual job events have entityId
  const jobEvents = events.filter(
    (e) => e.type === 'job_completed' || e.type === 'job_complete' || e.type === 'job_failed',
  );

  for (const event of jobEvents) {
    assert(!!event.entityId, `Job event has entityId: ${event.entityId}`);
  }

  // Verify entity IDs match what we submitted
  const entityIds = jobEvents.map((e) => e.entityId);
  assert(entityIds.includes('ind-1') || entityIds.includes('ind-2'), 'Events include expected entity IDs');
}

async function test5_completionState(templateId) {
  console.log('\n--- Test 5: Completion state works ---');

  // Submit and wait for completion
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['comp-1', 'comp-2'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;

  // Wait for completion
  await sleep(5000);

  // Check batch status via REST
  const statusRes = await fetch(`${BASE}/render/batch/${batchId}`, { headers });
  assert(statusRes.ok, `Batch status endpoint returns 200`);

  const statusBody = await statusRes.json();
  assert(
    statusBody.status === 'completed' || statusBody.status === 'completedWithErrors',
    `Batch status is completed: ${statusBody.status}`,
  );
  assert(typeof statusBody.completedJobs === 'number', `Has completedJobs count: ${statusBody.completedJobs}`);
  assert(typeof statusBody.totalJobs === 'number', `Has totalJobs count: ${statusBody.totalJobs}`);
  assert(
    statusBody.completedJobs + (statusBody.failedJobs || 0) === statusBody.totalJobs,
    'All jobs accounted for',
  );
}

async function test6_sseClosesOnComplete(templateId) {
  console.log('\n--- Test 6: SSE stream closes on batch completion ---');

  // Submit a small batch
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['close-1'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;

  // Connect SSE and verify it receives batch_complete then closes
  const events = await connectSSE(
    `${BASE}/render/batch/${batchId}/progress`,
    TOKEN,
    10000,
  );

  const lastEvent = events[events.length - 1];
  assert(
    lastEvent && lastEvent.type === 'batch_complete',
    `Last event is batch_complete (got ${lastEvent?.type})`,
  );
}

async function test7_alreadyCompletedBatch(templateId) {
  console.log('\n--- Test 7: SSE for already completed batch ---');

  // Submit and wait for it to complete
  const bulkRes = await fetch(`${BASE}/render/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityIds: ['done-1'],
      channel: 'print',
    }),
  });
  const bulkBody = await bulkRes.json();
  const batchId = bulkBody.batchId;

  // Wait for completion
  await sleep(3000);

  // Now connect SSE to already-completed batch
  const events = await connectSSE(
    `${BASE}/render/batch/${batchId}/progress`,
    TOKEN,
    5000,
  );

  // Should get batch_complete event immediately
  assert(events.length >= 1, `Received events for completed batch: ${events.length}`);
  const hasComplete = events.some((e) => e.type === 'batch_complete');
  assert(hasComplete, 'Already-completed batch sends batch_complete');
}

async function main() {
  console.log('=== Feature #188: SSE batch progress updates UI ===\n');

  try {
    const { templateId } = await test1_bulkRenderReturns();
    await test2_sseStreamEvents(templateId);
    await test3_progressBarUpdates(templateId);
    await test4_individualJobStatus(templateId);
    await test5_completionState(templateId);
    await test6_sseClosesOnComplete(templateId);
    await test7_alreadyCompletedBatch(templateId);
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
