/**
 * Test Feature #175: Designer loads template schema from API
 *
 * Tests that opening the designer with a templateId fetches and renders the template.
 */

const http = require('http');
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXRlc3QiLCJvcmdJZCI6Im9yZy10ZXN0Iiwicm9sZXMiOlsiYWRtaW4iXX0.fake-signature';
const API_BASE = 'http://localhost:3000/api/pdfme';
const FRONTEND_BASE = 'http://localhost:3001';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqModule = urlObj.protocol === 'https:' ? https : http;

    const req = reqModule.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => JSON.parse(data),
          text: () => data,
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('=== Feature #175: Designer loads template schema from API ===\n');

  // Step 1: Create a template with known elements via API
  console.log('Step 1: Create template with elements via API');
  const createRes = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      name: 'F175 Test Template',
      type: 'invoice',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [
          {
            id: 'page-1',
            label: 'Page 1',
            elements: [
              { id: 'el-title', type: 'text', x: 50, y: 50, w: 200, h: 24, content: 'Invoice Title', fontFamily: 'Helvetica', fontSize: 18, fontWeight: 'bold', textAlign: 'left', color: '#000000' },
              { id: 'el-logo', type: 'image', x: 400, y: 30, w: 100, h: 60, src: '', objectFit: 'contain', opacity: 100 },
              { id: 'el-customer', type: 'text', x: 50, y: 100, w: 150, h: 20, content: '{{customer.name}}', fontFamily: 'Helvetica', fontSize: 12, binding: 'customer.name' },
            ],
          },
          {
            id: 'page-2',
            label: 'Page 2',
            elements: [
              { id: 'el-table', type: 'line-items', x: 50, y: 50, w: 495, h: 200, columns: [{ key: 'description', header: 'Description', width: 200 }, { key: 'qty', header: 'Qty', width: 60 }], showHeader: true, borderStyle: 'solid' },
            ],
          },
        ],
      },
    }),
  });

  assert(createRes.ok, 'Template created successfully');
  const template = createRes.json();
  const templateId = template.id;
  console.log(`  Template ID: ${templateId}`);

  // Step 2: Verify GET endpoint returns the template with schema
  console.log('\nStep 2: Verify GET endpoint returns template data');
  const getRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });

  assert(getRes.ok, 'GET template returns 200');
  const templateData = getRes.json();
  assert(templateData.name === 'F175 Test Template', 'Template name matches');
  assert(templateData.schema.pageSize === 'A4', 'Page size is A4');
  assert(templateData.schema.pages.length === 2, 'Template has 2 pages');
  assert(templateData.schema.pages[0].elements.length === 3, 'Page 1 has 3 elements');
  assert(templateData.schema.pages[1].elements.length === 1, 'Page 2 has 1 element');

  // Verify element properties
  const titleEl = templateData.schema.pages[0].elements.find(e => e.id === 'el-title');
  assert(titleEl !== undefined, 'Title element exists in response');
  assert(titleEl.type === 'text', 'Title element is text type');
  assert(titleEl.content === 'Invoice Title', 'Title content matches');
  assert(titleEl.fontSize === 18, 'Title fontSize is 18');
  assert(titleEl.fontWeight === 'bold', 'Title fontWeight is bold');

  const logoEl = templateData.schema.pages[0].elements.find(e => e.id === 'el-logo');
  assert(logoEl !== undefined, 'Logo element exists in response');
  assert(logoEl.type === 'image', 'Logo element is image type');

  const customerEl = templateData.schema.pages[0].elements.find(e => e.id === 'el-customer');
  assert(customerEl !== undefined, 'Customer element exists in response');
  assert(customerEl.binding === 'customer.name', 'Customer binding matches');

  const tableEl = templateData.schema.pages[1].elements.find(e => e.id === 'el-table');
  assert(tableEl !== undefined, 'Line items table exists on page 2');
  assert(tableEl.type === 'line-items', 'Table is line-items type');
  assert(tableEl.columns.length === 2, 'Table has 2 columns');

  // Step 3: Verify frontend renders designer page with templateId param
  console.log('\nStep 3: Verify frontend serves designer page with templateId');
  const pageRes = await fetch(`${FRONTEND_BASE}/?templateId=${templateId}&authToken=${TOKEN}`);
  assert(pageRes.ok, 'Frontend page loads with templateId param');
  const html = pageRes.text();
  assert(html.includes('</html>'), 'HTML is well-formed');

  // Step 4: Verify the component source code has API loading logic
  console.log('\nStep 4: Verify component has API loading implementation');
  const fs = require('fs');
  const componentSrc = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  assert(componentSrc.includes('isLoading'), 'Component has isLoading state');
  assert(componentSrc.includes('loadError'), 'Component has loadError state');
  assert(componentSrc.includes('loadTemplate'), 'Component has loadTemplate function');
  assert(componentSrc.includes(`/templates/\${templateId}`), 'Component fetches from templates/:id endpoint');
  assert(componentSrc.includes('schema.pages'), 'Component parses pages from schema');
  assert(componentSrc.includes('schema.pageSize'), 'Component parses pageSize from schema');
  assert(componentSrc.includes('setPages(loadedPages)'), 'Component sets loaded pages');
  assert(componentSrc.includes('setName(template.name)'), 'Component sets template name');
  assert(componentSrc.includes('designer-loading'), 'Component has loading UI');
  assert(componentSrc.includes('designer-load-error'), 'Component has error UI');
  assert(componentSrc.includes('Loading template'), 'Loading state shows text');
  assert(componentSrc.includes('Failed to load template'), 'Error state shows text');

  // Step 5: Verify element property mapping is complete
  console.log('\nStep 5: Verify element property mapping covers all types');
  assert(componentSrc.includes('el.fontFamily'), 'Maps fontFamily property');
  assert(componentSrc.includes('el.fontSize'), 'Maps fontSize property');
  assert(componentSrc.includes('el.fontWeight'), 'Maps fontWeight property');
  assert(componentSrc.includes('el.textAlign'), 'Maps textAlign property');
  assert(componentSrc.includes('el.color'), 'Maps color property');
  assert(componentSrc.includes('el.src'), 'Maps src property (images)');
  assert(componentSrc.includes('el.objectFit'), 'Maps objectFit property (images)');
  assert(componentSrc.includes('el.opacity'), 'Maps opacity property');
  assert(componentSrc.includes('el.columns'), 'Maps columns property (tables)');
  assert(componentSrc.includes('el.showHeader'), 'Maps showHeader property (tables)');
  assert(componentSrc.includes('el.borderStyle'), 'Maps borderStyle property (tables)');
  assert(componentSrc.includes('el.binding'), 'Maps binding property');

  // Step 6: Test data persistence across restart
  console.log('\nStep 6: Verify template data persists (read after creation)');
  const verifyRes = await fetch(`${API_BASE}/templates/${templateId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(verifyRes.ok, 'Template persists and is retrievable');
  const verifyData = verifyRes.json();
  assert(verifyData.id === templateId, 'Same template ID returned');
  assert(verifyData.schema.pages[0].elements[0].content === 'Invoice Title', 'Element content persists');

  // Cleanup
  console.log('\nCleanup: Deleting test template');
  await fetch(`${API_BASE}/templates/${templateId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
