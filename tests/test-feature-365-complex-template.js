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

const TOKEN = makeToken('complex-user-365', 'org-complex-365');

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

// Create a small 1x1 white PNG as base64 for image elements
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function run() {
  process.stdout.write('=== Feature #365: Render pipeline handles complex template ===\n\n');

  // Step 1: Create a complex template with multiple element types
  process.stdout.write('Creating complex template with multiple element types...\n');

  const complexSchema = {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    pages: [
      {
        elements: [
          // Text elements
          { name: 'header', type: 'text', position: { x: 20, y: 10 }, width: 170, height: 15, content: 'COMPLEX INVOICE #001' },
          { name: 'subtitle', type: 'text', position: { x: 20, y: 28 }, width: 170, height: 10, content: 'Multi-element template test' },
          // Line element
          { name: 'separator1', type: 'line', position: { x: 20, y: 42 }, width: 170, height: 1, content: '' },
          // Rectangle element
          { name: 'box1', type: 'rectangle', position: { x: 20, y: 48 }, width: 80, height: 30, content: '', borderWidth: 1, borderColor: '#000000', color: '#f0f0f0' },
          // Text inside rectangle area
          { name: 'fromLabel', type: 'text', position: { x: 22, y: 50 }, width: 76, height: 8, content: 'From:' },
          { name: 'fromName', type: 'text', position: { x: 22, y: 58 }, width: 76, height: 8, content: 'Test Company LLC' },
          { name: 'fromAddr', type: 'text', position: { x: 22, y: 66 }, width: 76, height: 8, content: '123 Main Street' },
          // Second rectangle
          { name: 'box2', type: 'rectangle', position: { x: 110, y: 48 }, width: 80, height: 30, content: '', borderWidth: 1, borderColor: '#000000', color: '#f0f0f0' },
          { name: 'toLabel', type: 'text', position: { x: 112, y: 50 }, width: 76, height: 8, content: 'To:' },
          { name: 'toName', type: 'text', position: { x: 112, y: 58 }, width: 76, height: 8, content: 'Customer Corp' },
          { name: 'toAddr', type: 'text', position: { x: 112, y: 66 }, width: 76, height: 8, content: '456 Oak Avenue' },
          // QR Code
          { name: 'qrcode1', type: 'qrcode', position: { x: 160, y: 85 }, width: 30, height: 30, content: 'https://example.com/invoice/001' },
          // Date/time elements
          { name: 'invoiceDate', type: 'text', position: { x: 20, y: 85 }, width: 60, height: 8, content: 'Date: 2026-03-18' },
          { name: 'dueDate', type: 'text', position: { x: 20, y: 95 }, width: 60, height: 8, content: 'Due: 2026-04-18' },
          // Ellipse element
          { name: 'statusBadge', type: 'ellipse', position: { x: 90, y: 85 }, width: 20, height: 20, content: '', color: '#4CAF50' },
          // Table-like text layout
          { name: 'tableHeader', type: 'text', position: { x: 20, y: 120 }, width: 170, height: 10, content: 'Item | Qty | Price | Total' },
          { name: 'line2', type: 'line', position: { x: 20, y: 132 }, width: 170, height: 1, content: '' },
          { name: 'row1', type: 'text', position: { x: 20, y: 135 }, width: 170, height: 8, content: 'Widget A | 10 | $5.00 | $50.00' },
          { name: 'row2', type: 'text', position: { x: 20, y: 145 }, width: 170, height: 8, content: 'Widget B | 5 | $10.00 | $50.00' },
          { name: 'row3', type: 'text', position: { x: 20, y: 155 }, width: 170, height: 8, content: 'Service C | 1 | $100.00 | $100.00' },
          { name: 'line3', type: 'line', position: { x: 20, y: 165 }, width: 170, height: 1, content: '' },
          { name: 'totalLabel', type: 'text', position: { x: 120, y: 170 }, width: 30, height: 10, content: 'Total:' },
          { name: 'totalAmount', type: 'text', position: { x: 150, y: 170 }, width: 40, height: 10, content: '$200.00' },
          // Image element (base64 inline)
          { name: 'logo', type: 'image', position: { x: 20, y: 195 }, width: 25, height: 25, content: 'data:image/png;base64,' + TINY_PNG },
          // Footer text
          { name: 'footer', type: 'text', position: { x: 20, y: 230 }, width: 170, height: 8, content: 'Thank you for your business!' },
          { name: 'terms', type: 'text', position: { x: 20, y: 240 }, width: 170, height: 8, content: 'Payment terms: Net 30 days' },
        ],
        size: { width: 210, height: 297 }
      },
      {
        // Second page with additional elements
        elements: [
          { name: 'page2header', type: 'text', position: { x: 20, y: 10 }, width: 170, height: 15, content: 'Page 2 - Additional Details' },
          { name: 'separator2', type: 'line', position: { x: 20, y: 28 }, width: 170, height: 1, content: '' },
          { name: 'notes', type: 'text', position: { x: 20, y: 35 }, width: 170, height: 40, content: 'This is a multi-line notes section that contains additional information about the invoice. The render pipeline should handle longer text content gracefully across multiple lines without any errors.' },
          // Barcode element
          { name: 'barcode1', type: 'code128', position: { x: 20, y: 85 }, width: 80, height: 25, content: 'INV-2026-001' },
          // Another rectangle
          { name: 'noticeBox', type: 'rectangle', position: { x: 20, y: 120 }, width: 170, height: 40, content: '', borderWidth: 2, borderColor: '#FF0000', color: '#FFF0F0' },
          { name: 'noticeText', type: 'text', position: { x: 25, y: 125 }, width: 160, height: 30, content: 'IMPORTANT: This invoice is auto-generated. Please contact billing@example.com for any discrepancies.' },
          // Another QR code with different data
          { name: 'payQr', type: 'qrcode', position: { x: 80, y: 170 }, width: 50, height: 50, content: 'https://pay.example.com/inv/001?amount=200.00' },
          { name: 'payLabel', type: 'text', position: { x: 80, y: 225 }, width: 50, height: 8, content: 'Scan to Pay' },
          // Ellipse decoration
          { name: 'dot1', type: 'ellipse', position: { x: 20, y: 250 }, width: 5, height: 5, content: '', color: '#2196F3' },
          { name: 'dot2', type: 'ellipse', position: { x: 30, y: 250 }, width: 5, height: 5, content: '', color: '#4CAF50' },
          { name: 'dot3', type: 'ellipse', position: { x: 40, y: 250 }, width: 5, height: 5, content: '', color: '#FF9800' },
          { name: 'companyTag', type: 'text', position: { x: 50, y: 250 }, width: 100, height: 8, content: 'Generated by PDFme ERP System' },
        ],
        size: { width: 210, height: 297 }
      }
    ]
  };

  const templateRes = await request('POST', '/templates', {
    name: 'ComplexTemplate-365',
    type: 'invoice',
    schema: complexSchema
  });

  assert('Template created', templateRes.status === 201, 'status=' + templateRes.status);
  const templateId = templateRes.body && templateRes.body.id;

  if (!templateId) {
    process.stdout.write('Cannot continue without template. Response: ' + JSON.stringify(templateRes.body).substring(0, 500) + '\n');
    process.exit(1);
  }

  // Verify template has correct element count
  const getRes = await request('GET', '/templates/' + templateId, null);
  assert('Template retrieved', getRes.status === 200, 'status=' + getRes.status);

  const storedSchema = getRes.body.schema;
  if (storedSchema && storedSchema.pages) {
    const page1Count = storedSchema.pages[0].elements.length;
    const page2Count = storedSchema.pages[1].elements.length;
    assert('Page 1 has 26 elements', page1Count === 26, 'count=' + page1Count);
    assert('Page 2 has 12 elements', page2Count === 12, 'count=' + page2Count);
    assert('Total 38 elements across 2 pages', page1Count + page2Count === 38,
      'total=' + (page1Count + page2Count));
  }

  // Step 2: Publish template
  const publishRes = await request('POST', '/templates/' + templateId + '/publish', {});
  assert('Template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Step 3: Render the complex template
  process.stdout.write('\nRendering complex template...\n');
  const renderStart = Date.now();
  const renderRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'COMPLEX-365-001',
    channel: 'email',
    data: {}
  });
  const renderTime = Date.now() - renderStart;

  process.stdout.write('  Render completed in ' + renderTime + 'ms\n');

  assert('Render returns 200/201', renderRes.status === 200 || renderRes.status === 201,
    'status=' + renderRes.status + ', body=' + JSON.stringify(renderRes.body).substring(0, 300));

  if (renderRes.status !== 200 && renderRes.status !== 201) {
    process.stdout.write('Render response: ' + JSON.stringify(renderRes.body).substring(0, 500) + '\n');
    process.stdout.write('\n=== RESULTS ===\nPassed: ' + passed + '/' + total + '\nFailed: ' + failed + '/' + total + '\n');
    process.exit(1);
  }

  const doc = renderRes.body.document || renderRes.body;
  assert('Document ID returned', !!doc.id, 'id=' + doc.id);
  assert('Document status is done', doc.status === 'done', 'status=' + doc.status);
  assert('File path returned', !!doc.filePath, 'filePath=' + doc.filePath);
  assert('PDF hash returned', !!doc.pdfHash, 'pdfHash=' + doc.pdfHash);
  assert('No error message', !doc.errorMessage, 'error=' + doc.errorMessage);

  // Step 4: Verify render completed in reasonable time
  assert('Render under 30 seconds', renderTime < 30000, 'time=' + renderTime + 'ms');
  assert('Render under 10 seconds', renderTime < 10000, 'time=' + renderTime + 'ms');

  // Step 5: Render with print channel too
  process.stdout.write('\nRendering with print channel...\n');
  const printRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'COMPLEX-365-002',
    channel: 'print',
    data: {}
  });

  assert('Print channel render succeeds', printRes.status === 200 || printRes.status === 201,
    'status=' + printRes.status);
  if (printRes.status === 200 || printRes.status === 201) {
    const printDoc = printRes.body.document || printRes.body;
    assert('Print document status is done', printDoc.status === 'done', 'status=' + printDoc.status);
    assert('Print document has no errors', !printDoc.errorMessage, 'error=' + printDoc.errorMessage);
  }

  // Step 6: Render with custom input data
  process.stdout.write('\nRendering with custom input data...\n');
  const customRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'COMPLEX-365-003',
    channel: 'email',
    inputs: [{
      header: 'CUSTOM INVOICE #999',
      fromName: 'Acme Corp',
      toName: 'Big Client Inc',
      totalAmount: '$5,000.00',
      invoiceDate: 'Date: 2026-12-31'
    }]
  });

  assert('Custom inputs render succeeds', customRes.status === 200 || customRes.status === 201,
    'status=' + customRes.status);
  if (customRes.status === 200 || customRes.status === 201) {
    const customDoc = customRes.body.document || customRes.body;
    assert('Custom inputs doc status done', customDoc.status === 'done', 'status=' + customDoc.status);
  }

  // Step 7: Verify server health after complex renders
  process.stdout.write('\nVerifying server health...\n');
  const healthRes = await new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/pdfme/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });

  assert('Server healthy after complex renders', healthRes.status === 200, 'status=' + healthRes.status);

  // Step 8: Bulk render the complex template (5 docs)
  process.stdout.write('\nBulk rendering 5 complex documents...\n');
  const bulkEntityIds = [];
  for (let i = 1; i <= 5; i++) {
    bulkEntityIds.push('COMPLEX-365-BULK-' + String(i).padStart(2, '0'));
  }

  const bulkRes = await request('POST', '/render/bulk', {
    templateId: templateId,
    entityIds: bulkEntityIds,
    channel: 'email'
  });

  assert('Bulk render of complex template accepted', bulkRes.status === 202,
    'status=' + bulkRes.status);

  if (bulkRes.status === 202) {
    const batchId = bulkRes.body.batchId || bulkRes.body.id;
    // Wait for completion
    let done = false;
    let polls = 0;
    let lastStatus = null;
    while (!done && polls < 120) {
      await new Promise(r => setTimeout(r, 1000));
      polls++;
      const sr = await request('GET', '/render/batch/' + batchId, null);
      if (sr.status === 200) {
        lastStatus = sr.body;
        const progress = (lastStatus.completedJobs || 0) + (lastStatus.failedJobs || 0);
        if (lastStatus.status === 'completed' || lastStatus.status === 'done' || progress >= 5) {
          done = true;
        }
      }
    }
    assert('Bulk complex render completed', done, 'polls=' + polls);
    if (lastStatus) {
      assert('All 5 complex docs completed', (lastStatus.completedJobs || 0) >= 5,
        'completed=' + (lastStatus.completedJobs || 0) + ', failed=' + (lastStatus.failedJobs || 0));
    }
  }

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
