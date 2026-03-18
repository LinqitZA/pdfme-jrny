/**
 * Feature #226: Concurrent bulk submit prevented
 * Cannot submit overlapping bulk renders for same template type
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const token = signJwt({ sub: 'user-226', orgId: 'org-226', roles: ['template:edit', 'render:bulk'] });

let passed = 0;
let failed = 0;
let templateId = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
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

async function createTemplate() {
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Bulk Test Template 226',
    type: 'invoice',
    orgId: 'org-226',
    schema: {
      pages: [{ elements: [{ type: 'text', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
      basePdf: { width: 210, height: 297 },
    },
  });
  templateId = res.body.id || res.body.template?.id;

  // Publish it
  if (templateId) {
    await request('POST', `/api/pdfme/templates/${templateId}/publish`, {});
  }
}

async function runTests() {
  console.log('\n=== Feature #226: Concurrent bulk submit prevented ===\n');

  // Setup: create a template
  await createTemplate();
  assert('Template created for testing', !!templateId);

  // Test 1: Submit bulk render A - should succeed with 202
  console.log('\n--- Test 1: Submit first bulk render ---');
  const bulkA = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-1', 'entity-2', 'entity-3', 'entity-4', 'entity-5'],
    entityType: 'invoice',
    channel: 'print',
  });
  assert('First bulk render accepted (202)', bulkA.status === 202);
  assert('First bulk has batchId', !!bulkA.body.batchId);
  assert('First bulk has running status', bulkA.body.status === 'running');
  const batchIdA = bulkA.body.batchId;

  // Test 2: Submit bulk render B for same template type - should be rejected
  console.log('\n--- Test 2: Submit overlapping bulk render (same type) ---');
  const bulkB = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-6', 'entity-7'],
    entityType: 'invoice',
    channel: 'print',
  });
  assert('Second bulk render rejected (409)', bulkB.status === 409);
  assert('Conflict response has error message', typeof bulkB.body.message === 'string' && bulkB.body.message.includes('already in progress'));
  assert('Conflict response includes existing batchId', bulkB.body.existingBatchId === batchIdA);

  // Test 3: No data corruption - first batch still accessible
  console.log('\n--- Test 3: First batch not corrupted ---');
  const statusA = await request('GET', `/api/pdfme/render/batch/${batchIdA}`);
  assert('First batch still accessible', statusA.status === 200);
  assert('First batch data intact (totalJobs)', statusA.body.totalJobs === 5);

  // Test 4: Different template type should work
  console.log('\n--- Test 4: Different template type allowed ---');
  const bulkC = await request('POST', '/api/pdfme/render/bulk', {
    templateId,
    entityIds: ['entity-8'],
    entityType: 'statement',
    channel: 'email',
  });
  assert('Different type bulk accepted (202)', bulkC.status === 202);
  assert('Different type has its own batchId', !!bulkC.body.batchId && bulkC.body.batchId !== batchIdA);

  // Test 5: Different org should also work (use different JWT)
  console.log('\n--- Test 5: Different org allowed ---');
  const token2 = signJwt({ sub: 'user-226b', orgId: 'org-226-other', roles: ['render:bulk'] });
  // Create template for other org
  const otherRes = await new Promise((resolve, reject) => {
    const url = new URL('/api/pdfme/templates', BASE);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({
      name: 'Other Org Template 226',
      type: 'invoice',
      orgId: 'org-226-other',
      schema: { pages: [{ elements: [{ type: 'text', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }], basePdf: { width: 210, height: 297 } },
    }));
    req.end();
  });
  const otherTemplateId = otherRes.body.id || otherRes.body.template?.id;

  if (otherTemplateId) {
    // Publish
    await new Promise((resolve, reject) => {
      const url = new URL(`/api/pdfme/templates/${otherTemplateId}/publish`, BASE);
      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      });
      req.on('error', reject);
      req.write('{}');
      req.end();
    });

    const bulkOther = await new Promise((resolve, reject) => {
      const url = new URL('/api/pdfme/render/bulk', BASE);
      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        templateId: otherTemplateId,
        entityIds: ['entity-other-1'],
        entityType: 'invoice',
        channel: 'print',
      }));
      req.end();
    });
    assert('Different org same type accepted (202)', bulkOther.status === 202);
  } else {
    assert('Different org same type accepted (202)', false);
  }

  // Test 6: Wait for batch A to complete, then re-submit should work
  console.log('\n--- Test 6: After completion, new submit allowed ---');
  // Wait for batch A to complete (polling)
  let retries = 0;
  let batchDone = false;
  while (retries < 30) {
    const st = await request('GET', `/api/pdfme/render/batch/${batchIdA}`);
    if (st.body.status !== 'running') {
      batchDone = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
    retries++;
  }
  assert('First batch completed', batchDone);

  if (batchDone) {
    const bulkRetry = await request('POST', '/api/pdfme/render/bulk', {
      templateId,
      entityIds: ['entity-retry-1', 'entity-retry-2'],
      entityType: 'invoice',
      channel: 'print',
    });
    assert('Re-submit after completion accepted (202)', bulkRetry.status === 202);
    assert('Re-submit has new batchId', !!bulkRetry.body.batchId && bulkRetry.body.batchId !== batchIdA);
  }

  // Test 7: Verify no data corruption - original batch data unchanged
  console.log('\n--- Test 7: Data integrity ---');
  const finalStatus = await request('GET', `/api/pdfme/render/batch/${batchIdA}`);
  assert('Original batch totalJobs unchanged', finalStatus.body.totalJobs === 5);
  assert('Original batch status is terminal', finalStatus.body.status !== 'running');

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
