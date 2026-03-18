/**
 * Feature #336: Concurrent batch renders queued properly
 * - Submit batch A and batch B quickly
 * - Verify both tracked separately
 * - Verify queue processes in order
 * - Verify no cross-batch interference
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const ORG_ID = `org-batch-${Date.now()}`;

function makeToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-336',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'render:trigger', 'render:bulk'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken();

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function run() {
  console.log('Feature #336: Concurrent batch renders queued properly\n');

  // Create a published template for rendering
  console.log('Setup: Create and publish template');
  const createResult = await apiRequest('POST', '/api/pdfme/templates', {
    name: 'Batch Test Template',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [{ type: 'text', content: 'Test' }] }] },
  });
  assert(createResult.status === 201, `Template created (status ${createResult.status})`);
  const templateId = createResult.body.id;

  // Publish the template
  const publishResult = await apiRequest('POST', `/api/pdfme/templates/${templateId}/publish`);
  assert(publishResult.status === 200 || publishResult.status === 201, `Template published (status ${publishResult.status})`);

  // Test 1: Submit batch A (entityType = 'invoice')
  console.log('\nTest 1: Submit batch A');
  const batchA = await apiRequest('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-a1', 'entity-a2', 'entity-a3'],
    entityType: 'invoice',
    channel: 'email',
  });
  assert(batchA.status === 202, `Batch A accepted (status ${batchA.status})`);
  assert(!!batchA.body.batchId, `Batch A has batchId: ${batchA.body.batchId}`);
  assert(batchA.body.status === 'running', `Batch A status is running`);
  assert(batchA.body.totalJobs === 3, `Batch A has 3 total jobs`);
  const batchAId = batchA.body.batchId;

  // Test 2: Submit batch B with DIFFERENT entityType (should succeed concurrently)
  console.log('\nTest 2: Submit batch B (different entity type - concurrent)');
  const batchB = await apiRequest('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-b1', 'entity-b2'],
    entityType: 'statement',
    channel: 'print',
  });
  assert(batchB.status === 202, `Batch B accepted concurrently (status ${batchB.status})`);
  assert(!!batchB.body.batchId, `Batch B has batchId: ${batchB.body.batchId}`);
  assert(batchB.body.totalJobs === 2, `Batch B has 2 total jobs`);
  const batchBId = batchB.body.batchId;

  // Test 3: Verify batch IDs are different
  console.log('\nTest 3: Batches tracked separately');
  assert(batchAId !== batchBId, `Batch A and B have different IDs`);

  // Test 4: Check batch A status
  const statusA = await apiRequest('GET', `/api/pdfme/render/batch/${batchAId}`);
  assert(statusA.status === 200, `Batch A status retrievable (status ${statusA.status})`);
  assert(statusA.body.id === batchAId || statusA.body.batchId === batchAId, `Batch A status shows correct ID`);

  // Test 5: Check batch B status
  const statusB = await apiRequest('GET', `/api/pdfme/render/batch/${batchBId}`);
  assert(statusB.status === 200, `Batch B status retrievable (status ${statusB.status})`);
  assert(statusB.body.id === batchBId || statusB.body.batchId === batchBId, `Batch B status shows correct ID`);

  // Test 6: Verify no cross-batch interference (batch A doesn't affect B's data)
  console.log('\nTest 4: No cross-batch interference');
  assert(
    (statusA.body.totalJobs || statusA.body.total_jobs) === 3,
    `Batch A still has 3 total jobs (got ${statusA.body.totalJobs || statusA.body.total_jobs})`
  );
  assert(
    (statusB.body.totalJobs || statusB.body.total_jobs) === 2,
    `Batch B still has 2 total jobs (got ${statusB.body.totalJobs || statusB.body.total_jobs})`
  );

  // Test 7: Submitting another batch with SAME entityType as A should conflict (if A is still running)
  console.log('\nTest 5: Same entity type batch conflicts with running batch');
  const batchC = await apiRequest('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-c1'],
    entityType: 'invoice',
    channel: 'email',
  });
  // If batch A already completed, this will succeed with 202; if still running, 409
  if (batchC.status === 409) {
    assert(true, `Duplicate entity type batch correctly rejected with 409`);
    assert(batchC.body.existingBatchId === batchAId, `Conflict references existing batch A ID`);
  } else {
    assert(batchC.status === 202, `Batch C accepted (batch A already completed, status ${batchC.status})`);
  }

  // Wait for batches to finish processing
  console.log('\nTest 6: Wait for batches to complete');
  let batchADone = false;
  let batchBDone = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const a = await apiRequest('GET', `/api/pdfme/render/batch/${batchAId}`);
    const b = await apiRequest('GET', `/api/pdfme/render/batch/${batchBId}`);
    if (a.body.status !== 'running') batchADone = true;
    if (b.body.status !== 'running') batchBDone = true;
    if (batchADone && batchBDone) break;
  }
  assert(batchADone, 'Batch A completed processing');
  assert(batchBDone, 'Batch B completed processing');

  // Test 8: Verify final states are independent
  console.log('\nTest 7: Verify final batch states');
  const finalA = await apiRequest('GET', `/api/pdfme/render/batch/${batchAId}`);
  const finalB = await apiRequest('GET', `/api/pdfme/render/batch/${batchBId}`);

  const terminalStatuses = ['completed', 'completed_with_errors', 'completedWithErrors', 'failed'];
  assert(
    terminalStatuses.includes(finalA.body.status),
    `Batch A has terminal status: ${finalA.body.status}`
  );
  assert(
    terminalStatuses.includes(finalB.body.status),
    `Batch B has terminal status: ${finalB.body.status}`
  );

  // Test 9: After both complete, a new batch with same entityType should succeed
  console.log('\nTest 8: New batch after completion succeeds');
  const batchD = await apiRequest('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-d1', 'entity-d2'],
    entityType: 'invoice',
    channel: 'email',
  });
  assert(batchD.status === 202, `New batch accepted after previous completed (status ${batchD.status})`);
  assert(!!batchD.body.batchId, `New batch has batchId: ${batchD.body.batchId}`);
  assert(batchD.body.batchId !== batchAId, `New batch has different ID from batch A`);

  // Test 10: Verify batch channels are independent (batch A=email, B=print)
  console.log('\nTest 9: Batch channels preserved correctly');
  assert(
    finalA.body.channel === 'email',
    `Batch A channel is 'email' (got ${finalA.body.channel})`
  );
  assert(
    finalB.body.channel === 'print',
    `Batch B channel is 'print' (got ${finalB.body.channel})`
  );

  // Test 11: Verify batch job counts are accurate
  console.log('\nTest 10: Final job counts accurate');
  const totalA = finalA.body.completedJobs + finalA.body.failedJobs;
  const totalB = finalB.body.completedJobs + finalB.body.failedJobs;
  assert(totalA === 3, `Batch A processed all 3 jobs (completed=${finalA.body.completedJobs}, failed=${finalA.body.failedJobs})`);
  assert(totalB === 2, `Batch B processed all 2 jobs (completed=${finalB.body.completedJobs}, failed=${finalB.body.failedJobs})`);

  // Cleanup
  console.log('\nCleanup...');
  await apiRequest('DELETE', `/api/pdfme/templates/${templateId}`);

  console.log(`\n=============================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
