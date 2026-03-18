const http = require('http');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';
const BASE = process.env.API_BASE || 'http://localhost:3001';

let pass = 0;
let fail = 0;

function check(desc, result) {
  if (result) { pass++; process.stdout.write('  PASS: ' + desc + '\n'); }
  else { fail++; process.stdout.write('  FAIL: ' + desc + '\n'); }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + JWT,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: text }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  process.stdout.write('\n=== Feature #131: QR Barcode ERP URL Binding ===\n');

  const qrTpl = await request('POST', '/api/pdfme/templates', {
    name: 'QR Test ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'invoiceQr', type: 'qrBarcode', urlPattern: 'https://erp.example.com/invoices/{{document.id}}', position: { x: 150, y: 10 }, width: 40, height: 40 },
      ]],
    },
  });
  check('QR template created', qrTpl.data && qrTpl.data.id);
  const qrId = qrTpl.data.id;

  await request('POST', '/api/pdfme/templates/' + qrId + '/publish');

  const r1 = await request('POST', '/api/pdfme/render/now', {
    templateId: qrId, entityId: 'INV-001', channel: 'print',
    inputs: [{ title: 'Invoice', invoiceQr: 'https://erp.example.com/invoices/INV-001', 'document.id': 'INV-001' }],
  });
  check('QR render succeeded (status=done)', r1.data && r1.data.document && r1.data.document.status === 'done');
  check('QR PDF file path exists', r1.data && r1.data.document && r1.data.document.filePath);

  const r2 = await request('POST', '/api/pdfme/render/now', {
    templateId: qrId, entityId: 'INV-002', channel: 'print',
    inputs: [{ title: 'Invoice 2', invoiceQr: '', 'document.id': 'INV-002' }],
  });
  check('QR binding resolution render succeeded', r2.data && r2.data.document && r2.data.document.status === 'done');

  process.stdout.write('\n=== Feature #132: resolvePageScopes ===\n');

  const scopeTpl = await request('POST', '/api/pdfme/templates', {
    name: 'Page Scope Test ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [
        [
          { name: 'headerP1', type: 'text', pageScope: 'all', position: { x: 10, y: 10 }, width: 100, height: 10 },
          { name: 'firstOnlyP1', type: 'text', pageScope: 'first', position: { x: 10, y: 25 }, width: 100, height: 10 },
          { name: 'lastOnlyP1', type: 'text', pageScope: 'last', position: { x: 10, y: 40 }, width: 100, height: 10 },
          { name: 'notFirstP1', type: 'text', pageScope: 'notFirst', position: { x: 10, y: 55 }, width: 100, height: 10 },
          { name: 'bodyP1', type: 'text', position: { x: 10, y: 65 }, width: 100, height: 10 },
        ],
        [
          { name: 'headerP2', type: 'text', pageScope: 'all', position: { x: 10, y: 10 }, width: 100, height: 10 },
          { name: 'firstOnlyP2', type: 'text', pageScope: 'first', position: { x: 10, y: 25 }, width: 100, height: 10 },
          { name: 'lastOnlyP2', type: 'text', pageScope: 'last', position: { x: 10, y: 40 }, width: 100, height: 10 },
          { name: 'notFirstP2', type: 'text', pageScope: 'notFirst', position: { x: 10, y: 55 }, width: 100, height: 10 },
          { name: 'bodyP2', type: 'text', position: { x: 10, y: 65 }, width: 100, height: 10 },
        ],
        [
          { name: 'headerP3', type: 'text', pageScope: 'all', position: { x: 10, y: 10 }, width: 100, height: 10 },
          { name: 'firstOnlyP3', type: 'text', pageScope: 'first', position: { x: 10, y: 25 }, width: 100, height: 10 },
          { name: 'lastOnlyP3', type: 'text', pageScope: 'last', position: { x: 10, y: 40 }, width: 100, height: 10 },
          { name: 'notFirstP3', type: 'text', pageScope: 'notFirst', position: { x: 10, y: 55 }, width: 100, height: 10 },
          { name: 'bodyP3', type: 'text', position: { x: 10, y: 65 }, width: 100, height: 10 },
        ],
      ],
    },
  });
  check('Page scope template created', scopeTpl.data && scopeTpl.data.id);
  const scopeId = scopeTpl.data.id;

  await request('POST', '/api/pdfme/templates/' + scopeId + '/publish');

  const sr = await request('POST', '/api/pdfme/render/now', {
    templateId: scopeId, entityId: 'SCOPE-001', channel: 'print',
    inputs: [{
      headerP1: 'Header 1', firstOnlyP1: 'First Page Banner', lastOnlyP1: 'Last Footer', notFirstP1: 'Continuation', bodyP1: 'Page 1',
      headerP2: 'Header 2', firstOnlyP2: 'First Page Banner', lastOnlyP2: 'Last Footer', notFirstP2: 'Continuation', bodyP2: 'Page 2',
      headerP3: 'Header 3', firstOnlyP3: 'First Page Banner', lastOnlyP3: 'Last Footer', notFirstP3: 'Continuation', bodyP3: 'Page 3',
    }],
  });

  if (sr.data && sr.data.error) {
    process.stdout.write('  ERROR: ' + JSON.stringify(sr.data).substring(0, 500) + '\n');
  }
  check('Page scope render succeeded (status=done)', sr.data && sr.data.document && sr.data.document.status === 'done');
  check('PDF file generated', sr.data && sr.data.document && sr.data.document.filePath);

  if (sr.data && sr.data.document && sr.data.document.filePath) {
    const fs = require('fs');
    const filePath = 'storage/' + sr.data.document.filePath;
    if (fs.existsSync(filePath)) {
      const { PDFDocument } = require('pdf-lib');
      const buf = fs.readFileSync(filePath);
      const doc = await PDFDocument.load(buf);
      check('PDF has 3 pages', doc.getPageCount() === 3);
    } else {
      check('PDF has 3 pages', false);
    }
  }

  process.stdout.write('\n=== Feature #133: resolveConditions ===\n');

  const condTpl = await request('POST', '/api/pdfme/templates', {
    name: 'Conditions Test ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'optionalNote', type: 'text', condition: { type: 'fieldNonEmpty', field: 'notes' }, position: { x: 10, y: 25 }, width: 100, height: 10 },
        { name: 'discountLabel', type: 'text', condition: { type: 'expression', expression: 'discount > 0' }, position: { x: 10, y: 40 }, width: 100, height: 10 },
        { name: 'alwaysVisible', type: 'text', position: { x: 10, y: 55 }, width: 100, height: 10 },
      ]],
    },
  });
  check('Conditions template created', condTpl.data && condTpl.data.id);
  const condId = condTpl.data.id;

  await request('POST', '/api/pdfme/templates/' + condId + '/publish');

  const cr1 = await request('POST', '/api/pdfme/render/now', {
    templateId: condId, entityId: 'COND-001', channel: 'print',
    inputs: [{ title: 'Invoice', optionalNote: 'Note here', notes: 'Has value', discountLabel: '10% off', discount: '15', alwaysVisible: 'Footer' }],
  });
  check('Render with populated fields succeeded', cr1.data && cr1.data.document && cr1.data.document.status === 'done');

  const cr2 = await request('POST', '/api/pdfme/render/now', {
    templateId: condId, entityId: 'COND-002', channel: 'print',
    inputs: [{ title: 'Invoice', optionalNote: 'Hidden', notes: '', discountLabel: 'Hidden', discount: '0', alwaysVisible: 'Footer' }],
  });
  check('Render with empty fields succeeded', cr2.data && cr2.data.document && cr2.data.document.status === 'done');

  const cr3 = await request('POST', '/api/pdfme/render/now', {
    templateId: condId, entityId: 'COND-003', channel: 'print',
    inputs: [{ title: 'Invoice', optionalNote: 'Note', notes: 'Present', discountLabel: '25% off', discount: '25', alwaysVisible: 'Footer' }],
  });
  check('Expression condition (discount=25 > 0) render succeeded', cr3.data && cr3.data.document && cr3.data.document.status === 'done');

  process.stdout.write('\n=== Summary ===\n');
  process.stdout.write('PASSED: ' + pass + '\n');
  process.stdout.write('FAILED: ' + fail + '\n');
  process.stdout.write('TOTAL: ' + (pass + fail) + '\n');
}

main().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
