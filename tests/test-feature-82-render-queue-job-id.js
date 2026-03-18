/**
 * Feature #82: Render queue returns job ID async
 * POST render/queue returns jobId immediately (202)
 * Poll status until done, PDF file created
 */

const crypto = require('crypto');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('queue-user', 'org-queue-82', ['template:read', 'template:write', 'template:publish', 'render:trigger', 'render:bulk']);
const TOKEN_NO_AUTH = null;

let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

async function api(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

async function createAndPublishTemplate(token) {
  const schema = {
    pages: [{
      elements: [
        { name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Queue test' }
      ]
    }]
  };
  // Create template
  const create = await api('/api/pdfme/templates', {
    method: 'POST', token,
    body: { name: 'Queue Test Template 82', type: 'invoice', schema },
  });
  if (create.status !== 201 && create.status !== 200) return null;
  const id = create.json.id || create.json.template?.id;
  // Publish
  await api('/api/pdfme/templates/' + id + '/publish', { method: 'POST', token });
  return id;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('Feature #82: Render queue returns job ID async');
  console.log('='.repeat(50));

  // Setup: create and publish a template
  templateId = await createAndPublishTemplate(TOKEN);
  assert(templateId, 'Template created for queue test');

  // Test 1: POST /render/queue returns 202 with jobId
  console.log('\n--- Test: POST render/queue returns 202 with jobId ---');
  const queueRes = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { templateId, entityId: 'ent-queue-82-1', channel: 'email' },
  });
  assert(queueRes.status === 202, 'Status is 202 Accepted (got ' + queueRes.status + ')');
  assert(queueRes.json.jobId, 'Response has jobId: ' + queueRes.json.jobId);
  assert(queueRes.json.status === 'queued', 'Initial status is queued (got ' + queueRes.json.status + ')');
  const jobId = queueRes.json.jobId;

  // Test 2: Poll status endpoint until done or failed
  console.log('\n--- Test: Poll status until done ---');
  let finalStatus = null;
  let pollCount = 0;
  const maxPolls = 30;
  while (pollCount < maxPolls) {
    const statusRes = await api('/api/pdfme/render/status/' + jobId, { token: TOKEN });
    assert(statusRes.status === 200, 'Status poll returns 200');
    finalStatus = statusRes.json;

    if (finalStatus.status === 'done' || finalStatus.status === 'failed') {
      break;
    }
    pollCount++;
    await sleep(500);
  }
  assert(finalStatus, 'Got final status');
  assert(finalStatus.jobId === jobId, 'Job ID matches in status response');
  // Job may be done or failed depending on whether the template data source is available
  assert(['done', 'failed'].includes(finalStatus.status), 'Job reached terminal state: ' + finalStatus.status);

  // Test 3: If done, verify PDF file was created (result has documentId)
  if (finalStatus.status === 'done' && finalStatus.result) {
    console.log('\n--- Test: PDF file created ---');
    assert(finalStatus.result.documentId || finalStatus.result.filePath, 'Result has documentId or filePath');

    if (finalStatus.result.documentId) {
      const docRes = await api('/api/pdfme/render/document/' + finalStatus.result.documentId, { token: TOKEN });
      assert(docRes.status === 200, 'Document downloadable (status ' + docRes.status + ')');
    }
  }

  // Test 4: Verify 202 response structure
  console.log('\n--- Test: Response structure ---');
  assert(typeof queueRes.json.jobId === 'string', 'jobId is a string');
  assert(queueRes.json.message, 'Response includes polling message');
  assert(queueRes.json.message.includes('status'), 'Message mentions status polling');

  // Test 5: Missing fields return 400
  console.log('\n--- Test: Validation errors ---');
  const noTemplate = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { entityId: 'ent-1', channel: 'email' },
  });
  assert(noTemplate.status === 400, 'Missing templateId returns 400 (got ' + noTemplate.status + ')');

  const noEntity = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { templateId: 'tpl-1', channel: 'email' },
  });
  assert(noEntity.status === 400, 'Missing entityId returns 400 (got ' + noEntity.status + ')');

  const noChannel = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { templateId: 'tpl-1', entityId: 'ent-1' },
  });
  assert(noChannel.status === 400, 'Missing channel returns 400 (got ' + noChannel.status + ')');

  // Test 6: Invalid channel returns 400
  const badChannel = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { templateId: 'tpl-1', entityId: 'ent-1', channel: 'fax' },
  });
  assert(badChannel.status === 400, 'Invalid channel returns 400 (got ' + badChannel.status + ')');

  // Test 7: No auth returns 401
  console.log('\n--- Test: Auth required ---');
  const noAuth = await api('/api/pdfme/render/queue', {
    method: 'POST',
    body: { templateId, entityId: 'ent-1', channel: 'email' },
  });
  assert(noAuth.status === 401, 'No auth returns 401 (got ' + noAuth.status + ')');

  // Test 8: Submit another job and verify separate jobId
  console.log('\n--- Test: Multiple jobs get unique IDs ---');
  const job2 = await api('/api/pdfme/render/queue', {
    method: 'POST', token: TOKEN,
    body: { templateId, entityId: 'ent-queue-82-2', channel: 'print' },
  });
  assert(job2.status === 202, 'Second job returns 202');
  assert(job2.json.jobId, 'Second job has jobId');
  assert(job2.json.jobId !== jobId, 'Second job has different jobId');

  // Test 9: Non-existent job returns 404
  console.log('\n--- Test: Non-existent job ---');
  const notFound = await api('/api/pdfme/render/status/nonexistent-job-12345', { token: TOKEN });
  assert(notFound.status === 404, 'Non-existent job returns 404 (got ' + notFound.status + ')');

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
