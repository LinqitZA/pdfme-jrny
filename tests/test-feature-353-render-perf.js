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

const TOKEN = makeToken('render-perf-user-353', 'org-render-353');

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
  process.stdout.write('=== Feature #353: Render single document under 10 seconds ===\n\n');

  // Step 1: Create a standard invoice template
  process.stdout.write('Creating standard invoice template...\n');
  const templateRes = await request('POST', '/templates', {
    name: 'PerfTest-353-Invoice',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'INVOICE' },
          { type: 'text', position: { x: 20, y: 40 }, width: 170, height: 10, content: 'Company Name' },
          { type: 'text', position: { x: 20, y: 55 }, width: 80, height: 10, content: 'Invoice Number' },
          { type: 'text', position: { x: 20, y: 65 }, width: 80, height: 10, content: 'Date' },
          { type: 'text', position: { x: 20, y: 80 }, width: 170, height: 10, content: 'Customer' },
          { type: 'text', position: { x: 20, y: 100 }, width: 170, height: 10, content: 'Total Amount' }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Template created successfully', templateRes.status === 201, 'status=' + templateRes.status);
  const templateId = templateRes.body && templateRes.body.id;
  assert('Template has ID', !!templateId, 'id=' + templateId);

  if (!templateId) {
    process.stdout.write('Cannot continue without template ID\n');
    process.stdout.write('Response: ' + JSON.stringify(templateRes.body).substring(0, 300) + '\n');
    process.exit(1);
  }

  // Publish the template (required for rendering)
  process.stdout.write('Publishing template...\n');
  const publishRes = await request('POST', '/templates/' + templateId + '/publish', {});
  assert('Template published successfully', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status + ' body=' + JSON.stringify(publishRes.body).substring(0, 200));

  // Step 2: Measure render/now response time
  process.stdout.write('\nMeasuring render/now response time...\n');

  const renderStart = Date.now();
  const renderRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-PERF-001',
    channel: 'email',
    data: {
      company_name: 'Test Company Ltd',
      invoice_number: 'INV-2026-001',
      invoice_date: '2026-03-18',
      customer_name: 'Test Customer',
      total_amount: 'R 1,234.56'
    }
  });
  const renderTime = Date.now() - renderStart;

  process.stdout.write('  Render status: ' + renderRes.status + '\n');
  process.stdout.write('  Render time: ' + renderTime + 'ms\n');

  // Accept 201 (created) or 200 (ok)
  const renderSuccess = renderRes.status === 201 || renderRes.status === 200;
  assert('Render request succeeds', renderSuccess, 'status=' + renderRes.status);

  if (!renderSuccess) {
    process.stdout.write('  Response: ' + JSON.stringify(renderRes.body).substring(0, 500) + '\n');
  }

  assert('Render under 10 seconds', renderTime < 10000, 'time=' + renderTime + 'ms');
  assert('Render under 5 seconds (good perf)', renderTime < 5000, 'time=' + renderTime + 'ms');

  // Check the render response has document info
  const doc = renderRes.body;
  if (renderSuccess && doc) {
    const hasDocument = doc.document || doc.id || doc.filePath || doc.path;
    assert('Render returns document info', !!hasDocument, 'keys=' + Object.keys(doc).join(','));

    // Check for PDF path or content
    const hasPdf = doc.filePath || doc.path || doc.pdfPath ||
      (doc.document && (doc.document.filePath || doc.document.path));
    assert('Render produces PDF file reference', !!hasPdf,
      'doc keys=' + JSON.stringify(Object.keys(doc)).substring(0, 200));
  }

  // Step 3: Multiple renders to check consistency
  process.stdout.write('\nMeasuring multiple render times...\n');
  const renderTimes = [];

  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    const res = await request('POST', '/render/now', {
      templateId: templateId,
      entityId: 'INV-PERF-00' + (i + 2),
      channel: 'print',
      data: {
        company_name: 'Company ' + i,
        invoice_number: 'INV-2026-00' + (i + 2),
        invoice_date: '2026-03-18',
        customer_name: 'Customer ' + i,
        total_amount: 'R ' + ((i + 1) * 1000)
      }
    });
    const time = Date.now() - start;
    renderTimes.push(time);
    const success = res.status === 201 || res.status === 200;
    process.stdout.write('  Render ' + (i + 1) + ': ' + time + 'ms (status ' + res.status + ')\n');
  }

  const avgRenderTime = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
  const maxRenderTime = Math.max(...renderTimes);

  assert('All additional renders under 10 seconds', renderTimes.every(t => t < 10000),
    'times=' + renderTimes.join(',') + 'ms');
  assert('Average render time under 10 seconds', avgRenderTime < 10000,
    'avg=' + Math.round(avgRenderTime) + 'ms');
  assert('Max render time under 10 seconds', maxRenderTime < 10000,
    'max=' + maxRenderTime + 'ms');

  process.stdout.write('\n  Average render time: ' + Math.round(avgRenderTime) + 'ms\n');
  process.stdout.write('  Max render time: ' + maxRenderTime + 'ms\n');

  // Step 4: Render with different channels
  process.stdout.write('\nTesting both channels...\n');

  const emailStart = Date.now();
  const emailRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-PERF-EMAIL',
    channel: 'email',
    data: { company_name: 'Email Test', invoice_number: 'E001', invoice_date: '2026-03-18', customer_name: 'Email Customer', total_amount: 'R 500' }
  });
  const emailTime = Date.now() - emailStart;

  const printStart = Date.now();
  const printRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-PERF-PRINT',
    channel: 'print',
    data: { company_name: 'Print Test', invoice_number: 'P001', invoice_date: '2026-03-18', customer_name: 'Print Customer', total_amount: 'R 750' }
  });
  const printTime = Date.now() - printStart;

  assert('Email channel render under 10 seconds', emailTime < 10000, 'time=' + emailTime + 'ms');
  assert('Print channel render under 10 seconds', printTime < 10000, 'time=' + printTime + 'ms');
  process.stdout.write('  Email render: ' + emailTime + 'ms, Print render: ' + printTime + 'ms\n');

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
