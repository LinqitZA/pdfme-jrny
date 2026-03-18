const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('perf-user-352', 'org-perf-352');

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

// Create templates in batches to avoid overwhelming the server
async function createTemplatesBatch(startIdx, count) {
  const promises = [];
  for (let i = startIdx; i < startIdx + count; i++) {
    promises.push(request('POST', '/templates', {
      name: 'PerfTest-352-Template-' + String(i).padStart(4, '0'),
      type: 'invoice',
      schema: { fields: [] },
      pages: [{ elements: [], size: { width: 210, height: 297 } }]
    }));
  }
  return Promise.all(promises);
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
  process.stdout.write('=== Feature #352: Template list loads under 5 seconds with 1000 templates ===\n\n');

  // Step 1: Create 1000 templates in batches of 50
  process.stdout.write('Creating 1000 templates in batches...\n');
  const createStart = Date.now();

  const TOTAL_TEMPLATES = 1000;
  const BATCH_SIZE = 50;
  let created = 0;

  for (let batch = 0; batch < TOTAL_TEMPLATES / BATCH_SIZE; batch++) {
    const results = await createTemplatesBatch(batch * BATCH_SIZE, BATCH_SIZE);
    const successCount = results.filter(r => r.status === 201).length;
    created += successCount;
    if ((batch + 1) % 4 === 0) {
      process.stdout.write('  Created ' + created + '/' + TOTAL_TEMPLATES + ' templates\n');
    }
  }

  const createTime = Date.now() - createStart;
  process.stdout.write('Created ' + created + ' templates in ' + createTime + 'ms\n\n');

  assert('Created at least 1000 templates', created >= 1000, 'created=' + created);

  // Step 2: Measure list query response time (default page)
  process.stdout.write('\nMeasuring list query response time...\n');

  const listStart = Date.now();
  const listRes = await request('GET', '/templates?limit=20');
  const listTime = Date.now() - listStart;

  assert('List query returns 200', listRes.status === 200, 'status=' + listRes.status);
  assert('List query under 5 seconds', listTime < 5000, 'time=' + listTime + 'ms');
  assert('List query under 2 seconds (good perf)', listTime < 2000, 'time=' + listTime + 'ms');
  process.stdout.write('  List query time: ' + listTime + 'ms\n');

  // Step 3: Measure with larger page size
  const list50Start = Date.now();
  const list50Res = await request('GET', '/templates?limit=50');
  const list50Time = Date.now() - list50Start;

  assert('List 50 items returns 200', list50Res.status === 200);
  assert('List 50 items under 5 seconds', list50Time < 5000, 'time=' + list50Time + 'ms');
  process.stdout.write('  List 50 items time: ' + list50Time + 'ms\n');

  // Step 4: Measure with limit=100
  const list100Start = Date.now();
  const list100Res = await request('GET', '/templates?limit=100');
  const list100Time = Date.now() - list100Start;

  assert('List 100 items returns 200', list100Res.status === 200);
  assert('List 100 items under 5 seconds', list100Time < 5000, 'time=' + list100Time + 'ms');
  process.stdout.write('  List 100 items time: ' + list100Time + 'ms\n');

  // Step 5: Cursor pagination doesn't degrade
  process.stdout.write('\nMeasuring cursor pagination performance...\n');

  const pageTimes = [];
  let cursor = null;
  const PAGE_SIZE = 20;
  const PAGES_TO_TEST = 10;

  for (let page = 0; page < PAGES_TO_TEST; page++) {
    const pageUrl = cursor
      ? '/templates?limit=' + PAGE_SIZE + '&cursor=' + cursor
      : '/templates?limit=' + PAGE_SIZE;

    const pageStart = Date.now();
    const pageRes = await request('GET', pageUrl);
    const pageTime = Date.now() - pageStart;
    pageTimes.push(pageTime);

    if (pageRes.status !== 200) {
      process.stdout.write('  Page ' + (page + 1) + ': ERROR status=' + pageRes.status + '\n');
      break;
    }

    // Extract cursor for next page
    const data = pageRes.body;
    const pagination = data.pagination || {};
    if (pagination.nextCursor) {
      cursor = pagination.nextCursor;
    } else if (pagination.hasMore === false || !pagination.nextCursor) {
      // No more pages
      process.stdout.write('  Page ' + (page + 1) + ': ' + pageTime + 'ms (last page)\n');
      break;
    }

    process.stdout.write('  Page ' + (page + 1) + ': ' + pageTime + 'ms\n');
  }

  const avgPageTime = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
  const maxPageTime = Math.max(...pageTimes);
  const firstPageTime = pageTimes[0];
  const lastPageTime = pageTimes[pageTimes.length - 1];

  assert('Paginated ' + pageTimes.length + ' pages successfully', pageTimes.length >= 2);
  assert('Average page time under 5 seconds', avgPageTime < 5000, 'avg=' + Math.round(avgPageTime) + 'ms');
  assert('Max page time under 5 seconds', maxPageTime < 5000, 'max=' + maxPageTime + 'ms');
  assert('No significant degradation (last page < 3x first)', lastPageTime < firstPageTime * 3 + 100,
    'first=' + firstPageTime + 'ms, last=' + lastPageTime + 'ms');

  process.stdout.write('\n  Average page time: ' + Math.round(avgPageTime) + 'ms\n');
  process.stdout.write('  Max page time: ' + maxPageTime + 'ms\n');
  process.stdout.write('  First page: ' + firstPageTime + 'ms, Last page: ' + lastPageTime + 'ms\n');

  // Step 6: Multiple rapid sequential queries
  process.stdout.write('\nMeasuring rapid sequential queries...\n');
  const rapidTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await request('GET', '/templates?limit=20');
    rapidTimes.push(Date.now() - start);
  }
  const avgRapidTime = rapidTimes.reduce((a, b) => a + b, 0) / rapidTimes.length;

  assert('5 rapid queries all under 5 seconds each', rapidTimes.every(t => t < 5000),
    'times=' + rapidTimes.join(',') + 'ms');
  assert('Average rapid query time under 3 seconds', avgRapidTime < 3000,
    'avg=' + Math.round(avgRapidTime) + 'ms');

  process.stdout.write('  Rapid query times: ' + rapidTimes.join(', ') + 'ms\n');
  process.stdout.write('  Average: ' + Math.round(avgRapidTime) + 'ms\n');

  // Step 7: Concurrent queries
  process.stdout.write('\nMeasuring concurrent queries...\n');
  const concStart = Date.now();
  const concResults = await Promise.all([
    request('GET', '/templates?limit=20'),
    request('GET', '/templates?limit=20'),
    request('GET', '/templates?limit=20'),
  ]);
  const concTime = Date.now() - concStart;

  assert('3 concurrent queries all succeed', concResults.every(r => r.status === 200));
  assert('Concurrent queries complete under 5 seconds', concTime < 5000, 'time=' + concTime + 'ms');
  process.stdout.write('  3 concurrent queries time: ' + concTime + 'ms\n');

  // Cleanup: Delete test templates
  process.stdout.write('\nCleaning up test templates...\n');
  // We won't delete 1000 templates to save time - they're in a separate org

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
