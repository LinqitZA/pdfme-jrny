/**
 * Feature #384: maxRowsPerPage supports first/middle/last config
 *
 * Tests that different row limits can be configured per page position:
 * - first page: limited rows (e.g., 5 - due to header/address area)
 * - middle pages: more rows (e.g., 10 - full page utilization)
 * - last page: adjusted rows (e.g., 8 - room for footer/totals)
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-maxrows-384';
const USER_ID = 'maxrows-test-user';

function makeJwt() {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: USER_ID, orgId: ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeJwt();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

function generateLineItems(count) {
  const items = [];
  for (let i = 1; i <= count; i++) {
    items.push({
      item: `Item ${String(i).padStart(3, '0')}`,
      description: `Description for item ${i}`,
      qty: Math.ceil(Math.random() * 10),
      unitPrice: (10 + Math.random() * 90).toFixed(2),
      amount: (10 + Math.random() * 500).toFixed(2),
    });
  }
  return items;
}

async function createAndPublish(name, schema) {
  const createRes = await request('POST', '/api/pdfme/templates', {
    name, type: 'custom', orgId: ORG_ID, schema
  });
  if (createRes.status !== 201) {
    console.log('  Create error:', JSON.stringify(createRes.body).substring(0, 200));
    return { createRes, pubRes: null, id: null };
  }
  const id = createRes.body.id;
  const pubRes = await request('POST', `/api/pdfme/templates/${id}/publish`, {});
  return { createRes, pubRes, id };
}

async function renderTemplate(templateId, fieldName, lineItems) {
  return request('POST', '/api/pdfme/render/now', {
    templateId, orgId: ORG_ID, channel: 'email',
    entityId: `maxrows-${Date.now()}`,
    inputs: [{ [fieldName]: JSON.stringify(lineItems) }]
  });
}

// Verify maxRowsPerPage config through template schema storage and retrieval
async function testSchemaStorage() {
  console.log('--- Schema storage tests ---');

  // Create template with maxRowsPerPage object config
  const schema = {
    pages: [{
      elements: [{
        name: 'testMaxRows',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 150,
        height: 200,
        showHeader: true,
        maxRowsPerPage: { first: 5, middle: 10, last: 8 },
        columns: [
          { key: 'item', header: 'Item', width: 80 },
          { key: 'qty', header: 'Qty', width: 30, align: 'right' },
          { key: 'amt', header: 'Amount', width: 40, align: 'right', format: '#,##0.00' },
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'item', valueColumnKey: 'amt',
          type: 'sum', format: '#,##0.00'
        }]
      }]
    }]
  };

  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'MaxRows Schema Storage 384',
    type: 'custom', orgId: ORG_ID, schema
  });
  assert(createRes.status === 201, `Schema storage template created (${createRes.status})`);

  // Retrieve and verify maxRowsPerPage persisted correctly
  const getRes = await request('GET', `/api/pdfme/templates/${createRes.body.id}?orgId=${ORG_ID}`);
  assert(getRes.status === 200, `Template retrieved (${getRes.status})`);

  const storedSchema = getRes.body.schema || getRes.body;
  const pages = storedSchema.pages || [];
  const elements = pages[0]?.elements || [];
  const tableEl = elements.find(e => e.name === 'testMaxRows');

  assert(tableEl, 'Table element found in retrieved schema');
  if (tableEl) {
    const mrp = tableEl.maxRowsPerPage;
    assert(typeof mrp === 'object' && !Array.isArray(mrp), 'maxRowsPerPage is object');
    assert(mrp.first === 5, `maxRowsPerPage.first = 5 (${mrp.first})`);
    assert(mrp.middle === 10, `maxRowsPerPage.middle = 10 (${mrp.middle})`);
    assert(mrp.last === 8, `maxRowsPerPage.last = 8 (${mrp.last})`);
  }

  // Publish and render to verify the config is used
  const pubRes = await request('POST', `/api/pdfme/templates/${createRes.body.id}/publish`, {});
  assert(pubRes.status === 200 || pubRes.status === 201, `Schema storage template published (${pubRes?.status})`);

  const items = [];
  for (let i = 1; i <= 30; i++) {
    items.push({ item: `Item ${i}`, qty: i, amt: i * 10 });
  }

  const renderRes = await renderTemplate(createRes.body.id, 'testMaxRows', items);
  assert(renderRes.status === 200 || renderRes.status === 201, `Render with stored schema succeeded (${renderRes.status})`);
}

async function run() {
  console.log('=== Feature #384: maxRowsPerPage supports first/middle/last config ===\n');

  // --- Schema storage and retrieval tests ---
  console.log('--- Part 1: Schema storage tests ---');

  try {
    await testSchemaStorage();
  } catch (err) {
    console.log(`  ❌ Schema test error: ${err.message}`);
    failed++;
  }

  // --- Part 2: Integration tests via API ---
  console.log('\n--- Part 2: API integration tests ---\n');

  // Step 1: Create template with first/middle/last maxRowsPerPage
  console.log('--- Step 1: Create template with first:5, middle:10, last:8 ---');

  const schema = {
    pages: [{
      elements: [{
        name: 'paginatedTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 250,
        showHeader: true,
        repeatHeader: true,
        maxRowsPerPage: { first: 5, middle: 10, last: 8 },
        columns: [
          { key: 'item', header: 'Item', width: 70, align: 'left' },
          { key: 'description', header: 'Description', width: 60, align: 'left' },
          { key: 'qty', header: 'Qty', width: 20, align: 'right' },
          { key: 'unitPrice', header: 'Unit Price', width: 20, align: 'right', format: '#,##0.00' },
          { key: 'amount', header: 'Amount', width: 20, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'item', valueColumnKey: 'amount',
          type: 'sum', format: '#,##0.00', labelColSpan: 4,
          style: { fontWeight: 'bold' }
        }]
      }]
    }]
  };

  const { createRes, pubRes, id: templateId } = await createAndPublish('MaxRows First/Mid/Last 384', schema);
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  assert(pubRes && (pubRes.status === 200 || pubRes.status === 201), `Template published (${pubRes?.status})`);

  // Step 2: Render with 30 line items
  console.log('\n--- Step 2: Render with 30 line items ---');
  const lineItems30 = generateLineItems(30);
  const render1 = await renderTemplate(templateId, 'paginatedTable', lineItems30);
  assert(render1.status === 200 || render1.status === 201, `Render with 30 items succeeded (${render1.status})`);
  assert(render1.body.document?.id, 'Render returned document');

  // Step 3: Render with 5 items (single page - all fit on first)
  console.log('\n--- Step 3: Render with 5 items (single page) ---');
  const lineItems5 = generateLineItems(5);
  const render2 = await renderTemplate(templateId, 'paginatedTable', lineItems5);
  assert(render2.status === 200 || render2.status === 201, `Render with 5 items succeeded (${render2.status})`);

  // Step 4: Render with 15 items (exactly first + middle)
  console.log('\n--- Step 4: Render with 15 items (first + middle) ---');
  const lineItems15 = generateLineItems(15);
  const render3 = await renderTemplate(templateId, 'paginatedTable', lineItems15);
  assert(render3.status === 200 || render3.status === 201, `Render with 15 items succeeded (${render3.status})`);

  // Step 5: Render with uniform maxRowsPerPage (number)
  console.log('\n--- Step 5: Render with uniform maxRowsPerPage ---');
  const uniformSchema = {
    pages: [{
      elements: [{
        name: 'uniformTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 250,
        showHeader: true,
        maxRowsPerPage: 8,
        columns: [
          { key: 'item', header: 'Item', width: 100 },
          { key: 'qty', header: 'Qty', width: 40, align: 'right' },
          { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'item', valueColumnKey: 'amount',
          type: 'sum', format: '#,##0.00'
        }]
      }]
    }]
  };

  const uniform = await createAndPublish('Uniform MaxRows 384', uniformSchema);
  assert(uniform.createRes.status === 201, `Uniform template created (${uniform.createRes.status})`);
  assert(uniform.pubRes && (uniform.pubRes.status === 200 || uniform.pubRes.status === 201), `Uniform template published (${uniform.pubRes?.status})`);

  const render4 = await renderTemplate(uniform.id, 'uniformTable', generateLineItems(25));
  assert(render4.status === 200 || render4.status === 201, `Uniform maxRows render succeeded (${render4.status})`);

  // Step 6: Render with large dataset (50 items)
  console.log('\n--- Step 6: Render with 50 items ---');
  const lineItems50 = generateLineItems(50);
  const render5 = await renderTemplate(templateId, 'paginatedTable', lineItems50);
  assert(render5.status === 200 || render5.status === 201, `Render with 50 items succeeded (${render5.status})`);

  // Step 7: Download and verify PDF
  console.log('\n--- Step 7: Verify PDF output ---');
  const docId = render1.body.document?.id;
  if (docId) {
    const dlRes = await request('GET', `/api/pdfme/render/document/${docId}`, null);
    assert(dlRes.status === 200, `PDF download succeeded (${dlRes.status})`);
    const ct = dlRes.headers['content-type'] || '';
    assert(ct.includes('pdf'), `Content-Type is PDF (${ct})`);
  }

  // Step 8: Edge case - maxRowsPerPage with first=1
  console.log('\n--- Step 8: Edge case - first=1 ---');
  const edgeSchema = {
    pages: [{
      elements: [{
        name: 'edgeTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 250,
        showHeader: true,
        maxRowsPerPage: { first: 1, middle: 5, last: 3 },
        columns: [
          { key: 'item', header: 'Item', width: 100 },
          { key: 'amount', header: 'Amount', width: 90, align: 'right', format: '#,##0.00' }
        ]
      }]
    }]
  };

  const edge = await createAndPublish('Edge MaxRows 384', edgeSchema);
  assert(edge.createRes.status === 201, `Edge case template created (${edge.createRes.status})`);
  assert(edge.pubRes && (edge.pubRes.status === 200 || edge.pubRes.status === 201), `Edge case template published (${edge.pubRes?.status})`);

  const render6 = await renderTemplate(edge.id, 'edgeTable', generateLineItems(12));
  assert(render6.status === 200 || render6.status === 201, `Edge case render succeeded (${render6.status})`);

  // Step 9: Both channels work
  console.log('\n--- Step 9: Both channels ---');
  const renderPrint = await request('POST', '/api/pdfme/render/now', {
    templateId, orgId: ORG_ID, channel: 'print',
    entityId: `maxrows-print-${Date.now()}`,
    inputs: [{ paginatedTable: JSON.stringify(lineItems30) }]
  });
  assert(renderPrint.status === 200 || renderPrint.status === 201, `Print channel render succeeded (${renderPrint.status})`);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
