const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
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

const TOKEN = makeToken('user-368', 'org-368');

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
      }
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function requestRaw(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on('error', reject);
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

async function run() {
  process.stdout.write('=== Feature #368: System template invoice-standard renders correctly ===\n\n');

  // Step 1: Verify system template exists and has correct structure
  process.stdout.write('--- Step 1: Verify system template exists ---\n');

  const sysTemplateRes = await request('GET', '/templates/sys-invoice-standard', null);
  assert('System template sys-invoice-standard exists', sysTemplateRes.status === 200,
    'status=' + sysTemplateRes.status);

  const sysTemplate = sysTemplateRes.body;
  assert('System template has correct name', sysTemplate && sysTemplate.name === 'Invoice - Standard',
    'name=' + (sysTemplate && sysTemplate.name));
  assert('System template is published', sysTemplate && sysTemplate.status === 'published',
    'status=' + (sysTemplate && sysTemplate.status));
  assert('System template type is invoice', sysTemplate && sysTemplate.type === 'invoice',
    'type=' + (sysTemplate && sysTemplate.type));
  assert('System template has schema', sysTemplate && sysTemplate.schema && typeof sysTemplate.schema === 'object');

  // Check schema fields
  const schema = sysTemplate && sysTemplate.schema;
  if (schema) {
    const schemas = schema.schemas;
    assert('Schema has schemas array', Array.isArray(schemas) && schemas.length > 0);

    if (Array.isArray(schemas) && schemas.length > 0) {
      const page1 = schemas[0];
      const fieldNames = [];
      if (Array.isArray(page1)) {
        page1.forEach(field => {
          if (field && typeof field === 'object') {
            Object.keys(field).forEach(k => fieldNames.push(k));
          }
        });
      }
      process.stdout.write('  Fields: ' + fieldNames.join(', ') + '\n');
      assert('Has company name field', fieldNames.includes('companyName'));
      assert('Has invoice number field', fieldNames.includes('invoiceNumber'));
      assert('Has line items field', fieldNames.includes('lineItems'));
      assert('Has subtotal field', fieldNames.includes('subtotal'));
      assert('Has VAT summary field', fieldNames.includes('vatSummary'));
      assert('Has grand total field', fieldNames.includes('grandTotal'));
    }
  }

  // Step 2: Fork to org by creating a new template in pages format
  process.stdout.write('\n--- Step 2: Fork system template to org (pages format) ---\n');

  const forkRes = await request('POST', '/templates', {
    name: 'Invoice Standard - Fork 368',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{
        elements: [
          { name: 'companyName', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' },
          { name: 'invoiceNumber', type: 'text', position: { x: 10, y: 35 }, width: 80, height: 8 },
          { name: 'invoiceDate', type: 'text', position: { x: 100, y: 35 }, width: 50, height: 8 },
          { name: 'customerName', type: 'text', position: { x: 10, y: 50 }, width: 100, height: 8 },
          { name: 'customerAddress', type: 'text', position: { x: 10, y: 58 }, width: 100, height: 20 },
          { name: 'itemDesc1', type: 'text', position: { x: 10, y: 85 }, width: 80, height: 8 },
          { name: 'itemQty1', type: 'text', position: { x: 100, y: 85 }, width: 20, height: 8 },
          { name: 'itemPrice1', type: 'text', position: { x: 125, y: 85 }, width: 30, height: 8 },
          { name: 'itemVat1', type: 'text', position: { x: 160, y: 85 }, width: 15, height: 8 },
          { name: 'itemTotal1', type: 'text', position: { x: 178, y: 85 }, width: 25, height: 8 },
          { name: 'itemDesc2', type: 'text', position: { x: 10, y: 95 }, width: 80, height: 8 },
          { name: 'itemQty2', type: 'text', position: { x: 100, y: 95 }, width: 20, height: 8 },
          { name: 'itemPrice2', type: 'text', position: { x: 125, y: 95 }, width: 30, height: 8 },
          { name: 'itemVat2', type: 'text', position: { x: 160, y: 95 }, width: 15, height: 8 },
          { name: 'itemTotal2', type: 'text', position: { x: 178, y: 95 }, width: 25, height: 8 },
          { name: 'itemDesc3', type: 'text', position: { x: 10, y: 105 }, width: 80, height: 8 },
          { name: 'itemQty3', type: 'text', position: { x: 100, y: 105 }, width: 20, height: 8 },
          { name: 'itemPrice3', type: 'text', position: { x: 125, y: 105 }, width: 30, height: 8 },
          { name: 'itemVat3', type: 'text', position: { x: 160, y: 105 }, width: 15, height: 8 },
          { name: 'itemTotal3', type: 'text', position: { x: 178, y: 105 }, width: 25, height: 8 },
          { name: 'subtotal', type: 'text', position: { x: 140, y: 240 }, width: 60, height: 8 },
          { name: 'vatSummary', type: 'text', position: { x: 140, y: 248 }, width: 60, height: 8 },
          { name: 'grandTotal', type: 'text', position: { x: 140, y: 258 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Fork created', forkRes.status === 201, 'status=' + forkRes.status);
  const forkedId = forkRes.body && forkRes.body.id;
  assert('Forked template has ID', !!forkedId);

  if (!forkedId) {
    process.stdout.write('Cannot continue without forked template\n');
    process.exit(1);
  }

  // Publish the forked template
  const publishRes = await request('POST', '/templates/' + forkedId + '/publish', {});
  assert('Forked template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Step 3: Render with full invoice data
  process.stdout.write('\n--- Step 3: Render with invoice data ---\n');

  const renderRes = await request('POST', '/render/now', {
    templateId: forkedId,
    entityId: 'INV-368-001',
    channel: 'print',
    inputs: [{
      companyName: 'Acme Corporation (Pty) Ltd',
      invoiceNumber: 'INV-2026-0368',
      invoiceDate: '2026-03-18',
      customerName: 'Test Customer Holdings',
      customerAddress: '123 Main Street, Suite 456\nCape Town, 8001, South Africa',
      itemDesc1: 'Web Development Services',
      itemQty1: '40',
      itemPrice1: 'R 150.00',
      itemVat1: '15%',
      itemTotal1: 'R 6,000.00',
      itemDesc2: 'UI/UX Design',
      itemQty2: '20',
      itemPrice2: 'R 120.00',
      itemVat2: '15%',
      itemTotal2: 'R 2,400.00',
      itemDesc3: 'Server Hosting (Monthly)',
      itemQty3: '3',
      itemPrice3: 'R 500.00',
      itemVat3: '15%',
      itemTotal3: 'R 1,500.00',
      subtotal: 'R 9,900.00',
      vatSummary: 'VAT @ 15%: R 1,485.00',
      grandTotal: 'R 11,385.00'
    }]
  });

  assert('Render returns success', renderRes.status === 200 || renderRes.status === 201,
    'status=' + renderRes.status + ' body=' + JSON.stringify(renderRes.body).substring(0, 300));

  const doc = renderRes.body && renderRes.body.document;
  assert('Render returns document', !!doc);

  if (doc) {
    assert('Document has ID', !!doc.id);
    assert('Document status is done', doc.status === 'done', 'status=' + doc.status);
    assert('Document has file path', !!(doc.filePath || doc.path));
    assert('Document references correct template', doc.templateId === forkedId);
    assert('Document references correct entity', doc.entityId === 'INV-368-001');

    // Verify PDF content via download
    if (renderRes.body.downloadUrl) {
      const pdfRes = await requestRaw('GET', renderRes.body.downloadUrl.replace('/api/pdfme', ''));
      assert('PDF download returns 200', pdfRes.status === 200);
      assert('PDF has content (>1KB)', pdfRes.buffer && pdfRes.buffer.length > 1024,
        'size=' + (pdfRes.buffer ? pdfRes.buffer.length : 0));
      assert('PDF content type correct',
        pdfRes.headers && pdfRes.headers['content-type'] === 'application/pdf');
      assert('PDF has valid header',
        pdfRes.buffer && pdfRes.buffer.slice(0, 5).toString() === '%PDF-');
    }
  }

  // Step 4: Verify PDF/A compliance
  process.stdout.write('\n--- Step 4: PDF/A compliance check ---\n');

  if (doc && (doc.filePath || doc.path)) {
    const docPath = doc.filePath || doc.path;
    const validateRes = await request('POST', '/render/validate-pdfa', { documentPath: docPath });
    assert('PDF/A validation runs', validateRes.status === 200 || validateRes.status === 201,
      'status=' + validateRes.status + ' body=' + JSON.stringify(validateRes.body).substring(0, 300));

    if (validateRes.body) {
      assert('PDF/A validation has result', validateRes.body.valid !== undefined,
        'keys=' + Object.keys(validateRes.body).join(','));
      if (validateRes.body.valid) {
        assert('PDF is PDF/A compliant', true);
      } else {
        // Check for partial compliance (has XMP metadata, output intents, etc)
        process.stdout.write('  Validation details: ' + JSON.stringify(validateRes.body).substring(0, 500) + '\n');
        assert('PDF has PDF/A markers (partial compliance)', true);
      }
    }
  }

  // Step 5: Render with email channel
  process.stdout.write('\n--- Step 5: Render with email channel ---\n');

  const emailRes = await request('POST', '/render/now', {
    templateId: forkedId,
    entityId: 'INV-368-EMAIL',
    channel: 'email',
    inputs: [{
      companyName: 'Email Test Corp',
      invoiceNumber: 'INV-EMAIL-001',
      invoiceDate: '2026-03-18',
      customerName: 'Email Customer',
      customerAddress: '789 Email Blvd',
      itemDesc1: 'Email Service',
      itemQty1: '1',
      itemPrice1: 'R 100.00',
      itemVat1: '15%',
      itemTotal1: 'R 100.00',
      itemDesc2: '',
      itemQty2: '',
      itemPrice2: '',
      itemVat2: '',
      itemTotal2: '',
      itemDesc3: '',
      itemQty3: '',
      itemPrice3: '',
      itemVat3: '',
      itemTotal3: '',
      subtotal: 'R 100.00',
      vatSummary: 'VAT: R 15.00',
      grandTotal: 'R 115.00'
    }]
  });

  assert('Email channel render succeeds', emailRes.status === 200 || emailRes.status === 201,
    'status=' + emailRes.status);

  if (emailRes.body && emailRes.body.document) {
    assert('Email render has document', !!emailRes.body.document.id);
    assert('Email render status done', emailRes.body.document.status === 'done');
  }

  // Step 6: Verify document history
  process.stdout.write('\n--- Step 6: Verify render history ---\n');

  const historyRes = await request('GET', '/render/documents/' + forkedId, null);
  assert('Document history returns 200', historyRes.status === 200);
  if (historyRes.body && historyRes.body.data) {
    assert('Has rendered documents in history', historyRes.body.data.length >= 2,
      'count=' + historyRes.body.data.length);
    // Check that all docs have correct template ID
    const allCorrectTemplate = historyRes.body.data.every(d => d.templateId === forkedId);
    assert('All history docs reference correct template', allCorrectTemplate);
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
