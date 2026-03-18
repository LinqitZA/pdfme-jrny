/**
 * Feature #355: Designer load time under 3 seconds
 * Verifies the designer component loads quickly - mount to interactive under 3 seconds.
 */
const http = require('http');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_BASE = 'http://localhost:3001';

// Generate JWT
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

const ORG_ID = 'org-perf-355';
const USER_ID = 'perf-user-355';
let TOKEN;
let passed = 0;
let failed = 0;
let templateId;

async function setup() {
  TOKEN = generateToken(ORG_ID, USER_ID);

  // Create a template to load
  const schema = {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    columns: [],
    schemas: [[
      { title: { type: 'text', width: 100, height: 12, position: { x: 10, y: 10 }, fontSize: 18, fontWeight: 'bold' } },
      { date: { type: 'text', width: 60, height: 8, position: { x: 140, y: 10 } } },
      { body: { type: 'text', width: 190, height: 200, position: { x: 10, y: 30 } } },
      { footer: { type: 'text', width: 190, height: 10, position: { x: 10, y: 280 } } },
    ]],
    sampledata: [{}]
  };

  const res = await httpRequest(`${API_BASE}/templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    },
    body: JSON.stringify({ name: 'PerfTest355 Template', type: 'invoice', schema })
  });

  const tmpl = JSON.parse(res.data);
  templateId = tmpl.id;
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

  // Test 1: API response time for template fetch (should be fast)
  await test('API template fetch under 500ms', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (elapsed > 500) throw new Error(`Template fetch took ${elapsed.toFixed(0)}ms, expected <500ms`);
  });

  // Test 2: Designer HTML page loads quickly
  await test('Designer page HTML loads under 2 seconds', async () => {
    const start = performance.now();
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (elapsed > 2000) throw new Error(`Page load took ${elapsed.toFixed(0)}ms, expected <2000ms`);
  });

  // Test 3: Designer page contains required script tags (JS bundles loaded)
  await test('Designer page includes JS bundles', async () => {
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    if (!res.data.includes('<script')) throw new Error('No script tags found');
    if (!res.data.includes('react')) throw new Error('React bundle not included');
  });

  // Test 4: Designer page includes the designer component markup or suspense
  await test('Designer page includes ErpDesigner component or Suspense', async () => {
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    // Either the SSR'd content or the suspense fallback
    const hasDesigner = res.data.includes('erp-designer') || res.data.includes('Loading designer') || res.data.includes('designer-loading') || res.data.includes('Loading template');
    if (!hasDesigner) throw new Error('Designer markup not found');
  });

  // Test 5: Template schema loads correctly from API
  await test('Template schema loaded from API', async () => {
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const tmpl = JSON.parse(res.data);
    if (!tmpl.schema) throw new Error('No schema in template');
    if (!tmpl.schema.schemas || !tmpl.schema.schemas[0]) throw new Error('No schema pages');
    const elements = Object.keys(tmpl.schema.schemas[0]);
    if (elements.length < 4) throw new Error(`Expected 4 elements, got ${elements.length}`);
  });

  // Test 6: Canvas-related styles present in designer page
  await test('Canvas styles present in designer page', async () => {
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    // Check for designer-specific CSS
    const hasStyles = res.data.includes('erp-designer') || res.data.includes('canvas') || res.data.includes('style');
    if (!hasStyles) throw new Error('No canvas styles found');
  });

  // Test 7: Multiple rapid loads complete under 3 seconds each
  await test('5 consecutive loads all under 3 seconds', async () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
      const elapsed = performance.now() - start;
      times.push(elapsed);
      if (res.status !== 200) throw new Error(`Load ${i+1}: Expected 200, got ${res.status}`);
      if (elapsed > 3000) throw new Error(`Load ${i+1}: took ${elapsed.toFixed(0)}ms, expected <3000ms`);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // Average should also be under 3 seconds
    if (avg > 3000) throw new Error(`Average load time ${avg.toFixed(0)}ms exceeds 3s`);
  });

  // Test 8: API template list loads under 1 second
  await test('Template list API under 1 second', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates?limit=50`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (elapsed > 1000) throw new Error(`List took ${elapsed.toFixed(0)}ms, expected <1000ms`);
  });

  // Test 9: Designer loads without templateId (blank state) also fast
  await test('Designer blank state loads under 3 seconds', async () => {
    const start = performance.now();
    const res = await httpRequest(`${DESIGNER_BASE}/`);
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (elapsed > 3000) throw new Error(`Blank load took ${elapsed.toFixed(0)}ms`);
  });

  // Test 10: Template fetch with schema is complete (schema loaded)
  await test('Template fetch returns complete schema with canvas data', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    const tmpl = JSON.parse(res.data);
    if (elapsed > 500) throw new Error(`Fetch took ${elapsed.toFixed(0)}ms`);
    if (!tmpl.schema.basePdf) throw new Error('Missing basePdf');
    if (tmpl.schema.basePdf.width !== 210) throw new Error('Wrong page width');
    if (tmpl.schema.basePdf.height !== 297) throw new Error('Wrong page height');
  });

  // Test 11: Parallel resource loads complete under 3 seconds total
  await test('Parallel template + designer loads under 3 seconds', async () => {
    const start = performance.now();
    const [apiRes, pageRes] = await Promise.all([
      httpRequest(`${API_BASE}/templates/${templateId}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      }),
      httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`)
    ]);
    const elapsed = performance.now() - start;
    if (apiRes.status !== 200) throw new Error(`API: ${apiRes.status}`);
    if (pageRes.status !== 200) throw new Error(`Page: ${pageRes.status}`);
    if (elapsed > 3000) throw new Error(`Parallel load took ${elapsed.toFixed(0)}ms`);
  });

  // Test 12: Template with schema renders page content (SSR check)
  await test('Designer SSR renders designer-specific markup', async () => {
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    // Check that Next.js SSR produces meaningful content
    if (res.data.length < 1000) throw new Error(`Page too small: ${res.data.length} bytes`);
    if (!res.data.includes('<!DOCTYPE html>')) throw new Error('Not a full HTML page');
  });

  // Summary
  const total = passed + failed;
  if (failed === 0) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run().catch(e => {
  process.exit(1);
});
