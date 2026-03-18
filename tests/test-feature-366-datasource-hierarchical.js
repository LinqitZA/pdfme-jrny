const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('ds-user-366', 'org-ds-366');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
let total = 0;

function assert(name, condition, detail) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write('PASS: ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('FAIL: ' + name + (detail ? ' - ' + detail : '') + '\n');
  }
}

// Hierarchical invoice data with grouped line items
const HIERARCHICAL_INVOICE_DATA = {
  // Top-level invoice fields
  invoiceNumber: 'INV-2026-0042',
  customerName: 'Acme Industries',
  customerAddress: '789 Enterprise Blvd, Suite 100',
  invoiceDate: '2026-03-18',
  dueDate: '2026-04-17',
  currency: 'USD',

  // Grouped line items (by category)
  lineItems: [
    { category: 'Hardware', item: 'Server Rack', qty: 2, unitPrice: 1500.00, total: 3000.00 },
    { category: 'Hardware', item: 'Network Switch', qty: 5, unitPrice: 400.00, total: 2000.00 },
    { category: 'Hardware', item: 'UPS Battery', qty: 3, unitPrice: 250.00, total: 750.00 },
    { category: 'Software', item: 'OS License', qty: 10, unitPrice: 200.00, total: 2000.00 },
    { category: 'Software', item: 'Monitoring Tool', qty: 1, unitPrice: 500.00, total: 500.00 },
    { category: 'Services', item: 'Installation', qty: 1, unitPrice: 2000.00, total: 2000.00 },
    { category: 'Services', item: 'Configuration', qty: 20, unitPrice: 150.00, total: 3000.00 },
    { category: 'Services', item: 'Training', qty: 5, unitPrice: 300.00, total: 1500.00 },
  ],

  // Computed totals
  subtotal: 14750.00,
  taxRate: 0.08,
  taxAmount: 1180.00,
  grandTotal: 15930.00,
};

// Flatten to DataSource format (array of single record with string values)
function flattenForDataSource(data) {
  const flat = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'lineItems') continue; // Skip nested array
    flat[key] = String(value);
  }
  return flat;
}

