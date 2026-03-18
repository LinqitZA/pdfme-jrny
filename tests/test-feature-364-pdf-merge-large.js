const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
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

const TOKEN = makeToken('merge-user-364', 'org-merge-364');

function request(method, path, body, timeout) {
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
      },
      timeout: timeout || 120000
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
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
  process.stdout.write('=== Feature #364: PDF merge handles large batches ===\n\n');

  // Step 1: Create and publish a template
  process.stdout.write('Creating and publishing template...\n');
  const templateRes = await request('POST', '/templates', {
    name: 'MergeLargeTest-364',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'MERGE TEST INVOICE' },
          { name: 'docId', type: 'text', position: { x: 20, y: 40 }, width: 170, height: 10, content: 'Document ID' },
          { name: 'amount', type: 'text', position: { x: 20, y: 55 }, width: 80, height: 10, content: 'Amount' },
          { name: 'desc', type: 'text', position: { x: 20, y: 70 }, width: 170, height: 10, content: 'Description' }
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

  // Step 2: Bulk render 50 documents
  process.stdout.write('\nStarting bulk render with 50 entities...\n');
  const entityIds = [];
  for (let i = 1; i <= 50; i++) {
    entityIds.push('MERGE-364-DOC-' + String(i).padStart(3, '0'));
  }

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
  assert('Total jobs is 50', bulkRes.body.totalJobs === 50, 'totalJobs=' + bulkRes.body.totalJobs);

  // Step 3: Wait for batch to complete
  process.stdout.write('\nWaiting for batch to complete...\n');
  let batchComplete = false;
  let lastStatus = null;
  let pollCount = 0;
  const MAX_POLLS = 300;

  while (!batchComplete && pollCount < MAX_POLLS) {
    await sleep(1000);
    pollCount++;

    const statusRes = await request('GET', '/render/batch/' + batchId, null);
    if (statusRes.status !== 200) continue;

    lastStatus = statusRes.body;
    const completed = lastStatus.completedJobs || 0;
    const failedJobs = lastStatus.failedJobs || 0;
    const progress = completed + failedJobs;

    if (pollCount % 10 === 0) {
      process.stdout.write('  Progress: ' + progress + '/50 (' + completed + ' ok, ' + failedJobs + ' failed)\n');
    }

    if (lastStatus.status === 'completed' || lastStatus.status === 'done' || progress >= 50) {
      batchComplete = true;
    }
  }

  assert('Batch completed', batchComplete, 'polls=' + pollCount);

  if (lastStatus) {
    assert('All 50 completed successfully', (lastStatus.completedJobs || 0) >= 50,
      'completed=' + (lastStatus.completedJobs || 0));
  }

  // Step 4: Merge all PDFs from the batch
  process.stdout.write('\nMerging 50 PDFs...\n');
  const mergeStart = Date.now();
  const mergeRes = await request('POST', '/render/batch/' + batchId + '/merge', {}, 300000);
  const mergeTime = Date.now() - mergeStart;

  process.stdout.write('  Merge completed in ' + mergeTime + 'ms (' + Math.round(mergeTime / 1000) + 's)\n');

  assert('Merge endpoint returns 200/201', mergeRes.status === 200 || mergeRes.status === 201,
    'status=' + mergeRes.status + ', body=' + JSON.stringify(mergeRes.body).substring(0, 300));

  if (mergeRes.status !== 200 && mergeRes.status !== 201) {
    process.stdout.write('Merge response: ' + JSON.stringify(mergeRes.body).substring(0, 500) + '\n');
    process.stdout.write('\n=== RESULTS ===\nPassed: ' + passed + '/' + total + '\nFailed: ' + failed + '/' + total + '\n');
    process.exit(1);
  }

  // Step 5: Verify merged PDF properties
  const mergeResult = mergeRes.body;

  assert('Merged document ID returned', !!mergeResult.mergedDocumentId,
    'mergedDocumentId=' + mergeResult.mergedDocumentId);
  assert('File path returned', !!mergeResult.filePath,
    'filePath=' + mergeResult.filePath);
  assert('PDF hash returned', !!mergeResult.pdfHash && typeof mergeResult.pdfHash === 'string',
    'pdfHash=' + mergeResult.pdfHash);

  // Each doc is single-page template, so 50 docs = 50 pages
  assert('Total pages is 50', mergeResult.totalPages === 50,
    'totalPages=' + mergeResult.totalPages);
  assert('Documents included is 50', mergeResult.documentsIncluded === 50,
    'documentsIncluded=' + mergeResult.documentsIncluded);

  // Step 6: Verify no timeout - merge completed within reasonable time
  assert('Merge completed under 60 seconds', mergeTime < 60000,
    'time=' + Math.round(mergeTime / 1000) + 's');
  assert('Merge completed under 30 seconds', mergeTime < 30000,
    'time=' + Math.round(mergeTime / 1000) + 's');

  // Step 7: Verify server didn't crash - health check
  process.stdout.write('\nVerifying server health after merge...\n');
  const healthRes = await new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/pdfme/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });

  assert('Server healthy after large merge', healthRes.status === 200, 'status=' + healthRes.status);

  // Step 8: Verify single render still works after merge (no resource exhaustion)
  const singleRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'MERGE-364-POST-CHECK',
    channel: 'email',
    data: {}
  });
  assert('Single render works after merge', singleRes.status === 201 || singleRes.status === 200,
    'status=' + singleRes.status);

  // Step 9: Verify merged PDF file is accessible via download
  if (mergeResult.filePath) {
    // Try to access the merged file via the document download endpoint if available
    process.stdout.write('\nVerifying merged PDF is accessible...\n');
    assert('Merged file path contains batch ID', mergeResult.filePath.includes(batchId),
      'filePath=' + mergeResult.filePath);
    assert('Merged file path is a PDF', mergeResult.filePath.endsWith('.pdf'),
      'filePath=' + mergeResult.filePath);
  }

  // Step 10: Try merging again - should still work (idempotent or return same result)
  const mergeRes2 = await request('POST', '/render/batch/' + batchId + '/merge', {}, 300000);
  assert('Second merge also succeeds', mergeRes2.status === 200 || mergeRes2.status === 201,
    'status=' + mergeRes2.status);

  if (mergeRes2.status === 200 || mergeRes2.status === 201) {
    assert('Second merge also has correct page count', mergeRes2.body.totalPages === 50,
      'totalPages=' + mergeRes2.body.totalPages);
  }

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
