/**
 * Feature #206: API handles malformed URL parameters
 * Invalid path params return 400 or 404, not 500.
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const TOKEN = signJwt({ sub: 'test-user-206', orgId: 'org-206', roles: ['admin', 'template:edit', 'render:trigger'] });

let passed = 0;
let failed = 0;

function request(method, path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { body = data; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log('  ✅ ' + name);
  } else {
    failed++;
    console.log('  ❌ ' + name);
  }
}

async function runTests() {
  console.log('\n=== Feature #206: API handles malformed URL parameters ===\n');

  // --- Templates endpoint ---
  console.log('--- GET /api/pdfme/templates/:id with malformed IDs ---');

  const r1 = await request('GET', '/api/pdfme/templates/not-a-valid-id');
  console.log('  not-a-valid-id:', r1.status, JSON.stringify(r1.body).substring(0, 100));
  assert('String ID returns 400 or 404 (not 500)', r1.status === 400 || r1.status === 404);
  assert('Response has error message', r1.body && typeof r1.body.message === 'string');

  const r2 = await request('GET', '/api/pdfme/templates/999999');
  console.log('  999999:', r2.status);
  assert('Non-existent numeric ID returns 404 (not 500)', r2.status === 404 || r2.status === 400);

  const r3 = await request('GET', '/api/pdfme/templates/abc%21%40%23');
  console.log('  special chars:', r3.status);
  assert('Special characters in ID returns 400 or 404 (not 500)', r3.status === 400 || r3.status === 404);

  const r4 = await request('GET', '/api/pdfme/templates/');
  console.log('  empty ID:', r4.status);
  assert('Empty ID returns list (200) or 400/404 (not 500)', r4.status === 200 || r4.status === 400 || r4.status === 404);

  const r5 = await request('GET', '/api/pdfme/templates/-1');
  console.log('  negative ID:', r5.status);
  assert('Negative ID returns 400 or 404 (not 500)', r5.status === 400 || r5.status === 404);

  const r6 = await request('GET', '/api/pdfme/templates/0');
  console.log('  zero ID:', r6.status);
  assert('Zero ID returns 400 or 404 (not 500)', r6.status === 400 || r6.status === 404);

  // Very long ID
  const longId = 'a'.repeat(500);
  const r7 = await request('GET', '/api/pdfme/templates/' + longId);
  console.log('  very long ID:', r7.status);
  assert('Very long ID returns 400 or 404 (not 500)', r7.status === 400 || r7.status === 404);

  // --- Render download endpoint ---
  console.log('\n--- GET /api/pdfme/render/download/:previewId with malformed IDs ---');

  const r8 = await request('GET', '/api/pdfme/render/download/malformed-id');
  console.log('  malformed-id:', r8.status);
  assert('Malformed preview ID returns 400 or 410 (not 500)', r8.status === 400 || r8.status === 410 || r8.status === 404);

  const r9 = await request('GET', '/api/pdfme/render/download/12345-not-real');
  console.log('  fake preview ID:', r9.status);
  assert('Non-existent preview ID returns 400 or 410 (not 500)', r9.status === 400 || r9.status === 410 || r9.status === 404);

  // --- PUT templates with malformed ID ---
  console.log('\n--- PUT /api/pdfme/templates/:id with malformed IDs ---');

  const r10 = await request('PUT', '/api/pdfme/templates/not-valid');
  console.log('  PUT not-valid:', r10.status);
  assert('PUT with string ID returns 400 or 404 (not 500)', r10.status === 400 || r10.status === 404);

  // --- DELETE templates with malformed ID ---
  console.log('\n--- DELETE /api/pdfme/templates/:id with malformed IDs ---');

  const r11 = await request('DELETE', '/api/pdfme/templates/not-valid');
  console.log('  DELETE not-valid:', r11.status);
  assert('DELETE with string ID returns 400 or 404 (not 500)', r11.status === 400 || r11.status === 404);

  // --- SQL injection attempts ---
  console.log('\n--- SQL injection attempts ---');

  const r12 = await request('GET', '/api/pdfme/templates/1%20OR%201%3D1');
  console.log('  SQL injection:', r12.status);
  assert('SQL injection attempt returns 400 or 404 (not 500)', r12.status === 400 || r12.status === 404);

  const r13 = await request('GET', "/api/pdfme/templates/1'%20OR%20'1'%3D'1");
  console.log('  SQL quote injection:', r13.status);
  assert('SQL quote injection returns 400 or 404 (not 500)', r13.status === 400 || r13.status === 404);

  // Summary
  console.log('\n=== Results: ' + passed + '/' + (passed + failed) + ' passed ===\n');
  if (failed > 0) {
    throw new Error(failed + ' tests failed');
  }
}

runTests().catch((err) => {
  console.error('Test error:', err.message);
});
