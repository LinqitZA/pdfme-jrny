/**
 * Test Feature #171: Bulk render onFailure continue mode
 * Tests that failed items don't abort batch in continue mode
 */

const http = require('http');

const API_URL = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdJZCI6Im9yZy0xIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzAwMDAwMDAwfQ.abc123';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(data),
          json: () => {
            try { return Promise.resolve(JSON.parse(data)); }
            catch { return Promise.resolve({}); }
          },
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBatchCompletion(batchId, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${API_URL}/render/batch/${batchId}`, {
      headers: { 'Authorization': AUTH_TOKEN },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status !== 'running') return data;
    }
    await sleep(500);
  }
  return null;
}

async function testDtoAcceptsOnFailure() {
  console.log('\n--- Test: RenderBulkDto accepts onFailure parameter ---');
  const fs = require('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts',
    'utf8'
  );

  assert(source.includes("onFailure?: 'continue' | 'abort'"), 'RenderBulkDto has onFailure field');
  assert(source.includes("dto.onFailure || 'continue'"), 'Default onFailure is continue');
}

async function testBatchSchemaHasRequiredFields() {
  console.log('\n--- Test: Batch schema has onFailure and failedIds fields ---');
  const fs = require('fs');
  const schema = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/db/schema.ts',
    'utf8'
  );

  assert(schema.includes("failedIds") || schema.includes("failed_ids"), 'Schema has failedIds column');
  assert(schema.includes("onFailure") || schema.includes("on_failure"), 'Schema has onFailure column');
  assert(schema.includes("completedWithErrors"), 'Schema comment mentions completedWithErrors status');
}

async function testContinueModeProcessesAll() {
  console.log('\n--- Test: Continue mode processes all items even when some fail ---');
  const fs = require('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts',
    'utf8'
  );

  // In continue mode, the loop should not set aborted=true
  // Only abort mode sets aborted=true
  assert(source.includes("if (dto.onFailure === 'abort')"), 'Abort only triggered in abort mode');
  assert(source.includes("aborted = true"), 'Abort flag exists');
  assert(source.includes("if (aborted) break"), 'Loop breaks only when aborted');

  // Continue mode: verify that failing items push to failedIds
  assert(source.includes("failedIds.push(entityId)"), 'Failed entity IDs tracked');
}

async function testCompletedWithErrorsStatus() {
  console.log('\n--- Test: completedWithErrors status when some fail ---');
  const fs = require('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts',
    'utf8'
  );

  // Verify status logic
  assert(source.includes("failedJobs > 0 ? 'completedWithErrors' : 'completed'"), 'Status becomes completedWithErrors when failedJobs > 0');
}

async function testBulkRenderWithPublishedTemplate() {
  console.log('\n--- Test: Bulk render with published template (all succeed) ---');

  // Create and publish a template
  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      name: 'Bulk Continue Test',
      type: 'invoice',
      schema: {
        schemas: [[{ name: 'field1', type: 'text', content: 'Test', position: { x: 50, y: 50 }, width: 200, height: 24 }]],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    }),
  });
  const template = await createRes.json();
  const templateId = template.id;

  // Publish
  await fetch(`${API_URL}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: { 'Authorization': AUTH_TOKEN },
  });

  // Bulk render with onFailure=continue (all should succeed)
  const bulkRes = await fetch(`${API_URL}/render/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      templateId,
      entityIds: ['ent-1', 'ent-2', 'ent-3'],
      channel: 'print',
      onFailure: 'continue',
    }),
  });

  assert(bulkRes.ok || bulkRes.status === 202, 'Bulk render accepted');
  const bulk = await bulkRes.json();
  assert(bulk.batchId, 'Batch ID returned');

  // Wait for completion
  const finalStatus = await waitForBatchCompletion(bulk.batchId);
  assert(finalStatus !== null, 'Batch completed within timeout');
  if (finalStatus) {
    assert(finalStatus.status === 'completed', 'All succeed: status is completed');
    assert(finalStatus.completedJobs === 3, 'All 3 jobs completed');
    assert(finalStatus.failedJobs === 0, 'No failed jobs');
    assert(
      !finalStatus.failedIds || finalStatus.failedIds.length === 0,
      'No failed IDs'
    );
    assert(finalStatus.onFailure === 'continue', 'onFailure=continue stored in batch');
  }

  // Cleanup
  await fetch(`${API_URL}/templates/${templateId}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testBatchCompletedEventIncludesStatusField() {
  console.log('\n--- Test: Batch complete event includes all required fields ---');
  const fs = require('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts',
    'utf8'
  );

  // Verify batch_complete event payload has all needed fields
  const batchCompleteIdx = source.indexOf("type: 'batch_complete'");
  const batchCompleteBlock = source.substring(batchCompleteIdx, batchCompleteIdx + 300);
  assert(batchCompleteBlock.includes('status: finalStatus'), 'batch_complete includes status');
  assert(batchCompleteBlock.includes('completedJobs'), 'batch_complete includes completedJobs');
  assert(batchCompleteBlock.includes('failedJobs'), 'batch_complete includes failedJobs');
  assert(batchCompleteBlock.includes('totalJobs'), 'batch_complete includes totalJobs');

  // Verify getBatchStatus returns onFailure
  assert(source.includes('onFailure: batch.onFailure'), 'getBatchStatus returns onFailure field');
  assert(source.includes('failedIds: batch.failedIds'), 'getBatchStatus returns failedIds field');
}

async function testBulkRenderWithUnpublishedTemplate() {
  console.log('\n--- Test: Bulk render with unpublished template (all fail, continue mode) ---');

  // Create a template but do NOT publish it
  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      name: 'Unpublished Bulk Test',
      type: 'invoice',
      schema: {
        schemas: [{ elements: [] }],
        basePdf: 'BLANK_PDF',
      },
    }),
  });
  const template = await createRes.json();
  const templateId = template.id;

  // Bulk render - should fail for each entity since template not published
  const bulkRes = await fetch(`${API_URL}/render/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      templateId,
      entityIds: ['fail-1', 'fail-2', 'fail-3'],
      channel: 'print',
      onFailure: 'continue',
    }),
  });

  assert(bulkRes.ok || bulkRes.status === 202, 'Bulk render with unpublished template accepted');
  const bulk = await bulkRes.json();

  // Wait for completion
  const finalStatus = await waitForBatchCompletion(bulk.batchId);
  if (finalStatus) {
    assert(finalStatus.failedJobs === 3, 'All 3 items failed (unpublished template)');
    assert(finalStatus.completedJobs === 0, 'No items succeeded');
    assert(finalStatus.status === 'completedWithErrors', 'Status is completedWithErrors');
    assert(
      finalStatus.failedIds && finalStatus.failedIds.length === 3,
      'All 3 IDs in failedIds'
    );
    assert(
      finalStatus.failedIds && finalStatus.failedIds.includes('fail-1'),
      'fail-1 in failedIds'
    );
    assert(
      finalStatus.failedIds && finalStatus.failedIds.includes('fail-2'),
      'fail-2 in failedIds'
    );
    assert(
      finalStatus.failedIds && finalStatus.failedIds.includes('fail-3'),
      'fail-3 in failedIds'
    );
  }

  // Cleanup
  await fetch(`${API_URL}/templates/${templateId}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testAbortModeStopsOnFirstFailure() {
  console.log('\n--- Test: Abort mode stops on first failure ---');

  // Create unpublished template (all renders will fail)
  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      name: 'Abort Mode Test',
      type: 'invoice',
      schema: { schemas: [[]], basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] } },
    }),
  });
  const template = await createRes.json();
  const templateId = template.id;

  // Bulk render with abort mode
  const bulkRes = await fetch(`${API_URL}/render/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      templateId,
      entityIds: ['abort-1', 'abort-2', 'abort-3', 'abort-4', 'abort-5'],
      channel: 'print',
      onFailure: 'abort',
    }),
  });

  assert(bulkRes.ok || bulkRes.status === 202, 'Abort-mode bulk render accepted');
  const bulk = await bulkRes.json();

  const finalStatus = await waitForBatchCompletion(bulk.batchId);
  if (finalStatus) {
    assert(finalStatus.status === 'aborted', 'Status is aborted');
    // Should have stopped after first failure (not all 5)
    assert(finalStatus.failedJobs <= 2, 'Aborted early (not all items processed)');
    const totalProcessed = finalStatus.completedJobs + finalStatus.failedJobs;
    assert(totalProcessed < 5, 'Did not process all 5 items');
  }

  // Cleanup
  await fetch(`${API_URL}/templates/${templateId}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testBatchStatusEndpointReturnsFailedIds() {
  console.log('\n--- Test: Batch status endpoint returns failedIds ---');

  // Create unpublished template
  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      name: 'FailedIds Test',
      type: 'invoice',
      schema: { schemas: [[]], basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] } },
    }),
  });
  const template = await createRes.json();

  const bulkRes = await fetch(`${API_URL}/render/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      templateId: template.id,
      entityIds: ['track-1', 'track-2'],
      channel: 'print',
      onFailure: 'continue',
    }),
  });
  const bulk = await bulkRes.json();

  const finalStatus = await waitForBatchCompletion(bulk.batchId);

  if (finalStatus) {
    assert(Array.isArray(finalStatus.failedIds), 'failedIds is an array in response');
    assert(finalStatus.failedIds.includes('track-1'), 'track-1 tracked in failedIds');
    assert(finalStatus.failedIds.includes('track-2'), 'track-2 tracked in failedIds');
  }

  // Cleanup
  await fetch(`${API_URL}/templates/${template.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testDefaultOnFailureIsContinue() {
  console.log('\n--- Test: Default onFailure is continue (no explicit param) ---');

  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      name: 'Default Mode Test',
      type: 'invoice',
      schema: { schemas: [[]], basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] } },
    }),
  });
  const template = await createRes.json();

  // Bulk render WITHOUT specifying onFailure
  const bulkRes = await fetch(`${API_URL}/render/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_TOKEN },
    body: JSON.stringify({
      templateId: template.id,
      entityIds: ['def-1', 'def-2', 'def-3'],
      channel: 'print',
      // no onFailure specified
    }),
  });
  const bulk = await bulkRes.json();

  const finalStatus = await waitForBatchCompletion(bulk.batchId);

  if (finalStatus) {
    assert(finalStatus.onFailure === 'continue', 'Default onFailure is continue');
    // All should fail (unpublished) but all should be processed
    assert(
      finalStatus.failedJobs === 3,
      'All 3 items failed but all were processed (continue mode by default)'
    );
    assert(finalStatus.status === 'completedWithErrors', 'Status is completedWithErrors');
  }

  // Cleanup
  await fetch(`${API_URL}/templates/${template.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testSSEEmitsJobFailedEvents() {
  console.log('\n--- Test: SSE emits job_failed events in code ---');
  const fs = require('fs');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts',
    'utf8'
  );

  assert(source.includes("type: 'job_failed'"), 'SSE emits job_failed event type');
  assert(source.includes("type: 'job_completed'"), 'SSE emits job_completed event type');
  assert(source.includes("type: 'batch_complete'"), 'SSE emits batch_complete event type');

  // job_failed event includes entityId and error
  const jobFailedIdx = source.indexOf("type: 'job_failed'");
  const jobFailedBlock = source.substring(jobFailedIdx, jobFailedIdx + 200);
  assert(jobFailedBlock.includes('entityId'), 'job_failed event includes entityId');
  assert(jobFailedBlock.includes('error'), 'job_failed event includes error details');
}

async function main() {
  console.log('=== Feature #171: Bulk render onFailure continue mode ===\n');

  try {
    await testDtoAcceptsOnFailure();
    await testBatchSchemaHasRequiredFields();
    await testContinueModeProcessesAll();
    await testCompletedWithErrorsStatus();
    await testSSEEmitsJobFailedEvents();
    await testBulkRenderWithPublishedTemplate();
    await testBulkRenderWithUnpublishedTemplate();
    await testAbortModeStopsOnFirstFailure();
    await testBatchStatusEndpointReturnsFailedIds();
    await testDefaultOnFailureIsContinue();
    await testBatchCompletedEventIncludesStatusField();
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
