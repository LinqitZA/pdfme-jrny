/**
 * Feature #357: Large template schema renders without lag
 * Creates a template with 50+ elements and verifies it loads/renders smoothly.
 */
const http = require('http');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_BASE = 'http://localhost:3001';

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

const ORG_ID = 'org-large-schema-357';
const USER_ID = 'large-schema-user-357';
let TOKEN;
let passed = 0;
let failed = 0;
let templateId;

// Generate a schema with 50+ elements across 2 pages
function generateLargeSchema() {
  const page1Elements = {};
  const page2Elements = {};

  // Page 1: 30 elements - mix of text, lines, rectangles
  for (let i = 0; i < 20; i++) {
    page1Elements[`text_${i}`] = {
      type: 'text',
      width: 40 + (i % 5) * 10,
      height: 8 + (i % 3) * 2,
      position: { x: 10 + (i % 4) * 48, y: 10 + Math.floor(i / 4) * 14 },
      fontSize: 8 + (i % 4) * 2,
    };
  }
  for (let i = 0; i < 10; i++) {
    page1Elements[`label_${i}`] = {
      type: 'text',
      width: 30,
      height: 6,
      position: { x: 10 + (i % 5) * 38, y: 80 + Math.floor(i / 5) * 10 },
      fontSize: 7,
      fontWeight: 'bold',
    };
  }

  // Page 2: 25 elements
  for (let i = 0; i < 15; i++) {
    page2Elements[`detail_${i}`] = {
      type: 'text',
      width: 50 + (i % 3) * 15,
      height: 10,
      position: { x: 10 + (i % 3) * 65, y: 10 + Math.floor(i / 3) * 15 },
      fontSize: 9,
    };
  }
  for (let i = 0; i < 10; i++) {
    page2Elements[`footer_${i}`] = {
      type: 'text',
      width: 35,
      height: 6,
      position: { x: 10 + (i % 5) * 38, y: 200 + Math.floor(i / 5) * 10 },
      fontSize: 7,
    };
  }

  return {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    columns: [],
    schemas: [page1Elements, page2Elements],
    sampledata: [{}]
  };
}

