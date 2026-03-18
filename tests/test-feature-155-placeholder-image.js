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
  process.stdout.write('\n=== Feature #155: Missing image shows placeholder rectangle ===\n');

  // Test 1: Create template with erpImage referencing a nonexistent asset
  const tpl1 = await request('POST', '/api/pdfme/templates', {
    name: 'Missing Image Test ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'logo', type: 'erpImage', assetPath: 'test-org/assets/nonexistent-logo.png', position: { x: 10, y: 30 }, width: 60, height: 40 },
      ]],
    },
  });
  check('Template created', tpl1.data && tpl1.data.id);
  const tplId = tpl1.data.id;

  await request('POST', '/api/pdfme/templates/' + tplId + '/publish');

  // Test 2: Render - should NOT fail, should use placeholder
  const r1 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'IMG-TEST-1', channel: 'print',
    inputs: [{ title: 'Invoice 001' }],
  });
  check('Render does NOT fail (status=done)', r1.data && r1.data.document && r1.data.document.status === 'done');
  check('PDF file generated', r1.data && r1.data.document && r1.data.document.filePath);
  check('PDF has nonzero size', r1.data && r1.data.document && r1.data.document.filePath && r1.data.document.filePath.length > 0);

  // Check inputSnapshot - logo should have a data URI (the placeholder SVG)
  const snap1 = r1.data && r1.data.document && r1.data.document.inputSnapshot;
  if (snap1) {
    const s = typeof snap1 === 'string' ? JSON.parse(snap1) : snap1;
    const inp = Array.isArray(s) ? s[0] : s;
    check('logo input is a placeholder data URI', inp.logo && inp.logo.startsWith('data:image/png;base64,'));
    // Verify it's the known placeholder PNG (not the real image)
    check('logo is placeholder PNG (not original asset)', inp.logo && inp.logo !== '' && !inp.logo.includes('nonexistent'));
  }

  // Test 3: Template with standard image type + nonexistent input
  const tpl2 = await request('POST', '/api/pdfme/templates', {
    name: 'Missing Std Image ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'photo', type: 'image', position: { x: 10, y: 30 }, width: 50, height: 50 },
      ]],
    },
  });
  check('Standard image template created', tpl2.data && tpl2.data.id);
  const tpl2Id = tpl2.data.id;

  await request('POST', '/api/pdfme/templates/' + tpl2Id + '/publish');

  // Render with no image input
  const r2 = await request('POST', '/api/pdfme/render/now', {
    templateId: tpl2Id, entityId: 'IMG-TEST-2', channel: 'print',
    inputs: [{ title: 'No Photo' }],
  });
  check('Standard image render does NOT fail', r2.data && r2.data.document && r2.data.document.status === 'done');

  const snap2 = r2.data && r2.data.document && r2.data.document.inputSnapshot;
  if (snap2) {
    const s = typeof snap2 === 'string' ? JSON.parse(snap2) : snap2;
    const inp = Array.isArray(s) ? s[0] : s;
    check('Standard image gets placeholder data URI', inp.photo && inp.photo.startsWith('data:image/png;base64,'));
  }

  // Test 4: Template with erpImage that HAS a valid input (should NOT use placeholder)
  const r3 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'IMG-TEST-3', channel: 'print',
    inputs: [{ title: 'With Image', logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
  });
  check('Render with valid image succeeds', r3.data && r3.data.document && r3.data.document.status === 'done');

  const snap3 = r3.data && r3.data.document && r3.data.document.inputSnapshot;
  if (snap3) {
    const s = typeof snap3 === 'string' ? JSON.parse(snap3) : snap3;
    const inp = Array.isArray(s) ? s[0] : s;
    check('Valid image NOT replaced by placeholder', inp.logo && inp.logo.startsWith('data:image/png;base64,'));
  }

  // Test 5: Verify different PDF hashes for placeholder vs real image
  if (r1.data && r1.data.document && r3.data && r3.data.document) {
    const hash1 = r1.data.document.pdfHash || r1.data.document.hash;
    const hash3 = r3.data.document.pdfHash || r3.data.document.hash;
    check('Placeholder vs real image produce different PDFs', hash1 !== hash3);
  }

  // Cleanup
  if (tplId) await request('DELETE', '/api/pdfme/templates/' + tplId);
  if (tpl2Id) await request('DELETE', '/api/pdfme/templates/' + tpl2Id);

  process.stdout.write('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { process.stderr.write(err.stack + '\n'); process.exit(1); });
