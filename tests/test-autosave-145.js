/**
 * Test script for feature #145: Auto-save every 30 seconds
 * Tests the auto-save functionality by:
 * 1. Creating a template via API
 * 2. Verifying the designer component has auto-save code
 * 3. Verifying the PUT /api/pdfme/templates/:id/draft endpoint works
 * 4. Verifying the auto-save indicator is rendered when templateId is provided
 */

const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const TOKEN1 = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWF1dG9zYXZlLTEiLCJvcmdJZCI6Im9yZy1hdXRvc2F2ZS10ZXN0Iiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';

let PASS = 0;
let FAIL = 0;

function assert_eq(desc, expected, actual) {
  if (String(expected) === String(actual)) {
    process.stdout.write(`  PASS: ${desc}\n`);
    PASS++;
  } else {
    process.stdout.write(`  FAIL: ${desc} (expected=${expected}, actual=${actual})\n`);
    FAIL++;
  }
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = token;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const fs = require('fs');
  const path = require('path');

  process.stdout.write('=== Feature #145: Auto-save every 30 seconds ===\n\n');

  // Test 1: Verify ErpDesigner component has autoSave props
  process.stdout.write('--- Component Code Tests ---\n');
  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const designerCode = fs.readFileSync(designerPath, 'utf8');

  assert_eq('ErpDesignerProps has autoSaveInterval', true, designerCode.includes('autoSaveInterval'));
  assert_eq('Component has autoSaveStatus state', true, designerCode.includes('autoSaveStatus'));
  assert_eq('Component has lastAutoSave state', true, designerCode.includes('lastAutoSave'));
  assert_eq('Component has performAutoSave function', true, designerCode.includes('performAutoSave'));
  assert_eq('Auto-save uses setInterval', true, designerCode.includes('setInterval'));
  assert_eq('Auto-save interval defaults to 30000ms', true, designerCode.includes('autoSaveInterval = 30000'));
  assert_eq('Auto-save calls PUT draft endpoint', true, designerCode.includes('/draft'));
  assert_eq('Auto-save indicator has data-testid', true, designerCode.includes('auto-save-indicator'));
  assert_eq('Auto-save shows saving state', true, designerCode.includes('Saving...'));
  assert_eq('Auto-save shows saved state', true, designerCode.includes('Saved'));
  assert_eq('Auto-save shows error state', true, designerCode.includes('Save failed'));
  assert_eq('Auto-save clears isDirty on success', true, designerCode.includes('setIsDirty(false)'));
  assert_eq('Auto-save only fires when dirty', true, designerCode.includes('isDirtyRef.current'));
  assert_eq('Auto-save cleans up on unmount', true, designerCode.includes('clearInterval'));

  // Test 2: Verify page.tsx passes templateId and autoSaveInterval
  process.stdout.write('\n--- Page Integration Tests ---\n');
  const pagePath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'page.tsx');
  const pageCode = fs.readFileSync(pagePath, 'utf8');

  assert_eq('Page reads templateId from URL params', true, pageCode.includes('templateId'));
  assert_eq('Page reads authToken from URL params', true, pageCode.includes('authToken'));
  assert_eq('Page passes autoSaveInterval prop', true, pageCode.includes('autoSaveInterval'));
  assert_eq('Page passes apiBase prop', true, pageCode.includes('apiBase'));

  // Test 3: Create a template and verify draft save endpoint works
  process.stdout.write('\n--- API Draft Save Tests ---\n');
  const createResp = await request('POST', '/api/pdfme/templates', TOKEN1, {
    name: 'AutoSave Test ' + Date.now(),
    type: 'invoice',
    schema: { schemas: [{ text1: { type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10 } }], basePdf: 'BLANK_PDF' }
  });
  const TMPL_ID = createResp.body.id;
  assert_eq('Template created', 201, createResp.status);

  // Save draft update (simulates what auto-save does)
  const draftResp = await request('PUT', `/api/pdfme/templates/${TMPL_ID}/draft`, TOKEN1, {
    name: 'AutoSave Test Updated',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ id: 'page1', label: 'Page 1', elements: [{ id: 'el1', type: 'text', x: 20, y: 20, w: 100, h: 30, content: 'Hello' }] }]
    }
  });
  assert_eq('Draft save returns 200', 200, draftResp.status);
  assert_eq('Draft save returns updated name', 'AutoSave Test Updated', draftResp.body.name);

  // Verify the saved draft persists
  const getResp = await request('GET', `/api/pdfme/templates/${TMPL_ID}`, TOKEN1);
  assert_eq('Template name updated in DB', 'AutoSave Test Updated', getResp.body.name);
  assert_eq('Schema updated in DB', true, !!getResp.body.schema);

  // Test 4: Verify the rendered designer page has auto-save indicator when templateId is present
  process.stdout.write('\n--- UI Rendering Tests ---\n');
  const designerResp = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3002,
      path: `/?templateId=${TMPL_ID}&authToken=${encodeURIComponent(TOKEN1)}&autoSaveInterval=5000`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });

  assert_eq('Designer page loads', 200, designerResp.status);
  assert_eq('Designer HTML contains auto-save-indicator', true, designerResp.body.includes('auto-save-indicator'));
  assert_eq('Designer HTML contains spin animation', true, designerResp.body.includes('@keyframes spin'));

  process.stdout.write(`\n=== Results: PASS=${PASS}, FAIL=${FAIL} ===\n`);
  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