async function run() {
  process.stdout.write('=== Feature #366: DataSource resolves complex hierarchical data ===\n\n');

  // Step 1: Register a test DataSource with hierarchical invoice data
  process.stdout.write('Registering test DataSource with hierarchical data...\n');

  const flatData = flattenForDataSource(HIERARCHICAL_INVOICE_DATA);
  const regRes = await request('POST', '/datasources/custom/register-test', {
    sampleData: [flatData]
  });

  assert('DataSource registered', regRes.status === 200 || regRes.status === 201,
    'status=' + regRes.status);
  assert('DataSource type is custom', regRes.body.templateType === 'custom',
    'type=' + regRes.body.templateType);

  // Step 2: Verify DataSource is listed
  const listRes = await request('GET', '/datasources', null);
  assert('DataSources list includes our type',
    listRes.body.types && listRes.body.types.includes('custom'),
    'types=' + JSON.stringify(listRes.body.types));

  // Step 3: Resolve data directly to verify it works
  const resolveRes = await request('POST', '/datasources/custom/resolve', {
    entityId: 'INV-2026-0042'
  });

  assert('DataSource resolve succeeds', resolveRes.status === 200 || resolveRes.status === 201,
    'status=' + resolveRes.status);
  assert('Resolved data includes invoice number',
    resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].invoiceNumber === 'INV-2026-0042',
    'invoiceNumber=' + (resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].invoiceNumber));
  assert('Resolved data includes customer name',
    resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].customerName === 'Acme Industries',
    'customerName=' + (resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].customerName));
  assert('Resolved data includes grand total',
    resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].grandTotal === '15930',
    'grandTotal=' + (resolveRes.body.data && resolveRes.body.data[0] && resolveRes.body.data[0].grandTotal));

  // Step 4: Create template matching the DataSource fields
  process.stdout.write('\nCreating template with DataSource field bindings...\n');

  const templateRes = await request('POST', '/templates', {
    name: 'HierarchicalInvoice-366',
    type: 'custom',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{
        elements: [
          { name: 'invoiceNumber', type: 'text', position: { x: 20, y: 10 }, width: 80, height: 12, content: '' },
          { name: 'customerName', type: 'text', position: { x: 20, y: 25 }, width: 100, height: 10, content: '' },
          { name: 'customerAddress', type: 'text', position: { x: 20, y: 37 }, width: 100, height: 10, content: '' },
          { name: 'invoiceDate', type: 'text', position: { x: 130, y: 10 }, width: 60, height: 10, content: '' },
          { name: 'dueDate', type: 'text', position: { x: 130, y: 22 }, width: 60, height: 10, content: '' },
          { name: 'currency', type: 'text', position: { x: 130, y: 34 }, width: 30, height: 10, content: '' },
          { name: 'subtotal', type: 'text', position: { x: 130, y: 200 }, width: 60, height: 10, content: '' },
          { name: 'taxRate', type: 'text', position: { x: 130, y: 212 }, width: 60, height: 10, content: '' },
          { name: 'taxAmount', type: 'text', position: { x: 130, y: 224 }, width: 60, height: 10, content: '' },
          { name: 'grandTotal', type: 'text', position: { x: 130, y: 240 }, width: 60, height: 12, content: '' },
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Template created', templateRes.status === 201, 'status=' + templateRes.status);
  const templateId = templateRes.body && templateRes.body.id;

  if (!templateId) {
    process.stdout.write('Cannot continue. Response: ' + JSON.stringify(templateRes.body).substring(0, 300) + '\n');
    process.exit(1);
  }

  // Publish
  const publishRes = await request('POST', '/templates/' + templateId + '/publish', {});
  assert('Template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Step 5: Render using DataSource auto-resolution (no inputs provided)
  process.stdout.write('\nRendering with DataSource auto-resolution...\n');
  const renderRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-2026-0042',
    channel: 'email'
  });

  assert('Render with DataSource succeeds', renderRes.status === 200 || renderRes.status === 201,
    'status=' + renderRes.status + ', body=' + JSON.stringify(renderRes.body).substring(0, 300));

  if (renderRes.status === 200 || renderRes.status === 201) {
    const doc = renderRes.body.document || renderRes.body;
    assert('Document status is done', doc.status === 'done', 'status=' + doc.status);
    assert('No error message', !doc.errorMessage, 'error=' + doc.errorMessage);
    assert('File path generated', !!doc.filePath, 'filePath=' + doc.filePath);
  }

  // Step 6: Test grouped table render with hierarchical line items
  process.stdout.write('\nRendering grouped table with hierarchical data...\n');

  const groupedRes = await request('POST', '/grouped-table/render', {
    columns: [
      { header: 'Category', key: 'category', width: 40 },
      { header: 'Item', key: 'item', width: 60 },
      { header: 'Qty', key: 'qty', width: 20, align: 'right' },
      { header: 'Unit Price', key: 'unitPrice', width: 35, align: 'right' },
      { header: 'Total', key: 'total', width: 35, align: 'right', aggregation: 'SUM' }
    ],
    groupBy: ['category'],
    data: HIERARCHICAL_INVOICE_DATA.lineItems,
    showGroupHeaders: true,
    showGroupFooters: true,
    showGrandTotal: true
  });

  assert('Grouped table render succeeds', groupedRes.status === 200 || groupedRes.status === 201,
    'status=' + groupedRes.status);

  if (groupedRes.status === 200 || groupedRes.status === 201) {
    const rows = groupedRes.body.rows;
    assert('Rows array returned', Array.isArray(rows) && rows.length > 0,
      'rows count=' + (rows ? rows.length : 0));

    // Verify group structure: should have group headers and footers
    const summary = groupedRes.body.summary;
    assert('Summary returned', !!summary, 'summary=' + JSON.stringify(summary));

    if (summary) {
      // getSummary returns: totalRows, groupLevels, groupCounts, grandTotals
      assert('8 total data rows', summary.totalRows === 8,
        'totalRows=' + summary.totalRows);
      assert('1 group level', summary.groupLevels === 1,
        'groupLevels=' + summary.groupLevels);
      assert('3 groups in category level',
        summary.groupCounts && summary.groupCounts.category === 3,
        'groupCounts=' + JSON.stringify(summary.groupCounts));
      assert('Grand total for "total" column calculated',
        summary.grandTotals && typeof summary.grandTotals.total === 'number' && summary.grandTotals.total > 0,
        'grandTotals=' + JSON.stringify(summary.grandTotals));
      // Hardware: 3000+2000+750=5750, Software: 2000+500=2500, Services: 2000+3000+1500=6500 = 14750
      assert('Grand total equals 14750',
        summary.grandTotals && summary.grandTotals.total === 14750,
        'grandTotal.total=' + (summary.grandTotals && summary.grandTotals.total));
    }

    // Verify tree structure
    const tree = groupedRes.body.tree;
    assert('Group tree returned', !!tree && Array.isArray(tree),
      'tree=' + (tree ? 'array' : typeof tree));

    if (tree) {
      // GroupNode has: key (field name), value (group value), level, rows, children, subtotals
      const groupValues = tree.map(g => g.value);
      assert('Hardware group present', groupValues.includes('Hardware'),
        'groups=' + JSON.stringify(groupValues));
      assert('Software group present', groupValues.includes('Software'),
        'groups=' + JSON.stringify(groupValues));
      assert('Services group present', groupValues.includes('Services'),
        'groups=' + JSON.stringify(groupValues));

      // Verify subtotals per group
      const hwGroup = tree.find(g => g.value === 'Hardware');
      assert('Hardware subtotal is 5750',
        hwGroup && hwGroup.subtotals && hwGroup.subtotals.total === 5750,
        'hwSubtotal=' + (hwGroup && hwGroup.subtotals && hwGroup.subtotals.total));

      const swGroup = tree.find(g => g.value === 'Software');
      assert('Software subtotal is 2500',
        swGroup && swGroup.subtotals && swGroup.subtotals.total === 2500,
        'swSubtotal=' + (swGroup && swGroup.subtotals && swGroup.subtotals.total));

      const svcGroup = tree.find(g => g.value === 'Services');
      assert('Services subtotal is 6500',
        svcGroup && svcGroup.subtotals && svcGroup.subtotals.total === 6500,
        'svcSubtotal=' + (svcGroup && svcGroup.subtotals && svcGroup.subtotals.total));
    }

    // Verify tableData for pdfme (array of arrays for table plugin)
    const tableData = groupedRes.body.tableData;
    assert('Table data returned', Array.isArray(tableData) && tableData.length > 0,
      'tableData rows=' + (tableData ? tableData.length : 0));
  }

  // Step 7: Render grouped table to PDF
  process.stdout.write('\nRendering grouped table to PDF...\n');

  const pdfRes = await request('POST', '/grouped-table/pdf', {
    columns: [
      { header: 'Category', key: 'category', width: 40 },
      { header: 'Item', key: 'item', width: 60 },
      { header: 'Qty', key: 'qty', width: 20, align: 'right' },
      { header: 'Unit Price', key: 'unitPrice', width: 35, align: 'right' },
      { header: 'Total', key: 'total', width: 35, align: 'right', aggregation: 'SUM' }
    ],
    groupBy: ['category'],
    data: HIERARCHICAL_INVOICE_DATA.lineItems,
    showGroupHeaders: true,
    showGroupFooters: true,
    showGrandTotal: true,
    title: 'Invoice INV-2026-0042 Line Items'
  });

  assert('Grouped table PDF render succeeds', pdfRes.status === 200 || pdfRes.status === 201,
    'status=' + pdfRes.status + ', body=' + JSON.stringify(pdfRes.body).substring(0, 300));

  if (pdfRes.status === 200 || pdfRes.status === 201) {
    const doc = pdfRes.body.document;
    assert('PDF document created', !!doc && !!doc.id, 'doc=' + JSON.stringify(doc).substring(0, 200));
    assert('PDF status is done', doc && doc.status === 'done', 'status=' + (doc && doc.status));
    assert('PDF file path generated', doc && !!doc.filePath, 'filePath=' + (doc && doc.filePath));

    // Verify summary is returned with the PDF
    const pdfSummary = pdfRes.body.summary;
    assert('PDF response includes summary', !!pdfSummary, 'summary present');
  }

  // Step 8: Test multi-level grouping (2 levels)
  process.stdout.write('\nTesting 2-level grouping...\n');

  const twoLevelData = [
    { region: 'North', category: 'Hardware', item: 'Server', total: 3000 },
    { region: 'North', category: 'Hardware', item: 'Switch', total: 2000 },
    { region: 'North', category: 'Software', item: 'License', total: 1000 },
    { region: 'South', category: 'Hardware', item: 'Router', total: 1500 },
    { region: 'South', category: 'Services', item: 'Install', total: 2500 },
    { region: 'South', category: 'Services', item: 'Support', total: 800 },
  ];

  const twoLevelRes = await request('POST', '/grouped-table/render', {
    columns: [
      { header: 'Region', key: 'region', width: 30 },
      { header: 'Category', key: 'category', width: 40 },
      { header: 'Item', key: 'item', width: 60 },
      { header: 'Total', key: 'total', width: 40, align: 'right', aggregation: 'SUM' }
    ],
    groupBy: ['region', 'category'],
    data: twoLevelData,
    showGroupHeaders: true,
    showGroupFooters: true,
    showGrandTotal: true
  });

  assert('2-level grouping succeeds', twoLevelRes.status === 200 || twoLevelRes.status === 201,
    'status=' + twoLevelRes.status);

  if (twoLevelRes.status === 200 || twoLevelRes.status === 201) {
    const summary2 = twoLevelRes.body.summary;
    assert('2-level summary returned', !!summary2, 'summary exists');
    assert('2-level has 6 total rows', summary2 && summary2.totalRows === 6,
      'totalRows=' + (summary2 && summary2.totalRows));
    assert('2-level has 2 group levels', summary2 && summary2.groupLevels === 2,
      'groupLevels=' + (summary2 && summary2.groupLevels));
    // Verify grand total: 3000+2000+1000+1500+2500+800 = 10800
    assert('2-level grand total is 10800',
      summary2 && summary2.grandTotals && summary2.grandTotals.total === 10800,
      'grandTotal=' + (summary2 && summary2.grandTotals && summary2.grandTotals.total));
  }

  // Step 9: Verify DataSource render with different entity ID (same data since test DataSource returns static)
  process.stdout.write('\nRendering another entity with DataSource...\n');
  const render2Res = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-2026-0099',
    channel: 'print'
  });

  assert('Second DataSource render succeeds',
    render2Res.status === 200 || render2Res.status === 201,
    'status=' + render2Res.status);

  if (render2Res.status === 200 || render2Res.status === 201) {
    const doc2 = render2Res.body.document || render2Res.body;
    assert('Second render doc is done', doc2.status === 'done', 'status=' + doc2.status);
  }

  // Step 10: Cleanup - unregister test DataSource
  const unregRes = await request('POST', '/datasources/custom/unregister', {});
  assert('DataSource unregistered', unregRes.status === 200 || unregRes.status === 201,
    'status=' + unregRes.status);

  // Verify it's gone
  const checkRes = await request('GET', '/datasources/custom', null);
  assert('DataSource no longer registered', checkRes.status === 404,
    'status=' + checkRes.status);

  // Summary
  process.stdout.write('\n=== RESULTS ===\n');
  process.stdout.write('Passed: ' + passed + '/' + total + '\n');
  process.stdout.write('Failed: ' + failed + '/' + total + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write('ERROR: ' + err.message + '\n');
  process.exit(1);
});
