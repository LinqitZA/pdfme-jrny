const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('test-user-370', 'org-aged-debtors-370');

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

let passed = 0, failed = 0, total = 0;
function assert(name, condition, detail) {
  total++;
  if (condition) { passed++; console.log('PASS: ' + name); }
  else { failed++; console.log('FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

function isOk(status) { return status >= 200 && status < 300; }

async function run() {
  console.log('=== Feature #370: System template report-aged-debtors renders correctly ===\n');

  // Step 1: Verify system template exists
  console.log('Step 1: Checking system template...');
  const sysRes = await request('GET', '/templates/sys-report-aged-debtors');
  assert('System template exists', sysRes.status === 200);
  assert('Correct type', sysRes.body && sysRes.body.type === 'report_aged_debtors');
  assert('Has schema', !!sysRes.body?.schema);
  assert('Is published', sysRes.body?.status === 'published');

  // Verify schema has aging columns
  const sysSchema = sysRes.body?.schema;
  if (sysSchema) {
    const schemas = sysSchema.schemas || [];
    let hasDebtorsTable = false, hasAgingCols = false;
    for (const page of schemas) {
      if (!Array.isArray(page)) continue;
      for (const el of page) {
        const key = Object.keys(el)[0];
        const cfg = el[key] || el;
        if (key === 'debtorsTable' || cfg?.type === 'table') {
          hasDebtorsTable = true;
          const cols = cfg.columns || cfg.head || [];
          const colSet = new Set(cols);
          hasAgingCols = colSet.has('current') && colSet.has('30days') &&
            colSet.has('60days') && colSet.has('90days') && colSet.has('120plus');
        }
      }
    }
    assert('Schema has debtors table', hasDebtorsTable);
    assert('Table has 30/60/90/120+ aging columns', hasAgingCols);
  }

  // Step 2: Create org template
  console.log('\nStep 2: Creating org template...');
  const createRes = await request('POST', '/templates', {
    name: 'Aged Debtors - Org 370',
    type: 'report_aged_debtors',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { reportTitle: { type: 'text', position: { x: 10, y: 10 }, width: 120, height: 12, fontSize: 18, fontWeight: 'bold' } },
        { reportDate: { type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 } },
        { debtorsTable: { type: 'table', position: { x: 10, y: 30 }, width: 190, height: 220,
          columns: ['customer', 'current', '30days', '60days', '90days', '120plus', 'total'] } },
        { grandTotal: { type: 'text', position: { x: 140, y: 260 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' } }
      ]],
      columns: [],
      sampledata: [{}]
    }
  });
  assert('Org template created', isOk(createRes.status), 'status=' + createRes.status);
  const templateId = createRes.body?.id;
  assert('Template has ID', !!templateId);
  if (!templateId) { console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`); process.exit(1); }

  // Step 3: Publish
  console.log('\nStep 3: Publishing...');
  const pubRes = await request('PUT', '/templates/' + templateId, { status: 'published' });
  assert('Published', isOk(pubRes.status), 'status=' + pubRes.status);

  // Step 4: Render with aged debtors data (multiple customers, grouping)
  console.log('\nStep 4: Rendering with debtors data...');
  const debtorsInputs = [{
    reportTitle: 'Aged Debtors Report',
    reportDate: '2026-03-18',
    grandTotal: 'R 125,450.00',
    debtorsTable: JSON.stringify([
      ['Acme Corp', 'R 5,000.00', 'R 3,200.00', 'R 1,500.00', 'R 800.00', 'R 0.00', 'R 10,500.00'],
      ['Beta Industries', 'R 12,000.00', 'R 8,500.00', 'R 4,200.00', 'R 2,100.00', 'R 1,050.00', 'R 27,850.00'],
      ['Gamma Holdings', 'R 25,000.00', 'R 15,000.00', 'R 10,000.00', 'R 5,000.00', 'R 3,500.00', 'R 58,500.00'],
      ['Delta Services', 'R 8,000.00', 'R 4,000.00', 'R 2,000.00', 'R 1,000.00', 'R 600.00', 'R 15,600.00'],
      ['Epsilon Tech', 'R 3,000.00', 'R 2,500.00', 'R 2,000.00', 'R 3,000.00', 'R 2,500.00', 'R 13,000.00'],
    ]),
  }];

  const renderRes = await request('POST', '/render/now', {
    templateId, entityId: 'aged-debtors-370-test', entityType: 'report_aged_debtors',
    channel: 'print', inputs: debtorsInputs
  });
  assert('Render succeeds', isOk(renderRes.status), 'status=' + renderRes.status);
  const doc = renderRes.body?.document;
  assert('Has document', !!doc);
  assert('Document status done', doc?.status === 'done', 'status=' + doc?.status);
  assert('Has PDF hash', !!doc?.pdfHash);
  assert('Has file path', !!doc?.filePath);
  assert('Entity type matches', doc?.entityType === 'report_aged_debtors');

  // Step 5: Download & verify PDF
  console.log('\nStep 5: Verifying PDF...');
  if (doc?.id) {
    const dl = await requestRaw('GET', '/render/document/' + doc.id);
    assert('PDF download OK', dl.status === 200, 'status=' + dl.status);
    assert('Content-Type is PDF', dl.headers['content-type'] === 'application/pdf');
    assert('PDF has content', dl.buffer?.length > 100, 'size=' + dl.buffer?.length);
    assert('PDF starts with %PDF', dl.buffer?.toString('utf8', 0, 5).startsWith('%PDF'));
    const pdfStr = dl.buffer.toString('latin1');
    assert('PDF has PDF/A markers', pdfStr.includes('pdfaid'));
  }

  // Step 6: Verify integrity
  console.log('\nStep 6: Verifying integrity...');
  if (doc?.id) {
    const vRes = await request('GET', '/render/verify/' + doc.id);
    assert('Verify returns OK', isOk(vRes.status));
  }

  // Step 7: Email channel render
  console.log('\nStep 7: Email channel render...');
  const emailRes = await request('POST', '/render/now', {
    templateId, entityId: 'aged-debtors-370-email', entityType: 'report_aged_debtors',
    channel: 'email', inputs: debtorsInputs
  });
  assert('Email render succeeds', isOk(emailRes.status), 'status=' + emailRes.status);
  assert('Email doc done', emailRes.body?.document?.status === 'done');

  // Step 8: Grouped debtors render
  console.log('\nStep 8: Grouped debtors render...');
  const groupedRes = await request('POST', '/render/now', {
    templateId, entityId: 'aged-debtors-370-grouped', entityType: 'report_aged_debtors',
    channel: 'print', inputs: [{
      reportTitle: 'Aged Debtors - By Category',
      reportDate: '2026-03-18',
      grandTotal: 'R 50,000.00',
      debtorsTable: JSON.stringify([
        ['RETAIL', '', '', '', '', '', ''],
        ['Shop A', 'R 5,000', 'R 3,000', 'R 0', 'R 0', 'R 0', 'R 8,000'],
        ['Shop B', 'R 2,000', 'R 1,000', 'R 500', 'R 0', 'R 0', 'R 3,500'],
        ['WHOLESALE', '', '', '', '', '', ''],
        ['Dist X', 'R 10,000', 'R 5,000', 'R 3,000', 'R 2,000', 'R 500', 'R 20,500'],
        ['Dist Y', 'R 8,000', 'R 5,000', 'R 3,000', 'R 1,500', 'R 500', 'R 18,000'],
      ]),
    }]
  });
  assert('Grouped render succeeds', isOk(groupedRes.status), 'status=' + groupedRes.status);
  assert('Grouped doc done', groupedRes.body?.document?.status === 'done');

  // Step 9: PDF/A validation
  console.log('\nStep 9: PDF/A compliance...');
  if (doc?.filePath) {
    const pdfaRes = await request('POST', '/render/validate-pdfa', { documentPath: doc.filePath });
    assert('PDF/A validation responds', isOk(pdfaRes.status), 'status=' + pdfaRes.status);
    if (pdfaRes.body) {
      if (pdfaRes.body.xmpPresent !== undefined) assert('XMP present', pdfaRes.body.xmpPresent);
      if (pdfaRes.body.fontsEmbedded !== undefined) assert('Fonts embedded', pdfaRes.body.fontsEmbedded);
    }
  }

  // Step 10: Minimal/empty data
  console.log('\nStep 10: Minimal data render...');
  const minRes = await request('POST', '/render/now', {
    templateId, entityId: 'aged-debtors-370-min', entityType: 'report_aged_debtors',
    channel: 'print', inputs: [{ reportTitle: 'Empty Report', reportDate: '2026-03-18', grandTotal: 'R 0', debtorsTable: '[]' }]
  });
  assert('Minimal render succeeds', isOk(minRes.status), 'status=' + minRes.status);
  assert('Minimal doc done', minRes.body?.document?.status === 'done');

  // Step 11: System template direct render
  console.log('\nStep 11: System template render...');
  const sysRenderRes = await request('POST', '/render/now', {
    templateId: 'sys-report-aged-debtors', entityId: 'aged-debtors-370-sys',
    entityType: 'report_aged_debtors', channel: 'print',
    inputs: [{
      reportTitle: 'System Aged Debtors', reportDate: '2026-03-18', grandTotal: 'R 75,000',
      debtorsTable: JSON.stringify([
        ['Customer A', 'R 20,000', 'R 15,000', 'R 10,000', 'R 5,000', 'R 0', 'R 50,000'],
        ['Customer B', 'R 10,000', 'R 5,000', 'R 5,000', 'R 3,000', 'R 2,000', 'R 25,000'],
      ]),
    }]
  });
  assert('System render succeeds', isOk(sysRenderRes.status), 'status=' + sysRenderRes.status);
  assert('System doc done', sysRenderRes.body?.document?.status === 'done');

  if (sysRenderRes.body?.document?.id) {
    const sysPdf = await requestRaw('GET', '/render/document/' + sysRenderRes.body.document.id);
    assert('System PDF download OK', sysPdf.status === 200);
    assert('System PDF has PDF/A markers', sysPdf.buffer.toString('latin1').includes('pdfaid'));
  }

  console.log('\n=== Results ===');
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
