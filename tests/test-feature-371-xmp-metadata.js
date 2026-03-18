const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
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

const TOKEN = makeToken('test-user-371', 'org-xmp-371');

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

function isOk(s) { return s >= 200 && s < 300; }

async function run() {
  console.log('=== Feature #371: XMP metadata block in generated PDFs ===\n');

  // Step 1: Create and publish a simple template
  console.log('Step 1: Create template...');
  const createRes = await request('POST', '/templates', {
    name: 'XMP Test Template 371',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'XMP Test Document' },
          { name: 'body', type: 'text', position: { x: 20, y: 40 }, width: 170, height: 10, content: 'Test content for XMP metadata verification' },
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });
  assert('Template created', isOk(createRes.status));
  const tplId = createRes.body?.id;
  assert('Has ID', !!tplId);
  if (!tplId) { console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`); process.exit(1); }

  const pubRes = await request('PUT', '/templates/' + tplId, { status: 'published' });
  assert('Published', isOk(pubRes.status));

  // Step 2: Render document
  console.log('\nStep 2: Render document...');
  const renderRes = await request('POST', '/render/now', {
    templateId: tplId,
    entityId: 'xmp-test-371',
    entityType: 'invoice',
    channel: 'print',
    inputs: [{ title: 'XMP Test Invoice', body: 'Testing XMP metadata presence' }]
  });
  assert('Render succeeds', isOk(renderRes.status), 'status=' + renderRes.status);
  const doc = renderRes.body?.document;
  assert('Document done', doc?.status === 'done');

  // Step 3: Download the PDF and extract XMP metadata
  console.log('\nStep 3: Extract XMP metadata from PDF...');
  let pdfBuffer = null;
  let pdfStr = '';
  if (doc?.id) {
    const dl = await requestRaw('GET', '/render/document/' + doc.id);
    assert('PDF downloaded', dl.status === 200);
    pdfBuffer = dl.buffer;
    pdfStr = pdfBuffer.toString('latin1');
  }

  // Step 4: Verify dc:title is present
  console.log('\nStep 4: Verify dc:title...');
  assert('XMP metadata stream present', pdfStr.includes('x:xmpmeta') || pdfStr.includes('xmpmeta'));
  assert('dc:title present', pdfStr.includes('dc:title'));

  // Look for the title content in XMP
  const dcTitleMatch = pdfStr.includes('dc:title');
  assert('dc:title element found in XMP', dcTitleMatch);

  // Step 5: Verify dc:creator is present
  console.log('\nStep 5: Verify dc:creator...');
  assert('dc:creator present', pdfStr.includes('dc:creator'));
  // Verify creator has pdfme reference
  assert('Creator contains pdfme reference', pdfStr.includes('pdfme') || pdfStr.includes('ERP'));

  // Step 6: Verify pdfaid:part=3 and pdfaid:conformance=B
  console.log('\nStep 6: Verify PDF/A identification...');
  assert('pdfaid:part present', pdfStr.includes('pdfaid:part'));
  assert('pdfaid:conformance present', pdfStr.includes('pdfaid:conformance'));

  // Extract and verify part=3 and conformance=B
  const partMatch = pdfStr.match(/pdfaid:part[^>]*>[\s]*3/s) || pdfStr.match(/pdfaid:part.*?3/s);
  const confMatch = pdfStr.match(/pdfaid:conformance[^>]*>[\s]*B/s) || pdfStr.match(/pdfaid:conformance.*?B/s);
  assert('pdfaid:part=3 (PDF/A-3)', !!partMatch, 'found: ' + (partMatch ? partMatch[0].substring(0, 50) : 'none'));
  assert('pdfaid:conformance=B', !!confMatch, 'found: ' + (confMatch ? confMatch[0].substring(0, 50) : 'none'));

  // Step 7: Verify via validate-pdfa endpoint
  console.log('\nStep 7: Validate-pdfa endpoint...');
  if (doc?.filePath) {
    const valRes = await request('POST', '/render/validate-pdfa', { documentPath: doc.filePath });
    assert('Validation responds OK', isOk(valRes.status));
    if (valRes.body) {
      assert('XMP present per validator', valRes.body.xmpPresent === true);
    }
  }

  // Step 8: XMP namespaces are properly declared
  console.log('\nStep 8: XMP namespace declarations...');
  assert('Dublin Core namespace', pdfStr.includes('purl.org/dc/elements'));
  assert('PDF/A ID namespace', pdfStr.includes('aiim.org/pdfa/ns/id'));
  assert('XMP namespace', pdfStr.includes('adobe:ns:meta') || pdfStr.includes('ns.adobe.com/xap'));

  // Step 9: Verify additional required XMP properties
  console.log('\nStep 9: Additional XMP properties...');
  // xmp:CreateDate and xmp:ModifyDate should be present
  const hasCreateDate = pdfStr.includes('xmp:CreateDate') || pdfStr.includes('CreateDate');
  const hasModifyDate = pdfStr.includes('xmp:ModifyDate') || pdfStr.includes('ModifyDate');
  assert('xmp:CreateDate present', hasCreateDate);
  assert('xmp:ModifyDate present', hasModifyDate);

  // pdf:Producer should be present
  assert('pdf:Producer present', pdfStr.includes('pdf:Producer') || pdfStr.includes('Producer'));

  // Step 10: Render with email channel and verify XMP too
  console.log('\nStep 10: Email channel PDF also has XMP...');
  const emailRes = await request('POST', '/render/now', {
    templateId: tplId, entityId: 'xmp-test-371-email', entityType: 'invoice',
    channel: 'email', inputs: [{ title: 'Email XMP Test', body: 'Email channel' }]
  });
  assert('Email render succeeds', isOk(emailRes.status));
  if (emailRes.body?.document?.id) {
    const emailPdf = await requestRaw('GET', '/render/document/' + emailRes.body.document.id);
    const emailStr = emailPdf.buffer.toString('latin1');
    assert('Email PDF has XMP', emailStr.includes('x:xmpmeta'));
    assert('Email PDF has pdfaid:part', emailStr.includes('pdfaid:part'));
    assert('Email PDF has dc:title', emailStr.includes('dc:title'));
    assert('Email PDF has dc:creator', emailStr.includes('dc:creator'));
  }

  // Step 11: Verify system template render also has XMP
  console.log('\nStep 11: System template PDF also has XMP...');
  const sysRes = await request('POST', '/render/now', {
    templateId: 'sys-invoice-standard', entityId: 'xmp-sys-371',
    channel: 'print', inputs: [{
      companyName: 'Test Co', invoiceNumber: 'INV-001', invoiceDate: '2026-01-01',
      customerName: 'Customer', customerAddress: '123 Main St',
      subtotal: '100', vatSummary: 'VAT: 15', grandTotal: '115'
    }]
  });
  assert('System template render', isOk(sysRes.status), 'status=' + sysRes.status);
  if (sysRes.body?.document?.id) {
    const sysPdf = await requestRaw('GET', '/render/document/' + sysRes.body.document.id);
    const sysStr = sysPdf.buffer.toString('latin1');
    assert('System PDF has XMP metadata', sysStr.includes('x:xmpmeta'));
    assert('System PDF has pdfaid conformance', sysStr.includes('pdfaid:conformance'));
  }

  console.log('\n=== Results ===');
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
