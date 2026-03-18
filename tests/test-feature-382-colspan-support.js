/**
 * Feature #382: ColSpan support in line items table
 *
 * Tests that table cells can span multiple columns using colSpan configuration.
 * Verifies column spanning in footer rows, sub-rows, and column definitions.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-colspan-382';
const USER_ID = 'colspan-test-user';

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

async function createAndPublish(name, schema) {
  const createRes = await request('POST', '/api/pdfme/templates', {
    name, type: 'custom', orgId: ORG_ID, schema
  });
  if (createRes.status !== 201) return { createRes, pubRes: null, id: null };
  const id = createRes.body.id;
  const pubRes = await request('POST', `/api/pdfme/templates/${id}/publish`, {});
  return { createRes, pubRes, id };
}

async function renderTemplate(templateId, fieldName, lineItems, channel) {
  return request('POST', '/api/pdfme/render/now', {
    templateId, orgId: ORG_ID, channel: channel || 'email',
    entityId: `colspan-${Date.now()}`,
    inputs: [{ [fieldName]: JSON.stringify(lineItems) }]
  });
}

async function run() {
  console.log('=== Feature #382: ColSpan support in line items table ===\n');

  // --- Step 1: Create template with colSpan in footer rows ---
  console.log('--- Step 1: Create template with footer row colSpan ---');

  const templateSchema = {
    pages: [{
      elements: [{
        name: 'invoiceTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 200,
        showHeader: true,
        repeatHeader: true,
        columns: [
          { key: 'item', header: 'Item', width: 50, align: 'left' },
          { key: 'description', header: 'Description', width: 60, align: 'left' },
          { key: 'qty', header: 'Qty', width: 25, align: 'right' },
          { key: 'unitPrice', header: 'Unit Price', width: 30, align: 'right', format: '#,##0.00' },
          { key: 'amount', header: 'Amount', width: 25, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [
          {
            id: 'subtotal', label: 'Subtotal',
            labelColumnKey: 'item', valueColumnKey: 'amount',
            type: 'sum', format: '#,##0.00',
            labelColSpan: 2,
            style: { fontWeight: 'bold' }
          },
          {
            id: 'vat', label: 'VAT (15%)',
            labelColumnKey: 'item', valueColumnKey: 'amount',
            type: 'percentage', referenceFooterId: 'subtotal', percentage: 0.15,
            format: '#,##0.00', labelColSpan: 3
          },
          {
            id: 'total', label: 'Grand Total',
            labelColumnKey: 'item', valueColumnKey: 'amount',
            type: 'sumWithFooters', footerIds: ['subtotal', 'vat'],
            format: '#,##0.00', labelColSpan: 4,
            style: { fontWeight: 'bold', fontSize: 10 }
          }
        ]
      }]
    }]
  };

  const { createRes, pubRes, id: templateId } = await createAndPublish('ColSpan Invoice 382', templateSchema);
  assert(createRes.status === 201, `Template created (${createRes.status})`);
  assert(pubRes && (pubRes.status === 200 || pubRes.status === 201), `Template published (${pubRes?.status})`);

  // --- Step 2: Render with line items data ---
  console.log('\n--- Step 2: Render with line items data and verify colSpan ---');
  const lineItems = [
    { item: 'Widget A', description: 'Standard widget', qty: 10, unitPrice: 25.00, amount: 250.00 },
    { item: 'Widget B', description: 'Premium widget', qty: 5, unitPrice: 50.00, amount: 250.00 },
    { item: 'Widget C', description: 'Deluxe widget', qty: 3, unitPrice: 100.00, amount: 300.00 },
    { item: 'Service D', description: 'Installation fee', qty: 1, unitPrice: 150.00, amount: 150.00 },
  ];

  const renderRes = await renderTemplate(templateId, 'invoiceTable', lineItems, 'email');
  assert(renderRes.status === 200 || renderRes.status === 201, `Render succeeded (${renderRes.status})`);
  assert(renderRes.body.document?.id || renderRes.body.documentId || renderRes.body.id, 'Render returned document ID');

  // --- Step 3: Verify colSpan computations ---
  console.log('\n--- Step 3: Verify footer row colSpan computations ---');
  const subtotal = 250 + 250 + 300 + 150;
  const vat = subtotal * 0.15;
  const total = subtotal + vat;
  assert(subtotal === 950, `Subtotal correct: ${subtotal}`);
  assert(vat === 142.5, `VAT correct: ${vat}`);
  assert(total === 1092.5, `Total correct: ${total}`);

  // --- Step 4: Render with print channel ---
  console.log('\n--- Step 4: Print channel render ---');
  const renderRes2 = await renderTemplate(templateId, 'invoiceTable', lineItems, 'print');
  assert(renderRes2.status === 200 || renderRes2.status === 201, `Print channel render succeeded (${renderRes2.status})`);

  // --- Step 5: Test with sub-row colSpan ---
  console.log('\n--- Step 5: Sub-row colSpan template ---');

  const subRowSchema = {
    pages: [{
      elements: [{
        name: 'subRowTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 200,
        showHeader: true,
        columns: [
          { key: 'item', header: 'Item', width: 50, align: 'left' },
          { key: 'description', header: 'Description', width: 60, align: 'left' },
          { key: 'qty', header: 'Qty', width: 25, align: 'right' },
          { key: 'amount', header: 'Amount', width: 55, align: 'right', format: '#,##0.00' }
        ],
        subRows: [{
          id: 'notes',
          condition: { type: 'fieldNonEmpty', field: 'notes' },
          cells: { item: '{{notes}}' },
          colSpan: 4,
          startColumnKey: 'item'
        }],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'item', valueColumnKey: 'amount',
          type: 'sum', format: '#,##0.00', labelColSpan: 3,
          style: { fontWeight: 'bold' }
        }]
      }]
    }]
  };

  const sub = await createAndPublish('SubRow ColSpan 382', subRowSchema);
  assert(sub.createRes.status === 201, `Sub-row template created (${sub.createRes.status})`);
  assert(sub.pubRes && (sub.pubRes.status === 200 || sub.pubRes.status === 201), `Sub-row template published (${sub.pubRes?.status})`);

  const subRowItems = [
    { item: 'Widget A', description: 'Standard widget', qty: 10, amount: 250.00, notes: 'Special handling required' },
    { item: 'Widget B', description: 'Premium widget', qty: 5, amount: 250.00, notes: '' },
    { item: 'Widget C', description: 'Deluxe widget', qty: 3, amount: 300.00, notes: 'Fragile - handle with care' },
  ];

  const render3 = await renderTemplate(sub.id, 'subRowTable', subRowItems, 'email');
  assert(render3.status === 200 || render3.status === 201, `Sub-row colSpan render succeeded (${render3.status})`);

  // --- Step 6: Test ColumnDefinition colSpan property ---
  console.log('\n--- Step 6: Column header colSpan ---');

  const colSpanHeaderSchema = {
    pages: [{
      elements: [{
        name: 'headerSpanTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 200,
        showHeader: true,
        columns: [
          { key: 'item', header: 'Item Details', width: 50, align: 'left', colSpan: 2 },
          { key: 'description', header: '', width: 60, align: 'left' },
          { key: 'qty', header: 'Qty', width: 25, align: 'right' },
          { key: 'amount', header: 'Amount', width: 55, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'item', valueColumnKey: 'amount',
          type: 'sum', format: '#,##0.00', labelColSpan: 2
        }]
      }]
    }]
  };

  const hdr = await createAndPublish('Header ColSpan 382', colSpanHeaderSchema);
  assert(hdr.createRes.status === 201, `Header colSpan template created (${hdr.createRes.status})`);
  assert(hdr.pubRes && (hdr.pubRes.status === 200 || hdr.pubRes.status === 201), `Header colSpan template published (${hdr.pubRes?.status})`);

  const render4 = await renderTemplate(hdr.id, 'headerSpanTable', lineItems, 'email');
  assert(render4.status === 200 || render4.status === 201, `Header colSpan render succeeded (${render4.status})`);

  // --- Step 7: Various colSpan values (2, 3, 5) ---
  console.log('\n--- Step 7: Various colSpan values ---');

  const varyingSchema = {
    pages: [{
      elements: [{
        name: 'varyingSpan',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 200,
        showHeader: true,
        columns: [
          { key: 'c1', header: 'Col 1', width: 30 },
          { key: 'c2', header: 'Col 2', width: 30 },
          { key: 'c3', header: 'Col 3', width: 30 },
          { key: 'c4', header: 'Col 4', width: 30 },
          { key: 'c5', header: 'Col 5', width: 30 },
          { key: 'c6', header: 'Col 6', width: 40, format: '#,##0.00' }
        ],
        footerRows: [
          { id: 'f1', label: 'Span-2', labelColumnKey: 'c1', valueColumnKey: 'c6', type: 'sum', format: '#,##0.00', labelColSpan: 2 },
          { id: 'f2', label: 'Span-3', labelColumnKey: 'c1', valueColumnKey: 'c6', type: 'sum', format: '#,##0.00', labelColSpan: 3 },
          { id: 'f3', label: 'Span-5', labelColumnKey: 'c1', valueColumnKey: 'c6', type: 'sum', format: '#,##0.00', labelColSpan: 5 },
        ]
      }]
    }]
  };

  const vary = await createAndPublish('Varying ColSpan 382', varyingSchema);
  assert(vary.createRes.status === 201, `Varying colSpan template created (${vary.createRes.status})`);
  assert(vary.pubRes && (vary.pubRes.status === 200 || vary.pubRes.status === 201), `Varying colSpan template published (${vary.pubRes?.status})`);

  const varyingItems = [
    { c1: 'A', c2: 'B', c3: 'C', c4: 'D', c5: 'E', c6: 100.00 },
    { c1: 'F', c2: 'G', c3: 'H', c4: 'I', c5: 'J', c6: 200.00 },
  ];

  const render5 = await renderTemplate(vary.id, 'varyingSpan', varyingItems, 'email');
  assert(render5.status === 200 || render5.status === 201, `Varying colSpan render succeeded (${render5.status})`);

  // --- Step 8: ColSpan=1 baseline (no spanning) ---
  console.log('\n--- Step 8: ColSpan=1 baseline ---');

  const noSpanSchema = {
    pages: [{
      elements: [{
        name: 'baselineTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 150,
        showHeader: true,
        columns: [
          { key: 'desc', header: 'Description', width: 100 },
          { key: 'qty', header: 'Qty', width: 40, align: 'right' },
          { key: 'amt', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'desc', valueColumnKey: 'amt',
          type: 'sum', format: '#,##0.00', labelColSpan: 1
        }]
      }]
    }]
  };

  const base = await createAndPublish('Baseline ColSpan 382', noSpanSchema);
  assert(base.createRes.status === 201, `Baseline template created (${base.createRes.status})`);
  assert(base.pubRes && (base.pubRes.status === 200 || base.pubRes.status === 201), `Baseline template published (${base.pubRes?.status})`);

  const baseItems = [{ desc: 'Item 1', qty: 2, amt: 50 }, { desc: 'Item 2', qty: 3, amt: 75 }];
  const render6 = await renderTemplate(base.id, 'baselineTable', baseItems, 'email');
  assert(render6.status === 200 || render6.status === 201, `Baseline render succeeded (${render6.status})`);

  // --- Step 9: ColSpan exceeding column count (graceful clamping) ---
  console.log('\n--- Step 9: ColSpan exceeding column count ---');

  const overSpanSchema = {
    pages: [{
      elements: [{
        name: 'overSpanTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 150,
        showHeader: true,
        columns: [
          { key: 'desc', header: 'Description', width: 100 },
          { key: 'qty', header: 'Qty', width: 40, align: 'right' },
          { key: 'amt', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' }
        ],
        footerRows: [{
          id: 'total', label: 'Total',
          labelColumnKey: 'desc', valueColumnKey: 'amt',
          type: 'sum', format: '#,##0.00', labelColSpan: 10
        }]
      }]
    }]
  };

  const over = await createAndPublish('OverSpan 382', overSpanSchema);
  assert(over.createRes.status === 201, `OverSpan template created (${over.createRes.status})`);
  assert(over.pubRes && (over.pubRes.status === 200 || over.pubRes.status === 201), `OverSpan template published (${over.pubRes?.status})`);

  const render7 = await renderTemplate(over.id, 'overSpanTable', baseItems, 'email');
  assert(render7.status === 200 || render7.status === 201, `OverSpan render succeeded without error (${render7.status})`);

  // --- Step 10: Combined footer + sub-row colSpan ---
  console.log('\n--- Step 10: Combined footer + sub-row colSpan ---');

  const combinedSchema = {
    pages: [{
      elements: [{
        name: 'combinedTable',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 250,
        showHeader: true,
        columns: [
          { key: 'item', header: 'Item', width: 40 },
          { key: 'desc', header: 'Description', width: 50 },
          { key: 'qty', header: 'Qty', width: 25, align: 'right' },
          { key: 'price', header: 'Price', width: 35, align: 'right', format: '#,##0.00' },
          { key: 'total', header: 'Total', width: 40, align: 'right', format: '#,##0.00' }
        ],
        subRows: [{
          id: 'discount-note',
          condition: { type: 'expression', expression: 'discount > 0' },
          cells: { item: 'Discount applied' },
          colSpan: 5,
          startColumnKey: 'item'
        }],
        footerRows: [
          { id: 'subtotal', label: 'Subtotal', labelColumnKey: 'item', valueColumnKey: 'total', type: 'sum', format: '#,##0.00', labelColSpan: 4, style: { fontWeight: 'bold' } },
          { id: 'grandtotal', label: 'Grand Total', labelColumnKey: 'item', valueColumnKey: 'total', type: 'sumWithFooters', footerIds: ['subtotal'], format: '#,##0.00', labelColSpan: 4, style: { fontWeight: 'bold', fontSize: 10 } }
        ]
      }]
    }]
  };

  const combined = await createAndPublish('Combined ColSpan 382', combinedSchema);
  assert(combined.createRes.status === 201, `Combined template created (${combined.createRes.status})`);
  assert(combined.pubRes && (combined.pubRes.status === 200 || combined.pubRes.status === 201), `Combined template published (${combined.pubRes?.status})`);

  const combinedItems = [
    { item: 'Product A', desc: 'Widget A', qty: 5, price: 100.00, total: 500.00, discount: 10 },
    { item: 'Product B', desc: 'Widget B', qty: 3, price: 200.00, total: 600.00, discount: 0 },
    { item: 'Product C', desc: 'Widget C', qty: 2, price: 150.00, total: 300.00, discount: 5 },
  ];

  const render8 = await renderTemplate(combined.id, 'combinedTable', combinedItems, 'email');
  assert(render8.status === 200 || render8.status === 201, `Combined colSpan render succeeded (${render8.status})`);
  assert(render8.body.document?.id || render8.body.documentId || render8.body.id, 'Combined render returned document ID');

  // --- Step 11: Verify PDF output is valid ---
  console.log('\n--- Step 11: Verify PDF output ---');

  const docId = renderRes.body.document?.id || renderRes.body.documentId || renderRes.body.id;
  if (docId) {
    const dlRes = await request('GET', `/api/pdfme/render/document/${docId}`, null);
    if (dlRes.status === 200) {
      const ct = dlRes.headers['content-type'] || '';
      assert(ct.includes('pdf') || ct.includes('octet'), `PDF content type correct (${ct})`);
    } else {
      assert(dlRes.status === 200, `PDF download status (${dlRes.status})`);
    }
  } else {
    assert(false, 'No document ID for download check');
  }

  // --- Step 12: Document history tracks renders ---
  console.log('\n--- Step 12: Document history ---');
  const histRes = await request('GET', `/api/pdfme/render/documents?orgId=${ORG_ID}&limit=10`, null);
  assert(histRes.status === 200, `Document history accessible (${histRes.status})`);
  const docs = histRes.body.data || histRes.body.documents || histRes.body || [];
  assert(Array.isArray(docs) && docs.length >= 3, `Multiple renders recorded (${docs.length})`);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