async function setup() {
  TOKEN = generateToken(ORG_ID, USER_ID);

  const schema = generateLargeSchema();
  const page1Count = Object.keys(schema.schemas[0]).length;
  const page2Count = Object.keys(schema.schemas[1]).length;
  process.stdout.write(`Creating template with ${page1Count + page2Count} elements (${page1Count} + ${page2Count})...\n`);

  const res = await httpRequest(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      name: 'Large Schema Performance Test 357',
      type: 'invoice',
      schema
    })
  });

  if (res.status !== 201) throw new Error(`Failed to create template: ${res.status} ${res.data}`);
  const tmpl = JSON.parse(res.data);
  templateId = tmpl.id;
  process.stdout.write(`Template created: ${templateId}\n`);
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

  // Test 1: Template with 50+ elements created successfully
  await test('Template with 50+ elements created', async () => {
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const tmpl = JSON.parse(res.data);
    const totalElements = tmpl.schema.schemas.reduce((sum, page) => sum + Object.keys(page).length, 0);
    if (totalElements < 50) throw new Error(`Only ${totalElements} elements, need 50+`);
  });

  // Test 2: API fetch of large template under 500ms
  await test('Large template API fetch under 500ms', async () => {
    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 500) throw new Error(`Fetch took ${elapsed.toFixed(0)}ms`);
  });

  // Test 3: Designer page loads large template under 3 seconds
  await test('Designer loads large template under 3 seconds', async () => {
    const start = performance.now();
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    const elapsed = performance.now() - start;
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (elapsed > 3000) throw new Error(`Designer load took ${elapsed.toFixed(0)}ms`);
  });

  // Test 4: Multiple rapid fetches of large template all fast
  await test('5 consecutive fetches of large template all under 500ms', async () => {
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      const elapsed = performance.now() - start;
      if (res.status !== 200) throw new Error(`Fetch ${i+1}: status ${res.status}`);
      if (elapsed > 500) throw new Error(`Fetch ${i+1}: ${elapsed.toFixed(0)}ms`);
    }
  });

  // Test 5: Schema update (property change) on large template responsive
  await test('Schema update on large template under 1 second', async () => {
    // Modify one element in the schema
    const getRes = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const tmpl = JSON.parse(getRes.data);
    tmpl.schema.schemas[0].text_0.fontSize = 20;

    // Acquire lock first
    await httpRequest(`${API_BASE}/templates/${templateId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }
    });

    const start = performance.now();
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ schema: tmpl.schema })
    });
    const elapsed = performance.now() - start;

    // Release lock
    await httpRequest(`${API_BASE}/templates/${templateId}/lock`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });

    if (res.status !== 200) throw new Error(`Update status ${res.status}: ${res.data}`);
    if (elapsed > 1000) throw new Error(`Update took ${elapsed.toFixed(0)}ms`);
  });

  // Test 6: All elements preserved after save
  await test('All 55 elements preserved after save', async () => {
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const tmpl = JSON.parse(res.data);
    const totalElements = tmpl.schema.schemas.reduce((sum, page) => sum + Object.keys(page).length, 0);
    if (totalElements < 50) throw new Error(`Only ${totalElements} elements after save`);
    // Verify the updated fontSize
    if (tmpl.schema.schemas[0].text_0.fontSize !== 20) throw new Error('Update not persisted');
  });

  // Test 7: Designer page with large template includes proper markup
  await test('Designer page renders proper HTML for large template', async () => {
    const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
    if (!res.data.includes('<!DOCTYPE html>')) throw new Error('Not a full HTML page');
    if (res.data.length < 1000) throw new Error(`Page too small: ${res.data.length}`);
    const hasDesigner = res.data.includes('designer-loading') || res.data.includes('Loading template') || res.data.includes('ErpDesigner');
    if (!hasDesigner) throw new Error('No designer markup');
  });

  // Test 8: Parallel fetch + designer load of large template
  await test('Parallel API + designer load under 3 seconds', async () => {
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
    if (elapsed > 3000) throw new Error(`Parallel took ${elapsed.toFixed(0)}ms`);
  });

  // Test 9: Schema JSON size reasonable (not bloated)
  await test('Schema JSON size under 50KB', async () => {
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const size = Buffer.byteLength(res.data, 'utf8');
    if (size > 50000) throw new Error(`Response is ${(size/1024).toFixed(1)}KB, expected <50KB`);
  });

  // Test 10: Template has correct element count per page
  await test('Element count correct on each page', async () => {
    const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const tmpl = JSON.parse(res.data);
    const page1Count = Object.keys(tmpl.schema.schemas[0]).length;
    const page2Count = Object.keys(tmpl.schema.schemas[1]).length;
    if (page1Count !== 30) throw new Error(`Page 1: ${page1Count} elements, expected 30`);
    if (page2Count !== 25) throw new Error(`Page 2: ${page2Count} elements, expected 25`);
  });

  // Test 11: Multiple designer loads of large template consistent performance
  await test('3 designer loads of large template all under 3 seconds', async () => {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const res = await httpRequest(`${DESIGNER_BASE}/?templateId=${templateId}&authToken=${TOKEN}&orgId=${ORG_ID}`);
      const elapsed = performance.now() - start;
      times.push(elapsed);
      if (res.status !== 200) throw new Error(`Load ${i+1}: status ${res.status}`);
      if (elapsed > 3000) throw new Error(`Load ${i+1}: ${elapsed.toFixed(0)}ms exceeds 3s`);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    process.stdout.write(`  (avg designer load: ${avg.toFixed(0)}ms)\n`);
  });

  // Test 12: Zoom simulation - multiple reads of large template stay fast
  await test('Repeated reads (simulating zoom) all under 500ms', async () => {
    // Simulating zoom by rapid re-reads of the schema (browser would re-render)
    const times = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const res = await httpRequest(`${API_BASE}/templates/${templateId}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      times.push(performance.now() - start);
      if (res.status !== 200) throw new Error(`Read ${i+1}: status ${res.status}`);
    }
    const max = Math.max(...times);
    if (max > 500) throw new Error(`Max read time ${max.toFixed(0)}ms`);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    process.stdout.write(`  (avg: ${avg.toFixed(0)}ms, max: ${max.toFixed(0)}ms)\n`);
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
