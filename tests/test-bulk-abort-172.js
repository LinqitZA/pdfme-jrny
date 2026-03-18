/**
 * Test script for Feature #172: Bulk render onFailure abort mode
 *
 * Tests:
 * 1. Start bulk render with onFailure=abort, where one item fails
 * 2. Verify batch stops processing after failure
 * 3. Verify status=aborted
 * 4. Verify processed items still available
 * 5. Compare with onFailure=continue (all items processed)
 */

const http = require('http');

const BASE_URL = process.env.API_BASE || 'http://localhost:3001';
let PASS = 0;
let FAIL = 0;

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'user-bulk-abort', orgId: 'org-bulk-abort', roles: ['template:edit', 'template:publish', 'render:trigger'] })).toString('base64url');
const TOKEN = header + '.' + payload + '.devsig';

const assert = (desc, condition) => {
  if (condition) { PASS++; console.log('  PASS:', desc); }
  else { FAIL++; console.log('  FAIL:', desc); }
};

const request = (method, urlPath, body) => {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  console.log('=== Feature #172: Bulk render onFailure abort mode ===\n');

  // Clear any existing force failures
  await request('POST', '/api/pdfme/render/force-pdfa-failure', { errorMessage: null });

  // Step 1: Create and publish a template with valid pdfme format
  console.log('Step 1: Create and publish template...');
  const createResp = await request('POST', '/api/pdfme/templates', {
    type: 'invoice',
    name: 'Bulk Abort Test Template',
    schema: {
      schemas: [
        [{ name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }]
      ],
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    },
  });
  assert('Template created', createResp.status === 201);
  const templateId = createResp.body.id;

  const pubResp = await request('POST', '/api/pdfme/templates/' + templateId + '/publish');
  assert('Template published', pubResp.status === 200 || pubResp.status === 201);

  // Verify render works with this template
  const testRender = await request('POST', '/api/pdfme/render/now', {
    templateId, entityId: 'test-render', channel: 'print',
  });
  assert('Test render succeeds', testRender.status === 200 || testRender.status === 201);

  // Step 2: Test onFailure=abort
  console.log('\nStep 2: Test onFailure=abort...');

  // Force PDF/A failure for the first render in the batch
  await request('POST', '/api/pdfme/render/force-pdfa-failure', {
    errorMessage: 'Forced test failure for abort mode'
  });

  // Start bulk render with onFailure=abort (3 entities, first should fail due to force-pdfa-failure)
  const bulkAbortResp = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-abort-1', 'entity-abort-2', 'entity-abort-3'],
    channel: 'print',
    onFailure: 'abort',
  });
  assert('Bulk render accepted (202)', bulkAbortResp.status === 202);
  assert('Batch ID returned', !!bulkAbortResp.body.batchId);
  const abortBatchId = bulkAbortResp.body.batchId;

  // Wait for batch to process
  await sleep(6000);

  // Check batch status
  const abortStatus = await request('GET', '/api/pdfme/render/batch/' + abortBatchId);
  console.log('  Abort batch status:', JSON.stringify(abortStatus.body));

  assert('Batch status is aborted', abortStatus.body.status === 'aborted');
  assert('Has failed jobs', abortStatus.body.failedJobs >= 1);
  assert('Not all items completed (abort stopped early)',
    abortStatus.body.completedJobs + abortStatus.body.failedJobs < abortStatus.body.totalJobs);
  assert('Failed IDs recorded', Array.isArray(abortStatus.body.failedIds) && abortStatus.body.failedIds.length > 0);
  assert('First entity failed', abortStatus.body.failedIds && abortStatus.body.failedIds[0] === 'entity-abort-1');
  assert('onFailure field is abort', abortStatus.body.onFailure === 'abort');

  // Step 3: Verify batch details
  console.log('\nStep 3: Verify batch details...');
  assert('Total jobs is 3', abortStatus.body.totalJobs === 3);
  assert('Failed jobs count is 1', abortStatus.body.failedJobs === 1);
  // In abort mode, processing stops after failure, so completed + failed < total
  const processedCount = abortStatus.body.completedJobs + abortStatus.body.failedJobs;
  assert('Processing stopped early (processed < total)', processedCount < abortStatus.body.totalJobs);

  // Step 4: Test onFailure=continue for comparison
  console.log('\nStep 4: Test onFailure=continue for comparison...');

  // Force another PDF/A failure (auto-clears after one use)
  await request('POST', '/api/pdfme/render/force-pdfa-failure', {
    errorMessage: 'Forced test failure for continue mode'
  });

  const bulkContinueResp = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-cont-1', 'entity-cont-2', 'entity-cont-3'],
    channel: 'print',
    onFailure: 'continue',
  });
  assert('Continue bulk render accepted (202)', bulkContinueResp.status === 202);
  const continueBatchId = bulkContinueResp.body.batchId;

  // Wait for batch to complete
  await sleep(6000);

  const continueStatus = await request('GET', '/api/pdfme/render/batch/' + continueBatchId);
  console.log('  Continue batch status:', JSON.stringify(continueStatus.body));

  assert('Continue batch NOT aborted', continueStatus.body.status !== 'aborted');
  assert('All items processed in continue mode',
    continueStatus.body.completedJobs + continueStatus.body.failedJobs === continueStatus.body.totalJobs);
  assert('Continue batch has completed/completedWithErrors status',
    continueStatus.body.status === 'completed' || continueStatus.body.status === 'completedWithErrors');
  assert('Continue batch has 1 failure (force-pdfa auto-cleared after 1)', continueStatus.body.failedJobs === 1);
  assert('Continue batch has 2 successes', continueStatus.body.completedJobs === 2);

  // Step 5: Test abort with all successful renders (no abort triggered)
  console.log('\nStep 5: Test abort mode with no failures (should complete normally)...');

  // Make sure no force failure is active
  await request('POST', '/api/pdfme/render/force-pdfa-failure', { errorMessage: null });

  const bulkNoFailResp = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-ok-1', 'entity-ok-2'],
    channel: 'print',
    onFailure: 'abort',
  });
  assert('No-fail bulk render accepted', bulkNoFailResp.status === 202);
  const noFailBatchId = bulkNoFailResp.body.batchId;

  await sleep(5000);

  const noFailStatus = await request('GET', '/api/pdfme/render/batch/' + noFailBatchId);
  console.log('  No-fail batch status:', JSON.stringify(noFailStatus.body));

  assert('No-fail batch completed normally', noFailStatus.body.status === 'completed');
  assert('All jobs completed', noFailStatus.body.completedJobs === 2);
  assert('No failed jobs', noFailStatus.body.failedJobs === 0);

  console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===');
  process.exit(FAIL > 0 ? 1 : 0);
};

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
