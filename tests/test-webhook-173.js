/**
 * Test script for Feature #173: Webhook callback on batch completion
 *
 * Tests:
 * 1. Start a local HTTP server to receive webhook
 * 2. Start batch with notifyUrl pointing to local server
 * 3. Wait for completion
 * 4. Verify webhook POST was sent to notifyUrl
 * 5. Verify payload includes batch status and results
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_PORT = 19876;
let PASS = 0;
let FAIL = 0;

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payloadData = Buffer.from(JSON.stringify({ sub: 'user-webhook', orgId: 'org-webhook', roles: ['template:edit', 'template:publish', 'render:trigger'] })).toString('base64url');
const TOKEN = header + '.' + payloadData + '.devsig';

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

// Start a local webhook receiver server
const startWebhookServer = () => {
  const receivedCallbacks = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          receivedCallbacks.push({
            method: req.method,
            url: req.url,
            contentType: req.headers['content-type'],
            body: parsed,
            receivedAt: new Date().toISOString(),
          });
        } catch (e) {
          receivedCallbacks.push({
            method: req.method,
            url: req.url,
            body: body,
            parseError: true,
            receivedAt: new Date().toISOString(),
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    server.listen(WEBHOOK_PORT, () => {
      console.log('  Webhook server listening on port ' + WEBHOOK_PORT);
      resolve({ server, receivedCallbacks });
    });
  });
};

const main = async () => {
  console.log('=== Feature #173: Webhook callback on batch completion ===\n');

  // Clear any existing force failures
  await request('POST', '/api/pdfme/render/force-pdfa-failure', { errorMessage: null });

  // Step 1: Create and publish template
  console.log('Step 1: Create and publish template...');
  const createResp = await request('POST', '/api/pdfme/templates', {
    type: 'invoice',
    name: 'Webhook Test Template',
    schema: {
      schemas: [
        [{ name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Webhook Test' }]
      ],
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    },
  });
  assert('Template created', createResp.status === 201);
  const templateId = createResp.body.id;

  const pubResp = await request('POST', '/api/pdfme/templates/' + templateId + '/publish');
  assert('Template published', pubResp.status === 200 || pubResp.status === 201);

  // Step 2: Start webhook server
  console.log('\nStep 2: Start webhook server...');
  const { server, receivedCallbacks } = await startWebhookServer();

  // Step 3: Start batch with notifyUrl
  console.log('\nStep 3: Start batch with notifyUrl...');
  const notifyUrl = 'http://localhost:' + WEBHOOK_PORT + '/webhook/batch-done';

  const bulkResp = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-wh-1', 'entity-wh-2'],
    channel: 'print',
    notifyUrl: notifyUrl,
  });
  assert('Bulk render accepted (202)', bulkResp.status === 202);
  assert('Batch ID returned', !!bulkResp.body.batchId);
  const batchId = bulkResp.body.batchId;

  // Step 4: Wait for batch completion and webhook
  console.log('\nStep 4: Wait for batch completion...');
  await sleep(8000);

  // Check batch status
  const batchStatus = await request('GET', '/api/pdfme/render/batch/' + batchId);
  console.log('  Batch status:', JSON.stringify(batchStatus.body));
  assert('Batch completed', batchStatus.body.status === 'completed');

  // Step 5: Verify webhook was called
  console.log('\nStep 5: Verify webhook callback...');
  console.log('  Received callbacks:', receivedCallbacks.length);

  assert('Webhook callback received', receivedCallbacks.length >= 1);

  if (receivedCallbacks.length > 0) {
    const callback = receivedCallbacks[receivedCallbacks.length - 1]; // Last callback
    console.log('  Callback method:', callback.method);
    console.log('  Callback URL:', callback.url);
    console.log('  Callback body:', JSON.stringify(callback.body));

    assert('Webhook method is POST', callback.method === 'POST');
    assert('Webhook URL matches', callback.url === '/webhook/batch-done');
    assert('Webhook content-type is JSON', callback.contentType && callback.contentType.includes('application/json'));
    assert('Webhook body has batchId', callback.body.batchId === batchId);
    assert('Webhook body has status', callback.body.status === 'completed');
    assert('Webhook body has completedJobs', callback.body.completedJobs === 2);
    assert('Webhook body has failedJobs', callback.body.failedJobs === 0);
    assert('Webhook body has totalJobs', callback.body.totalJobs === 2);
  }

  // Step 6: Test webhook with failures (completedWithErrors)
  console.log('\nStep 6: Test webhook with partial failures...');

  // Force one failure
  await request('POST', '/api/pdfme/render/force-pdfa-failure', {
    errorMessage: 'Forced failure for webhook test'
  });

  const bulkFailResp = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-wh-fail-1', 'entity-wh-fail-2', 'entity-wh-fail-3'],
    channel: 'print',
    onFailure: 'continue',
    notifyUrl: notifyUrl,
  });
  assert('Failure bulk render accepted', bulkFailResp.status === 202);
  const failBatchId = bulkFailResp.body.batchId;

  await sleep(8000);

  // Find the callback for this batch
  const failCallback = receivedCallbacks.find(cb => cb.body && cb.body.batchId === failBatchId);

  assert('Webhook received for failure batch', !!failCallback);
  if (failCallback) {
    console.log('  Failure callback body:', JSON.stringify(failCallback.body));
    assert('Failure webhook has completedWithErrors status', failCallback.body.status === 'completedWithErrors');
    assert('Failure webhook has failedJobs', failCallback.body.failedJobs >= 1);
    assert('Failure webhook has completedJobs', failCallback.body.completedJobs >= 1);
    assert('Failure webhook has totalJobs', failCallback.body.totalJobs === 3);
  }

  // Step 7: Test batch WITHOUT notifyUrl (no webhook should be sent)
  console.log('\nStep 7: Test batch without notifyUrl...');
  const callbackCountBefore = receivedCallbacks.length;

  await request('POST', '/api/pdfme/render/force-pdfa-failure', { errorMessage: null });
  const bulkNoNotify = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-wh-none-1'],
    channel: 'print',
    // No notifyUrl
  });
  assert('No-notify bulk render accepted', bulkNoNotify.status === 202);

  await sleep(5000);

  assert('No extra webhook received', receivedCallbacks.length === callbackCountBefore);

  // Cleanup
  server.close();

  console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===');
  process.exit(FAIL > 0 ? 1 : 0);
};

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
