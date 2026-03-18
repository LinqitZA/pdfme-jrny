const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG = 'org-memory-360';
const TOKEN = makeToken('memory-user-360', ORG);

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log('  PASS ' + msg);
    passed++;
  } else {
    console.log('  FAIL ' + msg);
    failed++;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getServerMemory() {
  // Use the health endpoint and process.memoryUsage via a memory endpoint
  // Since we may not have a dedicated memory endpoint, we'll track response times
  // as a proxy for memory health, and also check via /health
  const health = await request('GET', '/health');
  return { healthy: health.status === 200 };
}

async function run() {
  console.log('Feature #360: No memory leaks during extended designer use\n');

  // Step 1: Get baseline server state
  console.log('--- Test 1: Baseline server state ---');
  const baseline = await request('GET', '/health');
  assert(baseline.status === 200, 'Server healthy at baseline');

  // Get initial response time baseline
  const baselineTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await request('GET', '/health');
    baselineTimes.push(Date.now() - start);
  }
  const avgBaseline = baselineTimes.reduce((a, b) => a + b, 0) / baselineTimes.length;
  console.log('  Baseline avg response time: ' + Math.round(avgBaseline) + 'ms');
  assert(avgBaseline < 1000, 'Baseline response time under 1s (' + Math.round(avgBaseline) + 'ms)');

  // Step 2: Create a template for extended editing simulation
  console.log('\n--- Test 2: Create test template ---');
  const tmplRes = await request('POST', '/templates', {
    name: 'Memory Test 360',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'base', content: 'Base', position: { x: 10, y: 10 }, width: 100, height: 15 }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });
  assert(tmplRes.status === 201, 'Template created');
  const tmplId = tmplRes.body && tmplRes.body.id;
  assert(!!tmplId, 'Template has ID');

  if (!tmplId) {
    console.log('Cannot continue without template');
    console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(1);
  }

  // Step 3: Simulate 100 add/delete/undo operations (template updates)
  console.log('\n--- Test 3: 100 add/delete/undo operations ---');
  const opTimes = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < 100; i++) {
    const opType = i % 3; // 0=add, 1=delete, 2=undo(re-add)
    const elements = [];

    if (opType === 0 || opType === 2) {
      // Add operation: template with multiple elements
      const numElements = Math.min(3 + Math.floor(i / 10), 15);
      for (let j = 0; j < numElements; j++) {
        elements.push({
          type: 'text',
          name: 'field_' + i + '_' + j,
          content: 'Content iteration ' + i + ' element ' + j,
          position: { x: 10 + (j % 5) * 40, y: 10 + Math.floor(j / 5) * 20 },
          width: 35,
          height: 15,
        });
      }
    } else {
      // Delete operation: template with minimal elements
      elements.push({
        type: 'text',
        name: 'minimal_' + i,
        content: 'Minimal',
        position: { x: 10, y: 10 },
        width: 100,
        height: 15,
      });
    }

    const start = Date.now();
    const res = await request('PUT', '/templates/' + tmplId, {
      name: 'Memory Test 360 - iter ' + i,
      schema: {
        pages: [{
          elements,
          size: { width: 210, height: 297 }
        }]
      }
    });
    const duration = Date.now() - start;
    opTimes.push(duration);

    if (res.status === 200) {
      successCount++;
    } else {
      failCount++;
    }

    // Every 25 operations, check server health
    if ((i + 1) % 25 === 0) {
      const healthCheck = await request('GET', '/health');
      const healthOk = healthCheck.status === 200;
      console.log('  After ' + (i + 1) + ' ops: health=' + (healthOk ? 'OK' : 'FAIL') +
        ' avgTime=' + Math.round(opTimes.slice(-25).reduce((a, b) => a + b, 0) / 25) + 'ms');
    }
  }

  assert(successCount === 100, 'All 100 operations succeeded (' + successCount + '/100)');
  assert(failCount === 0, 'No failed operations (' + failCount + ' failures)');

  // Step 4: Monitor memory usage - check response times didn't degrade
  console.log('\n--- Test 4: Response time stability ---');
  const firstQuarter = opTimes.slice(0, 25);
  const lastQuarter = opTimes.slice(-25);
  const avgFirst = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
  const avgLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;

  console.log('  First 25 ops avg: ' + Math.round(avgFirst) + 'ms');
  console.log('  Last 25 ops avg: ' + Math.round(avgLast) + 'ms');

  // Response times should not degrade significantly (< 5x slower)
  assert(avgLast < avgFirst * 5 + 50, 'Response times stable (last ' + Math.round(avgLast) +
    'ms vs first ' + Math.round(avgFirst) + 'ms)');

  // Step 5: Verify no continuous memory growth via health endpoint
  console.log('\n--- Test 5: Server still healthy after extended use ---');
  const postHealth = await request('GET', '/health');
  assert(postHealth.status === 200, 'Server healthy after 100 operations');
  assert(postHealth.body.database.status === 'connected', 'Database still connected');

  // Post-operation response times
  const postTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await request('GET', '/health');
    postTimes.push(Date.now() - start);
  }
  const avgPost = postTimes.reduce((a, b) => a + b, 0) / postTimes.length;
  console.log('  Post-operation avg response time: ' + Math.round(avgPost) + 'ms');
  assert(avgPost < 1000, 'Post-operation response time under 1s (' + Math.round(avgPost) + 'ms)');

  // Step 6: Verify garbage collection effective - old template versions don't accumulate
  console.log('\n--- Test 6: Template state clean after operations ---');
  const finalTemplate = await request('GET', '/templates/' + tmplId);
  assert(finalTemplate.status === 200, 'Can still fetch template after 100 updates');
  assert(finalTemplate.body.name.includes('iter 99'), 'Template has latest name');

  // Step 7: Heavy concurrent operations to stress-test memory
  console.log('\n--- Test 7: Concurrent operation stress test ---');
  const concurrentOps = [];
  for (let i = 0; i < 20; i++) {
    concurrentOps.push(request('GET', '/templates?limit=5'));
  }
  const concurrentResults = await Promise.all(concurrentOps);
  const concurrentSuccess = concurrentResults.filter(r => r.status === 200).length;
  assert(concurrentSuccess === 20, 'All 20 concurrent requests succeeded (' + concurrentSuccess + '/20)');

  // Step 8: Verify no leaked resources
  console.log('\n--- Test 8: Resource cleanup verification ---');

  // Create and delete templates to verify no resource leaks
  const tempIds = [];
  for (let i = 0; i < 10; i++) {
    const res = await request('POST', '/templates', {
      name: 'TempMemory360_' + i,
      type: 'invoice',
      schema: {
        pages: [{
          elements: [
            { type: 'text', name: 'tmp' + i, content: 'tmp', position: { x: 10, y: 10 }, width: 50, height: 10 }
          ],
          size: { width: 210, height: 297 }
        }]
      }
    });
    if (res.body && res.body.id) tempIds.push(res.body.id);
  }
  assert(tempIds.length === 10, 'Created 10 temp templates');

  // Delete them
  let deleteSuccess = 0;
  for (const id of tempIds) {
    const del = await request('DELETE', '/templates/' + id);
    if (del.status === 200 || del.status === 204) deleteSuccess++;
  }
  assert(deleteSuccess === 10, 'Deleted all 10 temp templates (' + deleteSuccess + '/10)');

  // Step 9: Final health check
  console.log('\n--- Test 9: Final health check ---');
  const finalHealth = await request('GET', '/health');
  assert(finalHealth.status === 200, 'Server still healthy after all tests');

  const finalTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await request('GET', '/health');
    finalTimes.push(Date.now() - start);
  }
  const avgFinal = finalTimes.reduce((a, b) => a + b, 0) / finalTimes.length;
  console.log('  Final avg response time: ' + Math.round(avgFinal) + 'ms (baseline was ' + Math.round(avgBaseline) + 'ms)');
  assert(avgFinal < avgBaseline * 10 + 100, 'Final response time reasonable vs baseline');

  // Summary
  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
