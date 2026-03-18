/**
 * Feature #232: Batch render updates statistics correctly
 *
 * Tests that after batch completion:
 * - totalJobs matches the number of items submitted
 * - completedJobs matches actual successful renders
 * - failedJobs matches actual failed renders
 * - failedIds populated if any failures
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('test-batch-stats-232', 'org-batch-stats-232', ['admin']);
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, msg) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ FAIL: ${msg}\n`);
  }
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...AUTH,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createPublishedTemplate(name) {
  // Create template
  const create = await api('POST', '/templates', {
    name,
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Test' }],
        width: 210,
        height: 297,
      }],
    },
  });
  const templateId = create.body.id || create.body.template?.id;

  // Publish it
  await api('POST', `/templates/${templateId}/publish`, {});

  return templateId;
}

async function run() {
  process.stdout.write('\n=== Feature #232: Batch render updates statistics correctly ===\n\n');

  // Create a published template for batch rendering
  const templateId = await createPublishedTemplate('Batch Stats Test 232');
  assert(!!templateId, 'Published template created for batch testing');

  // ---- Test 1: Batch with all successful items ----
  process.stdout.write('\n--- Test: Batch with all successful items ---\n');
  {
    const entityIds = ['entity-s1', 'entity-s2', 'entity-s3', 'entity-s4', 'entity-s5'];
    const res = await api('POST', '/render/bulk', {
      templateId,
      entityIds,
      channel: 'email',
      entityType: 'batch-stats-success-232',
    });
    assert(res.status === 202, `Bulk render accepted (status=${res.status})`);
    assert(!!res.body.batchId, `Batch ID returned: ${res.body.batchId}`);
    assert(res.body.totalJobs === 5, `totalJobs=5 in initial response (got ${res.body.totalJobs})`);

    const batchId = res.body.batchId;

    // Wait for batch to complete
    let batchStatus;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const statusRes = await api('GET', `/render/batch/${batchId}`);
      batchStatus = statusRes.body;
      if (batchStatus.status !== 'running') break;
    }

    assert(batchStatus.status === 'completed', `Batch status is 'completed' (got '${batchStatus.status}')`);
    assert(batchStatus.totalJobs === 5, `totalJobs=5 after completion (got ${batchStatus.totalJobs})`);
    assert(batchStatus.completedJobs === 5, `completedJobs=5 (got ${batchStatus.completedJobs})`);
    assert(batchStatus.failedJobs === 0, `failedJobs=0 (got ${batchStatus.failedJobs})`);
    assert(Array.isArray(batchStatus.failedIds), `failedIds is an array`);
    assert(batchStatus.failedIds.length === 0, `failedIds is empty (got ${batchStatus.failedIds.length})`);
  }

  // ---- Test 2: Batch with 10 items (all success) ----
  process.stdout.write('\n--- Test: Batch with 10 items ---\n');
  {
    const entityIds = [];
    for (let i = 1; i <= 10; i++) entityIds.push(`entity-ten-${i}`);

    const res = await api('POST', '/render/bulk', {
      templateId,
      entityIds,
      channel: 'print',
      entityType: 'batch-stats-ten-232',
    });
    assert(res.status === 202, `Bulk render accepted for 10 items`);
    assert(res.body.totalJobs === 10, `totalJobs=10 in initial response (got ${res.body.totalJobs})`);

    const batchId = res.body.batchId;
    let batchStatus;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const statusRes = await api('GET', `/render/batch/${batchId}`);
      batchStatus = statusRes.body;
      if (batchStatus.status !== 'running') break;
    }

    assert(batchStatus.totalJobs === 10, `totalJobs=10 after completion (got ${batchStatus.totalJobs})`);
    assert(batchStatus.completedJobs === 10, `completedJobs=10 (got ${batchStatus.completedJobs})`);
    assert(batchStatus.failedJobs === 0, `failedJobs=0 (got ${batchStatus.failedJobs})`);
    assert(batchStatus.failedIds.length === 0, `failedIds empty (got ${batchStatus.failedIds.length})`);
    assert(batchStatus.status === 'completed', `Status is 'completed'`);
  }

  // ---- Test 3: Batch with non-existent template (all fail) ----
  process.stdout.write('\n--- Test: Batch with invalid template (all items fail) ---\n');
  {
    const entityIds = ['fail-1', 'fail-2', 'fail-3'];
    const res = await api('POST', '/render/bulk', {
      templateId: 'nonexistent-template-xyz-232',
      entityIds,
      channel: 'email',
      entityType: 'batch-stats-fail-all-232',
    });
    assert(res.status === 202, `Bulk render accepted even with bad templateId`);

    const batchId = res.body.batchId;
    let batchStatus;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const statusRes = await api('GET', `/render/batch/${batchId}`);
      batchStatus = statusRes.body;
      if (batchStatus.status !== 'running') break;
    }

    assert(batchStatus.totalJobs === 3, `totalJobs=3 (got ${batchStatus.totalJobs})`);
    assert(batchStatus.completedJobs === 0, `completedJobs=0 for all-fail batch (got ${batchStatus.completedJobs})`);
    assert(batchStatus.failedJobs === 3, `failedJobs=3 (got ${batchStatus.failedJobs})`);
    assert(batchStatus.failedIds.length === 3, `failedIds has 3 entries (got ${batchStatus.failedIds.length})`);
    assert(batchStatus.failedIds.includes('fail-1'), `failedIds contains 'fail-1'`);
    assert(batchStatus.failedIds.includes('fail-2'), `failedIds contains 'fail-2'`);
    assert(batchStatus.failedIds.includes('fail-3'), `failedIds contains 'fail-3'`);
    assert(batchStatus.status === 'completedWithErrors', `Status is 'completedWithErrors' (got '${batchStatus.status}')`);
  }

  // ---- Test 4: Batch with single item ----
  process.stdout.write('\n--- Test: Batch with single item ---\n');
  {
    const res = await api('POST', '/render/bulk', {
      templateId,
      entityIds: ['single-entity-232'],
      channel: 'email',
      entityType: 'batch-stats-single-232',
    });
    assert(res.status === 202, `Single item batch accepted`);
    assert(res.body.totalJobs === 1, `totalJobs=1 (got ${res.body.totalJobs})`);

    const batchId = res.body.batchId;
    let batchStatus;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const statusRes = await api('GET', `/render/batch/${batchId}`);
      batchStatus = statusRes.body;
      if (batchStatus.status !== 'running') break;
    }

    assert(batchStatus.totalJobs === 1, `totalJobs=1 after completion (got ${batchStatus.totalJobs})`);
    assert(batchStatus.completedJobs === 1, `completedJobs=1 (got ${batchStatus.completedJobs})`);
    assert(batchStatus.failedJobs === 0, `failedJobs=0 (got ${batchStatus.failedJobs})`);
    assert(batchStatus.status === 'completed', `Status is 'completed'`);
  }

  // ---- Test 5: Batch status fields present ----
  process.stdout.write('\n--- Test: Batch status response has all required fields ---\n');
  {
    const res = await api('POST', '/render/bulk', {
      templateId,
      entityIds: ['field-check-1', 'field-check-2'],
      channel: 'email',
      entityType: 'batch-stats-fields-232',
    });
    const batchId = res.body.batchId;
    let batchStatus;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const statusRes = await api('GET', `/render/batch/${batchId}`);
      batchStatus = statusRes.body;
      if (batchStatus.status !== 'running') break;
    }

    assert('id' in batchStatus, `Response has 'id' field`);
    assert('status' in batchStatus, `Response has 'status' field`);
    assert('totalJobs' in batchStatus, `Response has 'totalJobs' field`);
    assert('completedJobs' in batchStatus, `Response has 'completedJobs' field`);
    assert('failedJobs' in batchStatus, `Response has 'failedJobs' field`);
    assert('failedIds' in batchStatus, `Response has 'failedIds' field`);
    assert(typeof batchStatus.totalJobs === 'number', `totalJobs is a number`);
    assert(typeof batchStatus.completedJobs === 'number', `completedJobs is a number`);
    assert(typeof batchStatus.failedJobs === 'number', `failedJobs is a number`);
    assert(batchStatus.completedJobs + batchStatus.failedJobs === batchStatus.totalJobs,
      `completedJobs(${batchStatus.completedJobs}) + failedJobs(${batchStatus.failedJobs}) = totalJobs(${batchStatus.totalJobs})`);
  }

  // ---- Summary ----
  process.stdout.write(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  process.stderr.write(`Test error: ${err.message}\n`);
  process.exit(1);
});
