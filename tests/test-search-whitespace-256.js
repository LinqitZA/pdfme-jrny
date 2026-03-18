/**
 * Test: Feature #256 - Template search whitespace-only returns all
 * Whitespace search treated as empty
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000';
const token = signJwt({ sub: 'user-256', orgId: 'org-256', roles: ['template:edit', 'template:publish'] });

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
  console.log('--- Setup: Create test templates ---');
  for (let i = 0; i < 3; i++) {
    await request('POST', `${BASE}/api/pdfme/templates`, {
      name: `WS-Test-256-${i}`,
      type: 'invoice',
      schema: {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'X' }]],
      },
    });
  }
  console.log('  Created 3 templates');
}

async function testNoSearch() {
  console.log('\n--- Test: Baseline - no search parameter ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  return r.body.data.length;
}

async function testSpacesOnly(baseCount) {
  console.log('\n--- Test: Spaces-only search ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=   `, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns same count as no-search', r.body.data.length === baseCount);
  assert('No error in response', !r.body.error);
}

async function testTabsOnly(baseCount) {
  console.log('\n--- Test: Tab character search ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=%09`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns same count as no-search', r.body.data.length === baseCount);
}

async function testNewlineOnly(baseCount) {
  console.log('\n--- Test: Newline search ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=%0A`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns same count as no-search', r.body.data.length === baseCount);
}

async function testMixedWhitespace(baseCount) {
  console.log('\n--- Test: Mixed whitespace (space + tab + newline) ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=%20%09%0A%20`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns same count as no-search', r.body.data.length === baseCount);
}

async function testEmptyString(baseCount) {
  console.log('\n--- Test: Empty string search ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns same count as no-search', r.body.data.length === baseCount);
}

async function testActualSearchStillWorks() {
  console.log('\n--- Test: Actual search still works ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=WS-Test-256`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Returns only matching templates', r.body.data.length >= 3);
  assert('All results match search', r.body.data.every(t => t.name.includes('WS-Test-256')));
}

async function testSearchWithLeadingTrailingSpaces() {
  console.log('\n--- Test: Search with leading/trailing spaces still matches ---');
  const r = await request('GET', `${BASE}/api/pdfme/templates?search=%20WS-Test-256%20`, null);
  assert('Returns 200', r.status === 200);
  assert('Has data array', Array.isArray(r.body.data));
  assert('Trimmed search still finds results', r.body.data.length >= 3);
}

async function run() {
  try {
    await setup();
    const baseCount = await testNoSearch();
    await testSpacesOnly(baseCount);
    await testTabsOnly(baseCount);
    await testNewlineOnly(baseCount);
    await testMixedWhitespace(baseCount);
    await testEmptyString(baseCount);
    await testActualSearchStillWorks();
    await testSearchWithLeadingTrailingSpaces();
  } catch (err) {
    console.error('Test error:', err);
  }

  console.log(`\n=============================`);
  console.log(`Results: ${passed}/${passed + failed} passing`);
  console.log(`=============================`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
