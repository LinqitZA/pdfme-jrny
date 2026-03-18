/**
 * Feature #356: Search response under 1 second
 * Creates 500 templates and verifies search queries respond quickly.
 */
const http = require('http');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function generateToken(orgId, userId) {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    orgId: orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const ORG_ID = 'org-search-perf-356';
const USER_ID = 'search-perf-user-356';
let TOKEN;
let passed = 0;
let failed = 0;

// Template categories for varied naming
const categories = ['Invoice', 'CreditNote', 'Statement', 'DeliveryNote', 'PurchaseOrder', 'Report', 'Receipt', 'Quotation', 'Contract', 'Memo'];
const adjectives = ['Monthly', 'Weekly', 'Annual', 'Custom', 'Standard', 'Premium', 'Basic', 'Advanced', 'Detailed', 'Summary'];

async function createTemplatesBatch(startIdx, count) {
  const promises = [];
  for (let i = startIdx; i < startIdx + count; i++) {
    const cat = categories[i % categories.length];
    const adj = adjectives[Math.floor(i / categories.length) % adjectives.length];
    const name = `${adj} ${cat} Template ${i}`;
    const body = JSON.stringify({
      name,
      type: cat.toLowerCase(),
      schema: {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        columns: [],
        schemas: [[{ title: { type: 'text', width: 100, height: 12, position: { x: 10, y: 10 } } }]],
        sampledata: [{}]
      }
    });
    promises.push(httpRequest(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body
    }));
  }
  return Promise.all(promises);
}

async function setup() {
  TOKEN = generateToken(ORG_ID, USER_ID);

  // Check if templates already exist
  const checkRes = await httpRequest(`${API_BASE}/templates?limit=1`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  const checkBody = JSON.parse(checkRes.data);
  if (checkBody.pagination && checkBody.pagination.total >= 500) {
    process.stdout.write(`Already have ${checkBody.pagination.total} templates, skipping creation.\n`);
    return;
  }

  // Create 500 templates in batches of 50
  const needed = 500 - (checkBody.pagination ? checkBody.pagination.total : 0);
  process.stdout.write(`Creating ${needed} templates (have ${checkBody.pagination ? checkBody.pagination.total : 0})...\n`);
  const batches = Math.ceil(needed / 50);
  for (let batch = 0; batch < batches; batch++) {
    const count = Math.min(50, needed - batch * 50);
    await createTemplatesBatch(batch * 50, count);
    process.stdout.write(`  Batch ${batch + 1}/${batches} complete\n`);
  }
  process.stdout.write('Templates created.\n');
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`PASS: ${name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL: ${name} - ${e.message}\n`);
  }
}

