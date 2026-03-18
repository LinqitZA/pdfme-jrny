/**
 * Test: Feature #257 - Search with very long string doesn't crash
 * Extremely long search query handled gracefully
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000';
const token = signJwt({ sub: 'user-257', orgId: 'org-257', roles: ['template:edit'] });

let passed = 0;
let failed = 0;

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
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
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

async function setup() {
  console.log('--- Setup: Create a template for baseline ---');
  await request('POST', `${BASE}/api/pdfme/templates`, {
    name: 'Long-Search-257',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'X' }]],
    },
  });
  console.log('  Template created');
}

async function test1000CharSearch() {
  console.log('\n--- Test: 1000 character search string ---');
  const longStr = 'a'.repeat(1000);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns 200 (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('Response is valid JSON', typeof r.body === 'object');
  if (r.status === 200) {
    assert('Data is array', Array.isArray(r.body.data));
    assert('Empty results (no match)', r.body.data.length === 0);
  } else {
    assert('Error response has message', !!r.body.message);
    assert('Is a graceful error', r.status === 400 || r.status === 414);
  }
}

async function test5000CharSearch() {
  console.log('\n--- Test: 5000 character search string ---');
  const longStr = 'b'.repeat(5000);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns valid response (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('Response is valid JSON', typeof r.body === 'object');
}

async function test10000CharSearch() {
  console.log('\n--- Test: 10000 character search string ---');
  const longStr = 'c'.repeat(10000);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns valid response (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('Response is valid JSON', typeof r.body === 'object');
}

async function testLongSpecialChars() {
  console.log('\n--- Test: Long string with special characters ---');
  const longStr = '%'.repeat(500) + "'".repeat(500);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns valid response (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('Response is valid JSON', typeof r.body === 'object');
  assert('No server error (not 500)', r.status !== 500);
}

async function testLongUnicode() {
  console.log('\n--- Test: Long unicode string ---');
  const longStr = '🎉'.repeat(500);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns valid response (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('Response is valid JSON', typeof r.body === 'object');
  assert('No server error (not 500)', r.status !== 500);
}

async function testAppStillFunctional() {
  console.log('\n--- Test: Application still functional after long searches ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=Long-Search-257`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Finds the template', r.body.data.some(t => t.name === 'Long-Search-257'));

  const health = await request('GET', `${BASE}/api/pdfme/health`, null);
  assert('Health check passes', health.status === 200);
  assert('Server is healthy', health.body.status === 'ok');
}

async function testLongRepeatedPattern() {
  console.log('\n--- Test: Long repeated SQL-like pattern ---');
  const longStr = "' OR ''='".repeat(100);
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=${encodeURIComponent(longStr)}`, null);
  assert('Returns valid response (not crash)', r.status === 200 || r.status === 400 || r.status === 414);
  assert('No server error (not 500)', r.status !== 500);
  assert('Response is valid JSON', typeof r.body === 'object');
}

async function run() {
  try {
    await setup();
    await test1000CharSearch();
    await test5000CharSearch();
    await test10000CharSearch();
    await testLongSpecialChars();
    await testLongUnicode();
    await testAppStillFunctional();
    await testLongRepeatedPattern();
  } catch (err) {
    console.error('Test error:', err);
  }

  console.log(`\n=============================`);
  console.log(`Results: ${passed}/${passed + failed} passing`);
  console.log(`=============================`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
