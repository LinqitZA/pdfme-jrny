/**
 * Test Feature #163: API returns 410 Gone for expired previews
 */
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const AUTH_HEADER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSIsIm9yZ0lkIjoib3JnMSIsInJvbGVzIjpbInRlbXBsYXRlOmVkaXQiLCJ0ZW1wbGF0ZTpwdWJsaXNoIiwicmVuZGVyOnRyaWdnZXIiXSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9.2ZGHiSlXXmMzlGjmwUbN5bN3vZTlVmKZm9lEkQ_YNHY';

let passed = 0;
let failed = 0;
let templateId = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTH_HEADER,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
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

async function ensureTemplate() {
  // Create a template for preview generation
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Preview-410-Test',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{ name: 'company', type: 'text', position: { x: 20, y: 30 }, width: 100, height: 10 }]],
      columns: ['company'],
    },
  });
  if (res.status === 201 || res.status === 200) {
    templateId = res.body.id;
    console.log(`  Template created: ${templateId}`);
    return true;
  }
  console.log(`  Failed to create template: ${res.status}`, res.body);
  return false;
}

async function test1_generatePreview() {
  console.log('\nTest 1: Generate a preview PDF');
  const res = await request('POST', `/api/pdfme/templates/${templateId}/preview`, {
    sampleRowCount: 5,
  });
  assert('Preview generation returns 200 or 201', res.status === 200 || res.status === 201);
  assert('Response has previewId', !!res.body.previewId);
  assert('Response has downloadUrl', !!res.body.downloadUrl);
  assert('Response has expiresAt', !!res.body.expiresAt);
  assert('previewId starts with prev_', res.body.previewId?.startsWith('prev_'));
  return res.body;
}

async function test2_downloadValidPreview(previewId) {
  console.log('\nTest 2: Download valid (non-expired) preview');
  const res = await request('GET', `/api/pdfme/render/download/${previewId}`);
  assert('Valid preview download returns 200', res.status === 200);
}

async function test3_forceExpireAndGet410(previewId) {
  console.log('\nTest 3: Force-expire preview and verify 410 Gone');

  // Force expire the preview
  const expireRes = await request('POST', '/api/pdfme/render/force-expire-preview', {
    previewId,
  });
  assert('Force expire returns success', expireRes.body.expired === true);

  // Now try to download - should get 410
  const downloadRes = await request('GET', `/api/pdfme/render/download/${previewId}`);
  assert('Expired preview returns 410', downloadRes.status === 410);
  assert('Response error is "Gone"', downloadRes.body.error === 'Gone');
  assert('Response message mentions expired', downloadRes.body.message?.includes('expired'));
}

async function test4_nonExistentPreview410() {
  console.log('\nTest 4: Non-existent preview returns 410 Gone');
  const res = await request('GET', '/api/pdfme/render/download/prev_nonexistent123');
  assert('Non-existent preview returns 410', res.status === 410);
  assert('Response error is "Gone"', res.body.error === 'Gone');
}

async function test5_alreadyExpiredCannotRedownload(previewId) {
  console.log('\nTest 5: Already expired preview still returns 410 on retry');
  const res = await request('GET', `/api/pdfme/render/download/${previewId}`);
  assert('Retry of expired preview returns 410', res.status === 410);
}

async function test6_newPreviewStillWorks() {
  console.log('\nTest 6: New preview still works after previous one expired');
  const genRes = await request('POST', `/api/pdfme/templates/${templateId}/preview`, {
    sampleRowCount: 5,
  });
  assert('New preview generates ok', genRes.status === 200 || genRes.status === 201);

  const dlRes = await request('GET', `/api/pdfme/render/download/${genRes.body.previewId}`);
  assert('New preview downloads ok', dlRes.status === 200);
}

async function test7_noAuthReturns400() {
  console.log('\nTest 7: No auth returns 400 (bad request)');
  // Request without auth
  const url = new URL('/api/pdfme/render/download/prev_test123', BASE);
  const res = await new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (r) => {
      let data = '';
      r.on('data', (chunk) => data += chunk);
      r.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: r.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
  // Without JWT the middleware may pass through with no user - results in 400
  assert('No auth returns 400 or 401', res.status === 400 || res.status === 401);
}

async function main() {
  console.log('=== Feature #163: API returns 410 Gone for expired previews ===\n');

  // Setup
  const ok = await ensureTemplate();
  if (!ok) {
    console.log('FATAL: Could not create template');
    process.exit(1);
  }

  // Test 1: Generate preview
  const preview = await test1_generatePreview();

  // Test 2: Download valid preview
  await test2_downloadValidPreview(preview.previewId);

  // Test 3: Force expire and get 410
  await test3_forceExpireAndGet410(preview.previewId);

  // Test 4: Non-existent preview
  await test4_nonExistentPreview410();

  // Test 5: Already expired retry
  await test5_alreadyExpiredCannotRedownload(preview.previewId);

  // Test 6: New preview still works
  await test6_newPreviewStillWorks();

  // Test 7: No auth
  await test7_noAuthReturns400();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
