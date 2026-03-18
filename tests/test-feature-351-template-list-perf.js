const crypto = require('crypto');
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'org-351-perf';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-351',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    let data = null;
    if (body) data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function main() {
  const token = makeToken();
  const uniqueSuffix = Date.now();

  console.log('\n=== Feature #351: Template list loads under 2s with 100 templates ===\n');

  // ─── Step 1: Create 100 templates ───
  console.log('Step 1: Creating 100 templates...');
  const TEMPLATE_COUNT = 100;
  let created = 0;
  const BATCH_SIZE = 10;

  for (let batch = 0; batch < TEMPLATE_COUNT / BATCH_SIZE; batch++) {
    const promises = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i;
      promises.push(request('POST', '/templates', {
        name: `PerfTest_Template_${String(idx).padStart(3, '0')}_${uniqueSuffix}`,
        type: idx % 3 === 0 ? 'invoice' : idx % 3 === 1 ? 'statement' : 'purchase_order',
        schema: {
          pages: [{
            elements: [
              { type: 'text', content: `Template ${idx}` },
              { type: 'text', content: `Description for template ${idx}` },
            ]
          }]
        },
      }, token));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status === 201) created++;
    }
  }
  assert(created === TEMPLATE_COUNT, `Created ${created}/${TEMPLATE_COUNT} templates`);

  // ─── Step 2: Measure page 1 response time ───
  console.log('\nStep 2: Measure GET /templates?limit=20 response time (page 1)');
  const start1 = Date.now();
  const page1 = await request('GET', '/templates?limit=20', null, token);
  const time1 = Date.now() - start1;

  assert(page1.status === 200, `Page 1 returns 200 (got ${page1.status})`);
  console.log(`  Response time: ${time1}ms`);
  assert(time1 < 2000, `Page 1 loads under 2 seconds (${time1}ms)`);

  const items1 = page1.body.data || page1.body.templates || page1.body;
  assert(Array.isArray(items1), `Response contains array of templates`);
  assert(items1.length === 20, `Returns 20 templates (got ${items1.length})`);

  // ─── Step 3: Measure page 2 response time ───
  console.log('\nStep 3: Measure page 2 response time');
  // Determine cursor or offset for page 2
  const cursor = page1.body.nextCursor || page1.body.cursor;
  let page2Url = '/templates?limit=20';
  if (cursor) {
    page2Url += `&cursor=${encodeURIComponent(cursor)}`;
  } else {
    page2Url += '&offset=20';
  }

  const start2 = Date.now();
  const page2 = await request('GET', page2Url, null, token);
  const time2 = Date.now() - start2;

  assert(page2.status === 200, `Page 2 returns 200 (got ${page2.status})`);
  console.log(`  Response time: ${time2}ms`);
  assert(time2 < 2000, `Page 2 loads under 2 seconds (${time2}ms)`);

  const items2 = page2.body.data || page2.body.templates || page2.body;
  assert(Array.isArray(items2), `Page 2 contains array`);
  assert(items2.length === 20, `Page 2 returns 20 templates (got ${items2.length})`);

  // ─── Step 4: Measure page 3 response time ───
  console.log('\nStep 4: Measure page 3 response time');
  const cursor2 = page2.body.nextCursor || page2.body.cursor;
  let page3Url = '/templates?limit=20';
  if (cursor2) {
    page3Url += `&cursor=${encodeURIComponent(cursor2)}`;
  } else {
    page3Url += '&offset=40';
  }

  const start3 = Date.now();
  const page3 = await request('GET', page3Url, null, token);
  const time3 = Date.now() - start3;

  assert(page3.status === 200, `Page 3 returns 200`);
  console.log(`  Response time: ${time3}ms`);
  assert(time3 < 2000, `Page 3 loads under 2 seconds (${time3}ms)`);

  // ─── Step 5: Measure last page ───
  console.log('\nStep 5: Measure last page response time');
  const cursorLast = page3.body.nextCursor || page3.body.cursor;
  let lastPageUrl = '/templates?limit=20';
  if (cursorLast) {
    lastPageUrl += `&cursor=${encodeURIComponent(cursorLast)}`;
  } else {
    lastPageUrl += '&offset=80';
  }

  const startLast = Date.now();
  const pageLast = await request('GET', lastPageUrl, null, token);
  const timeLast = Date.now() - startLast;

  assert(pageLast.status === 200, `Last page returns 200`);
  console.log(`  Response time: ${timeLast}ms`);
  assert(timeLast < 2000, `Last page loads under 2 seconds (${timeLast}ms)`);

  // ─── Step 6: Verify consistency across pages ───
  console.log('\nStep 6: Verify performance consistency');
  const times = [time1, time2, time3, timeLast];
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

  console.log(`  Times: ${times.join('ms, ')}ms`);
  console.log(`  Min: ${minTime}ms, Max: ${maxTime}ms, Avg: ${avgTime.toFixed(0)}ms`);

  assert(maxTime < 2000, `Max time across all pages under 2s (${maxTime}ms)`);
  assert(avgTime < 1000, `Average time under 1 second (${avgTime.toFixed(0)}ms)`);

  // No single page should be more than 5x slower than the fastest
  const ratio = maxTime / Math.max(minTime, 1);
  assert(ratio < 10, `Performance ratio max/min < 10x (${ratio.toFixed(1)}x)`);

  // ─── Step 7: Multiple rapid sequential requests ───
  console.log('\nStep 7: Multiple rapid sequential requests');
  const rapidTimes = [];
  for (let i = 0; i < 5; i++) {
    const s = Date.now();
    await request('GET', '/templates?limit=20', null, token);
    rapidTimes.push(Date.now() - s);
  }
  const rapidMax = Math.max(...rapidTimes);
  const rapidAvg = rapidTimes.reduce((a, b) => a + b, 0) / rapidTimes.length;
  console.log(`  5 rapid requests: ${rapidTimes.join('ms, ')}ms`);
  console.log(`  Max: ${rapidMax}ms, Avg: ${rapidAvg.toFixed(0)}ms`);
  assert(rapidMax < 2000, `All rapid requests under 2s (max: ${rapidMax}ms)`);

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
