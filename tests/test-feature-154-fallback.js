const http = require('http');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';
const BASE = 'http://localhost:3000';

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
  process.stdout.write('\n=== Feature #154: Missing field binding uses fallbackValue ===\n');

  // Test 1: Create template with a field that has fallbackValue='N/A'
  const tpl = await request('POST', '/api/pdfme/templates', {
    name: 'Fallback Test ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'company_name', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'missing_field', type: 'text', position: { x: 10, y: 30 }, width: 100, height: 10, fallbackValue: 'N/A' },
        { name: 'another_missing', type: 'text', position: { x: 10, y: 50 }, width: 100, height: 10, fallbackValue: 'Unknown' },
        { name: 'no_fallback_field', type: 'text', position: { x: 10, y: 70 }, width: 100, height: 10 },
      ]],
    },
  });
  check('Template created', tpl.data && tpl.data.id);
  const tplId = tpl.data.id;

  // Publish the template
  const pub = await request('POST', '/api/pdfme/templates/' + tplId + '/publish');
  check('Template published', pub.status === 200 || pub.status === 201);

  // Test 2: Render with inputs that do NOT include missing_field or another_missing
  // Only provide company_name; missing_field should get 'N/A', another_missing should get 'Unknown'
  const r1 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'TEST-154-1', channel: 'print',
    inputs: [{ company_name: 'Acme Corp' }],
  });
  check('Render succeeded with fallback', r1.data && r1.data.document && r1.data.document.status === 'done');
  check('PDF generated (has filePath)', r1.data && r1.data.document && r1.data.document.filePath);

  // Check inputSnapshot to verify fallback values were applied
  const inputSnapshot = r1.data && r1.data.document && r1.data.document.inputSnapshot;
  if (inputSnapshot) {
    const snap = typeof inputSnapshot === 'string' ? JSON.parse(inputSnapshot) : inputSnapshot;
    const firstInput = Array.isArray(snap) ? snap[0] : snap;
    check('company_name preserved in inputs', firstInput.company_name === 'Acme Corp');
    check('missing_field uses fallbackValue N/A', firstInput.missing_field === 'N/A');
    check('another_missing uses fallbackValue Unknown', firstInput.another_missing === 'Unknown');
    check('no_fallback_field uses empty string', firstInput.no_fallback_field === '');
  } else {
    process.stdout.write('  INFO: No inputSnapshot in response, verifying via PDF hash difference\n');
    // Verify differently: render with inputs to compare PDFs
  }

  // Test 3: Render with empty string for missing_field - fallback should apply
  const r2 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'TEST-154-2', channel: 'print',
    inputs: [{ company_name: 'Acme Corp', missing_field: '', another_missing: '' }],
  });
  check('Render succeeded with empty inputs', r2.data && r2.data.document && r2.data.document.status === 'done');

  const snap2 = r2.data && r2.data.document && r2.data.document.inputSnapshot;
  if (snap2) {
    const s = typeof snap2 === 'string' ? JSON.parse(snap2) : snap2;
    const inp = Array.isArray(s) ? s[0] : s;
    check('empty missing_field gets fallback N/A', inp.missing_field === 'N/A');
    check('empty another_missing gets fallback Unknown', inp.another_missing === 'Unknown');
  }

  // Test 4: Render WITH a provided value - should NOT use fallback
  const r3 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'TEST-154-3', channel: 'print',
    inputs: [{ company_name: 'Acme Corp', missing_field: 'Actual Value', another_missing: 'Real Data' }],
  });
  check('Render succeeded with provided values', r3.data && r3.data.document && r3.data.document.status === 'done');

  const snap3 = r3.data && r3.data.document && r3.data.document.inputSnapshot;
  if (snap3) {
    const s = typeof snap3 === 'string' ? JSON.parse(snap3) : snap3;
    const inp = Array.isArray(s) ? s[0] : s;
    check('provided missing_field NOT overridden by fallback', inp.missing_field === 'Actual Value');
    check('provided another_missing NOT overridden by fallback', inp.another_missing === 'Real Data');
  }

  // Test 5: Render with completely empty inputs (none provided) - all fallbacks should apply
  const r4 = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'TEST-154-4', channel: 'print',
    inputs: [{}],
  });
  check('Render succeeded with no inputs', r4.data && r4.data.document && r4.data.document.status === 'done');

  const snap4 = r4.data && r4.data.document && r4.data.document.inputSnapshot;
  if (snap4) {
    const s = typeof snap4 === 'string' ? JSON.parse(snap4) : snap4;
    const inp = Array.isArray(s) ? s[0] : s;
    check('all-empty: missing_field gets N/A', inp.missing_field === 'N/A');
    check('all-empty: another_missing gets Unknown', inp.another_missing === 'Unknown');
    check('all-empty: company_name gets empty string (no fallback)', inp.company_name === '');
    check('all-empty: no_fallback_field gets empty string', inp.no_fallback_field === '');
  }

  // Test 6: Different PDF hashes prove fallback vs actual value rendering is different
  if (r3.data && r3.data.document && r4.data && r4.data.document) {
    const hash3 = r3.data.document.pdfHash || r3.data.document.hash;
    const hash4 = r4.data.document.pdfHash || r4.data.document.hash;
    check('Actual values vs fallback values produce different PDF hashes', hash3 !== hash4);
  }

  // Clean up test data
  if (tplId) {
    await request('DELETE', '/api/pdfme/templates/' + tplId);
  }

  process.stdout.write('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===\n');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