async function run() {
  await setup();

  // Test 1: Search by exact name under 1 second
  // Index 0 = Monthly Invoice Template 0
  await test('Search by exact name under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=${encodeURIComponent('Monthly Invoice Template 0')}&limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms, expected <1000ms`);
    const body = JSON.parse(res.data);
    if (!body.data || body.data.length === 0) throw new Error('No results found');
  });

  // Test 2: Search by partial name under 1 second
  await test('Search by partial name under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=Invoice&limit=50`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms, expected <1000ms`);
    const body = JSON.parse(res.data);
    if (!body.data || body.data.length === 0) throw new Error('No Invoice results');
  });

  // Test 3: Search for non-existent term under 1 second
  await test('Search for non-existent term under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=ZZZZNONEXISTENT&limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms, expected <1000ms`);
    const body = JSON.parse(res.data);
    if (body.data.length !== 0) throw new Error('Expected 0 results');
  });

  // Test 4: Search with different terms all under 1 second
  await test('Multiple search terms all under 1 second', async () => {
    const terms = ['Premium', 'Basic', 'Statement', 'Report', 'Quotation'];
    for (const term of terms) {
      const start = performance.now();
      const res = await httpRequest(`${API_BASE}/templates?search=${term}&limit=20`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      const elapsed = performance.now() - start;
      if (res.status !== 200) throw new Error(`${term}: Status ${res.status}`);
      if (elapsed > 1000) throw new Error(`${term}: took ${elapsed.toFixed(0)}ms`);
    }
  });

  // Test 5: Search with limit=100 under 1 second
  await test('Search with large limit (100) under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=Template&limit=100`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms, expected <1000ms`);
    const body = JSON.parse(res.data);
    if (body.data.length < 50) throw new Error(`Expected many results, got ${body.data.length}`);
  });

  // Test 6: Case-insensitive search under 1 second
  await test('Case-insensitive search under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=invoice&limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms`);
    const body = JSON.parse(res.data);
    if (body.data.length === 0) throw new Error('Case-insensitive search returned no results');
  });

  // Test 7: Search with pagination cursor under 1 second
  await test('Search with pagination under 1 second', async () => {
    // First page
    const start1 = performance.now();
    const res1 = await httpRequest(`${API_BASE}/templates?search=Template&limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed1 = performance.now() - start1;
    if (elapsed1 > 1000) throw new Error(`Page 1: ${elapsed1.toFixed(0)}ms`);
    const body1 = JSON.parse(res1.data);
    if (!body1.pagination.nextCursor) throw new Error('No cursor for page 2');

    // Second page
    const start2 = performance.now();
    const res2 = await httpRequest(`${API_BASE}/templates?search=Template&limit=10&cursor=${body1.pagination.nextCursor}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed2 = performance.now() - start2;
    if (elapsed2 > 1000) throw new Error(`Page 2: ${elapsed2.toFixed(0)}ms`);
  });

  // Test 8: Concurrent searches under 1 second each
  await test('Concurrent searches all under 1 second', async () => {
    const terms = ['Invoice', 'Statement', 'Report'];
    const start = performance.now();
    const results = await Promise.all(terms.map(term =>
      httpRequest(`${API_BASE}/templates?search=${term}&limit=10`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      })
    ));
    const elapsed = performance.now() - start;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 200) throw new Error(`${terms[i]}: status ${results[i].status}`);
    }
    if (elapsed > 1000) throw new Error(`Concurrent searches took ${elapsed.toFixed(0)}ms total`);
  });

  // Test 9: Search returns correct results
  await test('Search returns relevant results (all match search term)', async () => {
    const res = await httpRequest(`${API_BASE}/templates?search=Contract&limit=50`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const body = JSON.parse(res.data);
    for (const tmpl of body.data) {
      if (!tmpl.name.toLowerCase().includes('contract')) {
        throw new Error(`Result "${tmpl.name}" doesn't match search term "Contract"`);
      }
    }
  });

  // Test 10: Search with special characters under 1 second
  await test('Search with special characters under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?search=${encodeURIComponent("Template 10")}&limit=10`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms`);
  });

  // Test 11: Average search time under 500ms (well under 1 second)
  await test('Average search time under 500ms over 10 queries', async () => {
    const times = [];
    const terms = ['Invoice', 'Statement', 'Report', 'Premium', 'Basic', 'Monthly', 'Weekly', 'Template', 'Receipt', 'Memo'];
    for (const term of terms) {
      const start = performance.now();
      await httpRequest(`${API_BASE}/templates?search=${term}&limit=20`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      times.push(performance.now() - start);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    if (avg > 500) throw new Error(`Average ${avg.toFixed(0)}ms, expected <500ms`);
  });

  // Test 12: Full list without search still fast
  await test('Full list without search under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?limit=100`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 1000) throw new Error(`Took ${elapsed.toFixed(0)}ms`);
  });

  // Summary
  const total = passed + failed;
  process.stdout.write(`\n${passed}/${total} tests passing\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch(e => {
  process.stdout.write(`ERROR: ${e.message}\n`);
  process.exit(1);
});
