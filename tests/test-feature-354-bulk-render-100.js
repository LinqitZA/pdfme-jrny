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

const TOKEN = makeToken('bulk-perf-user-354', 'org-bulk-354');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;
let total = 0;

function assert(name, condition, detail) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write('PASS: ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('FAIL: ' + name + (detail ? ' - ' + detail : '') + '\n');
  }
}

async function run() {
  process.stdout.write('=== Feature #354: Bulk render 100 documents completes ===\n\n');

  // Step 1: Create and publish a template
  process.stdout.write('Creating and publishing template...\n');
  const templateRes = await request('POST', '/templates', {
    name: 'BulkPerfTest-354-Invoice',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'BULK INVOICE' },
          { type: 'text', position: { x: 20, y: 40 }, width: 170, height: 10, content: 'Company' },
          { type: 'text', position: { x: 20, y: 55 }, width: 80, height: 10, content: 'Invoice Number' },
          { type: 'text', position: { x: 20, y: 70 }, width: 170, height: 10, content: 'Total' }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Template created', templateRes.status === 201, 'status=' + templateRes.status);
  const templateId = templateRes.body && templateRes.body.id;

  if (!templateId) {
    process.stdout.write('Cannot continue without template. Response: ' + JSON.stringify(templateRes.body).substring(0, 300) + '\n');
    process.exit(1);
  }

  const publishRes = await request('POST', '/templates/' + templateId + '/publish', {});
  assert('Template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Step 2: Start bulk render with 100 entityIds
  process.stdout.write('\nStarting bulk render with 100 entities...\n');

  const entityIds = [];
  for (let i = 1; i <= 100; i++) {
    entityIds.push('BULK-354-ENTITY-' + String(i).padStart(3, '0'));
  }

  const bulkStart = Date.now();
  const bulkRes = await request('POST', '/render/bulk', {
    templateId: templateId,
    entityIds: entityIds,
    channel: 'email'
  });

  assert('Bulk render accepted (202)', bulkRes.status === 202, 'status=' + bulkRes.status);

  if (bulkRes.status !== 202) {
    process.stdout.write('Bulk response: ' + JSON.stringify(bulkRes.body).substring(0, 500) + '\n');
    process.stdout.write('\n=== RESULTS ===\nPassed: ' + passed + '/' + total + '\nFailed: ' + failed + '/' + total + '\n');
    process.exit(1);
  }

  const batchId = bulkRes.body.batchId || bulkRes.body.id;
  assert('Batch ID returned', !!batchId, 'batchId=' + batchId);
  assert('Total jobs is 100', bulkRes.body.totalJobs === 100, 'totalJobs=' + bulkRes.body.totalJobs);

  process.stdout.write('  Batch ID: ' + batchId + '\n');
  process.stdout.write('  Total jobs: ' + bulkRes.body.totalJobs + '\n');

  // Step 3: Monitor batch progress
  process.stdout.write('\nMonitoring batch progress...\n');
  let batchComplete = false;
  let lastStatus = null;
  let pollCount = 0;
  const MAX_POLLS = 300; // 5 minutes max (1 second intervals)
  let progressReported = 0;

  while (!batchComplete && pollCount < MAX_POLLS) {
    await sleep(1000);
    pollCount++;

    const statusRes = await request('GET', '/render/batch/' + batchId, null);
    if (statusRes.status !== 200) {
      process.stdout.write('  Poll ' + pollCount + ': status check failed (' + statusRes.status + ')\n');
      continue;
    }

    lastStatus = statusRes.body;
    const completed = lastStatus.completedJobs || 0;
    const failedJobs = lastStatus.failedJobs || 0;
    const totalJobs = lastStatus.totalJobs || 100;
    const progress = completed + failedJobs;

    // Report every 10% progress
    const pct = Math.floor((progress / totalJobs) * 100);
    if (pct >= progressReported + 10) {
      process.stdout.write('  Progress: ' + progress + '/' + totalJobs + ' (' + pct + '%) - ' + completed + ' completed, ' + failedJobs + ' failed\n');
      progressReported = pct;
    }

    if (lastStatus.status === 'completed' || lastStatus.status === 'done' || progress >= totalJobs) {
      batchComplete = true;
    }
  }

  const bulkTime = Date.now() - bulkStart;
  process.stdout.write('\n  Batch completed in ' + bulkTime + 'ms (' + Math.round(bulkTime / 1000) + 's)\n');

  assert('Batch completed', batchComplete, 'polls=' + pollCount + ', status=' + (lastStatus ? lastStatus.status : 'unknown'));

  if (lastStatus) {
    const completedJobs = lastStatus.completedJobs || 0;
    const failedJobs = lastStatus.failedJobs || 0;
    const totalJobs = lastStatus.totalJobs || 100;

    assert('All 100 jobs accounted for', (completedJobs + failedJobs) >= 100,
      'completed=' + completedJobs + ', failed=' + failedJobs);
    assert('All 100 completed successfully', completedJobs >= 100,
      'completed=' + completedJobs + ', failed=' + failedJobs);
    assert('No failed jobs', failedJobs === 0, 'failedJobs=' + failedJobs);
    assert('Batch status is completed', lastStatus.status === 'completed' || lastStatus.status === 'done',
      'status=' + lastStatus.status);
  }

  // Step 4: Measure total time
  assert('Total time under 5 minutes', bulkTime < 300000, 'time=' + Math.round(bulkTime / 1000) + 's');
  assert('Total time under 2 minutes', bulkTime < 120000, 'time=' + Math.round(bulkTime / 1000) + 's');

  // Step 5: Check memory - verify server still responds normally
  process.stdout.write('\nVerifying server health after bulk render...\n');
  const healthRes = await request('GET', '/../api/pdfme/health', null);
  // Try direct health check
  const healthRes2 = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/pdfme/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });

  assert('Server healthy after bulk render', healthRes2.status === 200, 'status=' + healthRes2.status);

  // Verify we can still do a normal render after bulk
  const singleRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'BULK-354-POST-CHECK',
    channel: 'email',
    data: {}
  });
  assert('Single render works after bulk', singleRes.status === 201 || singleRes.status === 200,
    'status=' + singleRes.status);

  // Summary
  process.stdout.write('\n=== RESULTS ===\n');
  process.stdout.write('Passed: ' + passed + '/' + total + '\n');
  process.stdout.write('Failed: ' + failed + '/' + total + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write('ERROR: ' + err.message + '\n');
  process.exit(1);
});
