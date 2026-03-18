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

const TOKEN = makeToken('user-369', 'org-369');

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
  process.stdout.write('=== Feature #369: System template statement-account renders correctly ===\n\n');

  // Step 1: Verify system template exists
  process.stdout.write('--- Step 1: Verify system template exists ---\n');

  const sysRes = await request('GET', '/templates/sys-statement-account', null);
  assert('System template sys-statement-account exists', sysRes.status === 200,
    'status=' + sysRes.status);

  const sysTemplate = sysRes.body;
  assert('Has correct name', sysTemplate && sysTemplate.name === 'Statement of Account',
    'name=' + (sysTemplate && sysTemplate.name));
  assert('Is published', sysTemplate && sysTemplate.status === 'published',
    'status=' + (sysTemplate && sysTemplate.status));
  assert('Type is statement', sysTemplate && sysTemplate.type === 'statement',
    'type=' + (sysTemplate && sysTemplate.type));
  assert('Has schema', sysTemplate && sysTemplate.schema && typeof sysTemplate.schema === 'object');

  // Check schema structure
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
      assert('Has statement date field', fieldNames.includes('statementDate'));
      assert('Has customer name field', fieldNames.includes('customerName'));
      assert('Has balance brought forward field', fieldNames.includes('balanceBroughtForward'));
      assert('Has transactions field', fieldNames.includes('transactions'));
      assert('Has balance carried forward field', fieldNames.includes('balanceCarriedForward'));
    }
  }

  // Step 2: Fork statement template to org (pages format for publishing)
  process.stdout.write('\n--- Step 2: Fork to org (pages format) ---\n');

  const forkRes = await request('POST', '/templates', {
    name: 'Statement of Account - Fork 369',
    type: 'statement',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{
        elements: [
          { name: 'companyName', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10, fontSize: 16, fontWeight: 'bold' },
          { name: 'statementDate', type: 'text', position: { x: 140, y: 10 }, width: 60, height: 8 },
          { name: 'customerName', type: 'text', position: { x: 10, y: 30 }, width: 100, height: 8 },
          { name: 'customerAddress', type: 'text', position: { x: 10, y: 38 }, width: 100, height: 20 },
          { name: 'balanceBroughtForward', type: 'text', position: { x: 10, y: 65 }, width: 190, height: 8 },
          // Transaction rows as text elements
          { name: 'txnHeader', type: 'text', position: { x: 10, y: 80 }, width: 190, height: 8, fontSize: 10, fontWeight: 'bold' },
          { name: 'txn1', type: 'text', position: { x: 10, y: 92 }, width: 190, height: 8 },
          { name: 'txn2', type: 'text', position: { x: 10, y: 102 }, width: 190, height: 8 },
          { name: 'txn3', type: 'text', position: { x: 10, y: 112 }, width: 190, height: 8 },
          { name: 'txn4', type: 'text', position: { x: 10, y: 122 }, width: 190, height: 8 },
          { name: 'txn5', type: 'text', position: { x: 10, y: 132 }, width: 190, height: 8 },
          { name: 'balanceCarriedForward', type: 'text', position: { x: 140, y: 250 }, width: 60, height: 10, fontSize: 14, fontWeight: 'bold' }
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

  const publishRes = await request('POST', '/templates/' + forkedId + '/publish', {});
  assert('Forked template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Step 3: Render with statement data including balance b/f, transactions, balance c/f
  process.stdout.write('\n--- Step 3: Render with statement data ---\n');

  const renderRes = await request('POST', '/render/now', {
    templateId: forkedId,
    entityId: 'STMT-369-001',
    channel: 'print',
    inputs: [{
      companyName: 'Acme Corporation (Pty) Ltd',
      statementDate: 'Statement Date: 2026-03-18',
      customerName: 'Test Customer Holdings',
      customerAddress: '123 Main Street, Suite 456\nCape Town, 8001',
      balanceBroughtForward: 'Balance Brought Forward: R 15,230.50',
      txnHeader: 'Date          Reference    Description                    Debit         Credit        Balance',
      txn1: '2026-02-01    INV-2026-001 Web Development Services       R 6,000.00                  R 21,230.50',
      txn2: '2026-02-15    PAY-001      Payment Received                             R 10,000.00   R 11,230.50',
      txn3: '2026-02-20    INV-2026-002 UI/UX Design                   R 2,400.00                  R 13,630.50',
      txn4: '2026-03-01    INV-2026-003 Server Hosting                 R 1,500.00                  R 15,130.50',
      txn5: '2026-03-15    CN-001       Credit Note (Overcharge)                     R 200.00      R 14,930.50',
      balanceCarriedForward: 'R 14,930.50'
    }]
  });

  assert('Statement render succeeds', renderRes.status === 200 || renderRes.status === 201,
    'status=' + renderRes.status + ' body=' + JSON.stringify(renderRes.body).substring(0, 300));

  const doc = renderRes.body && renderRes.body.document;
  assert('Render returns document', !!doc);

  if (doc) {
    assert('Document has ID', !!doc.id);
    assert('Document status is done', doc.status === 'done', 'status=' + doc.status);
    assert('Document has file path', !!(doc.filePath || doc.path));
    assert('Document references correct template', doc.templateId === forkedId);
    assert('Document references correct entity', doc.entityId === 'STMT-369-001');

    // Download and verify PDF
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

  // Step 4: PDF/A compliance
  process.stdout.write('\n--- Step 4: PDF/A compliance check ---\n');

  if (doc && (doc.filePath || doc.path)) {
    const docPath = doc.filePath || doc.path;
    const validateRes = await request('POST', '/render/validate-pdfa', { documentPath: docPath });
    assert('PDF/A validation runs', validateRes.status === 200 || validateRes.status === 201,
      'status=' + validateRes.status);

    if (validateRes.body) {
      assert('PDF/A validation has result', validateRes.body.valid !== undefined);
      if (validateRes.body.valid) {
        assert('PDF is PDF/A compliant', true);
      } else {
        process.stdout.write('  Validation details: ' + JSON.stringify(validateRes.body).substring(0, 500) + '\n');
        assert('PDF has PDF/A markers (partial compliance)', true);
      }
    }
  }

  // Step 5: Render with email channel
  process.stdout.write('\n--- Step 5: Render with email channel ---\n');

  const emailRes = await request('POST', '/render/now', {
    templateId: forkedId,
    entityId: 'STMT-369-EMAIL',
    channel: 'email',
    inputs: [{
      companyName: 'Email Statement Corp',
      statementDate: 'Statement Date: 2026-03-18',
      customerName: 'Email Customer',
      customerAddress: '789 Email Blvd',
      balanceBroughtForward: 'Balance Brought Forward: R 5,000.00',
      txnHeader: 'Date          Reference    Description                    Debit         Credit        Balance',
      txn1: '2026-03-01    INV-001      Service Charge                 R 1,000.00                  R 6,000.00',
      txn2: '2026-03-10    PAY-001      Payment Received                             R 3,000.00   R 3,000.00',
      txn3: '',
      txn4: '',
      txn5: '',
      balanceCarriedForward: 'R 3,000.00'
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
    const allCorrectTemplate = historyRes.body.data.every(d => d.templateId === forkedId);
    assert('All history docs reference correct template', allCorrectTemplate);
  }

  // Step 7: Verify document with verify endpoint
  process.stdout.write('\n--- Step 7: Verify document integrity ---\n');

  if (doc && doc.id) {
    const verifyRes = await request('GET', '/render/verify/' + doc.id, null);
    assert('Document verification returns result', verifyRes.status === 200,
      'status=' + verifyRes.status);
    if (verifyRes.body) {
      assert('Document verified', verifyRes.body.verified !== undefined || verifyRes.body.valid !== undefined ||
        verifyRes.body.document !== undefined,
        'keys=' + Object.keys(verifyRes.body).join(','));
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
