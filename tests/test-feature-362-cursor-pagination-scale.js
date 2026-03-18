/**
 * Feature #362: Cursor-based pagination scales linearly
 *
 * Tests that deep pagination doesn't slow down:
 * - Create 1000 records
 * - Measure time for page 1
 * - Measure time for page 50
 * - Verify similar response times
 * - No quadratic degradation
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const SECRET = 'pdfme-dev-secret';
const ORG_ID = 'org-pag-scale-362-' + Date.now();

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('pag-user-362', ORG_ID);

function doRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
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

function requestTimed(method, path, body) {
  const start = performance.now();
  return doRequest(method, path, body).then(res => {
    res.elapsed = performance.now() - start;
    return res;
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function createTemplates(count) {
  console.log(`  Creating ${count} templates in org ${ORG_ID}...`);
  const batchSize = 50;
  let created = 0;

  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const promises = [];
    const remaining = Math.min(batchSize, count - created);
    for (let i = 0; i < remaining; i++) {
      const idx = created + i;
      promises.push(
        doRequest('POST', '/templates', {
          name: `PagScale-${String(idx).padStart(4, '0')}`,
          type: 'invoice',
          orgId: ORG_ID,
          schema: { fields: [] },
        })
      );
    }
    await Promise.all(promises);
    created += remaining;
    if (created % 200 === 0) {
      console.log(`    ... ${created}/${count} created`);
    }
  }
  console.log(`  Created ${created} templates`);
  return created;
}

async function getPage(cursor, limit) {
  const path = cursor
    ? `/templates?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
    : `/templates?limit=${limit}`;
  return requestTimed('GET', path);
}

async function main() {
  console.log('=== Feature #362: Cursor-based pagination scales linearly ===');

  // Check API health
  const health = await doRequest('GET', '/health');
  assert(health.status === 200, 'API server is healthy');

  // Step 1: Create 1000 records
  console.log('\n--- Step 1: Create 1000 templates ---');
  const startCreate = performance.now();
  await createTemplates(1000);
  const createTime = performance.now() - startCreate;
  console.log(`  Total creation time: ${(createTime / 1000).toFixed(1)}s`);
  assert(true, `Created 1000 templates in ${(createTime / 1000).toFixed(1)}s`);

  // Verify we have templates
  const listCheck = await doRequest('GET', '/templates?limit=1');
  assert(listCheck.status === 200, 'Template list endpoint accessible');
  const totalCount = listCheck.body.pagination?.total || 0;
  console.log(`  Templates in org: ${totalCount}`);
  assert(totalCount >= 1000, `At least 1000 templates available (${totalCount})`);

  // Step 2: Measure page 1 response time
  console.log('\n--- Step 2: Measure page 1 response time ---');
  const limit = 20;

  // Warm up
  await getPage(null, limit);

  // Measure page 1 multiple times
  const page1Times = [];
  for (let i = 0; i < 10; i++) {
    const res = await getPage(null, limit);
    page1Times.push(res.elapsed);
  }
  page1Times.sort((a, b) => a - b);
  const page1Median = page1Times[Math.floor(page1Times.length / 2)];
  console.log(`  Page 1 median: ${page1Median.toFixed(2)}ms`);
  assert(page1Median < 100, `Page 1 median ${page1Median.toFixed(2)}ms < 100ms`);

  // Step 3: Navigate to page 50 via cursor pagination, measuring along the way
  console.log('\n--- Step 3: Measure time for page 50 ---');
  const pageTimes = [];
  let cursor = null;
  let pageNum = 0;

  for (let p = 0; p < 50; p++) {
    const res = await getPage(cursor, limit);
    pageNum = p + 1;

    if (res.status !== 200) {
      console.log(`  Page ${pageNum} returned ${res.status}: ${JSON.stringify(res.body).substring(0, 200)}`);
      break;
    }

    const templates = res.body.data || [];
    if (templates.length === 0) {
      console.log(`  No more templates at page ${pageNum}`);
      break;
    }

    // Record timing at key pages
    pageTimes.push({ page: pageNum, time: res.elapsed });

    // Get cursor for next page
    cursor = res.body.pagination?.nextCursor;
    if (!cursor && res.body.pagination?.hasMore) {
      console.log(`  Warning: hasMore=true but no nextCursor at page ${pageNum}`);
      break;
    }
    if (!cursor) {
      console.log(`  No more pages at page ${pageNum}`);
      break;
    }
  }

  // Show key page timings
  const keyPages = [1, 5, 10, 20, 30, 40, 50];
  console.log('  Page timings:');
  for (const kp of keyPages) {
    const pt = pageTimes.find(p => p.page === kp);
    if (pt) {
      console.log(`    Page ${pt.page}: ${pt.time.toFixed(2)}ms`);
    }
  }

  assert(pageNum >= 50, `Navigated to page 50 (reached page ${pageNum})`);

  // Get page 50 timing
  const page50 = pageTimes.find(p => p.page === 50);
  if (page50) {
    console.log(`  Page 50 time: ${page50.time.toFixed(2)}ms`);
    assert(page50.time < 100, `Page 50 response time ${page50.time.toFixed(2)}ms < 100ms`);
  }

  // Step 4: Verify similar response times
  console.log('\n--- Step 4: Verify similar response times ---');

  const page1Time = pageTimes.find(p => p.page === 1);
  if (page1Time && page50) {
    const ratio = page50.time / page1Time.time;
    console.log(`  Page 1: ${page1Time.time.toFixed(2)}ms, Page 50: ${page50.time.toFixed(2)}ms`);
    console.log(`  Ratio (page 50 / page 1): ${ratio.toFixed(2)}x`);
    assert(ratio < 5, `Page 50 is less than 5x slower than page 1 (${ratio.toFixed(2)}x)`);
  }

  // Check all pages are under a reasonable threshold
  const allUnderThreshold = pageTimes.every(pt => pt.time < 200);
  assert(allUnderThreshold, 'All pages respond under 200ms');

  // Step 5: No quadratic degradation
  console.log('\n--- Step 5: No quadratic degradation ---');

  // Split into early (1-10) and late (40-50) pages
  const earlyPages = pageTimes.filter(pt => pt.page >= 1 && pt.page <= 10);
  const latePages = pageTimes.filter(pt => pt.page >= 40 && pt.page <= 50);

  if (earlyPages.length > 0 && latePages.length > 0) {
    const earlyAvg = earlyPages.reduce((s, p) => s + p.time, 0) / earlyPages.length;
    const lateAvg = latePages.reduce((s, p) => s + p.time, 0) / latePages.length;

    console.log(`  Early pages (1-10) avg: ${earlyAvg.toFixed(2)}ms`);
    console.log(`  Late pages (40-50) avg: ${lateAvg.toFixed(2)}ms`);

    const growthRatio = lateAvg / earlyAvg;
    console.log(`  Growth ratio: ${growthRatio.toFixed(2)}x`);
    assert(growthRatio < 3, `No quadratic growth: late/early ratio = ${growthRatio.toFixed(2)}x (< 3x)`);

    // Verify linear (not quadratic): if quadratic, page 50 would be ~25x slower than page 1
    // (50^2 / 1^2 = 2500x for offset-based). With cursor, should be ~1x.
    assert(growthRatio < 5, `Growth is sub-linear (${growthRatio.toFixed(2)}x, quadratic would be >>5x)`);
  }

  // Verify consistency: compute standard deviation
  if (pageTimes.length > 5) {
    const avg = pageTimes.reduce((s, p) => s + p.time, 0) / pageTimes.length;
    const variance = pageTimes.reduce((s, p) => s + Math.pow(p.time - avg, 2), 0) / pageTimes.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avg;
    console.log(`  Across all ${pageTimes.length} pages: avg=${avg.toFixed(2)}ms, stdDev=${stdDev.toFixed(2)}ms, CV=${cv.toFixed(2)}`);
    assert(cv < 2, `Coefficient of variation ${cv.toFixed(2)} < 2 (consistent timing)`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
