/**
 * Feature #385: PDF/UA tagging optional per-org
 *
 * Tests:
 * 1. Enable PDF/UA for test org
 * 2. Render document
 * 3. Verify accessibility tags in PDF output
 * 4. Disable PDF/UA
 * 5. Render again - no tags
 */

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

const ORG_ID = 'org-pdfua-385b';
const TOKEN = makeToken('test-user-385', ORG_ID);

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

function requestWithToken(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
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

let passed = 0, failed = 0, total = 0;
function assert(name, condition, detail) {
  total++;
  if (condition) { passed++; console.log('PASS: ' + name); }
  else { failed++; console.log('FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

async function run() {
  console.log('=== Feature #385: PDF/UA tagging optional per-org ===\n');

  // --- Phase 1: Get default org settings (PDF/UA should be off by default) ---
  console.log('--- Phase 1: Default org settings ---');
  const defaultSettings = await request('GET', '/org-settings');
  assert('GET /org-settings returns 200', defaultSettings.status === 200, 'got ' + defaultSettings.status);
  assert('Default orgId matches', defaultSettings.body.orgId === ORG_ID, 'got ' + defaultSettings.body.orgId);
  assert('Default pdfUA is false', defaultSettings.body.settings && defaultSettings.body.settings.pdfUA === false, 'got ' + JSON.stringify(defaultSettings.body.settings));
  assert('Default pdfA is true', defaultSettings.body.settings && defaultSettings.body.settings.pdfA === true, 'got ' + JSON.stringify(defaultSettings.body.settings));

  // --- Phase 2: Create a template for rendering ---
  console.log('\n--- Phase 2: Create and publish template ---');
  const templatePayload = {
    name: 'UA Test Invoice 385b',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'title',
              type: 'text',
              content: 'Invoice',
              position: { x: 20, y: 20 },
              width: 100,
              height: 15,
              fontSize: 18,
            },
            {
              name: 'invoiceNumber',
              type: 'text',
              content: '{invoiceNumber}',
              position: { x: 20, y: 45 },
              width: 100,
              height: 10,
            },
            {
              name: 'amount',
              type: 'text',
              content: '{amount}',
              position: { x: 20, y: 60 },
              width: 80,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createRes = await request('POST', '/templates', templatePayload);
  assert('Template created', createRes.status === 201 || createRes.status === 200, 'got ' + createRes.status);
  const templateId = createRes.body && createRes.body.id;

  const publishRes = await request('POST', '/templates/' + templateId + '/publish');
  assert('Template published', publishRes.status === 200 || publishRes.status === 201, 'got ' + publishRes.status);

  // --- Phase 3: Render WITHOUT PDF/UA (default off) ---
  console.log('\n--- Phase 3: Render without PDF/UA (default) ---');
  const renderNoUA = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-no-ua-385b',
    channel: 'email',
    inputs: [{ invoiceNumber: 'INV-NO-UA-001', amount: 'R 1,500.00' }]
  });
  assert('Render without UA succeeds', renderNoUA.status === 200 || renderNoUA.status === 201, 'got ' + renderNoUA.status);
  const docNoUA = renderNoUA.body && renderNoUA.body.document;
  assert('Document created without UA', !!(docNoUA && docNoUA.id), 'no document id');

  // Validate PDF/UA tags via API (should be absent)
  const validateNoUA = await request('POST', '/render/validate-pdfua', { documentId: docNoUA.id });
  assert('Validate no-UA returns 200', validateNoUA.status === 200 || validateNoUA.status === 201, 'got ' + validateNoUA.status);
  assert('PDF without UA: no MarkInfo', validateNoUA.body.hasMarkInfo === false, 'hasMarkInfo=' + validateNoUA.body.hasMarkInfo);
  assert('PDF without UA: no StructTreeRoot', validateNoUA.body.hasStructTreeRoot === false, 'hasStructTreeRoot=' + validateNoUA.body.hasStructTreeRoot);
  // Note: Lang may be present from PDF/A conversion; the key UA markers are MarkInfo and StructTreeRoot
  assert('PDF without UA: not valid UA', validateNoUA.body.valid === false, 'valid=' + validateNoUA.body.valid);

  // --- Phase 4: Enable PDF/UA for this org ---
  console.log('\n--- Phase 4: Enable PDF/UA ---');
  const enableUA = await request('PUT', '/org-settings', { pdfUA: true });
  assert('PUT /org-settings returns 200', enableUA.status === 200, 'got ' + enableUA.status);
  assert('pdfUA now true', enableUA.body.settings && enableUA.body.settings.pdfUA === true, 'got ' + JSON.stringify(enableUA.body.settings));
  assert('Update message present', enableUA.body.message === 'Settings updated successfully');

  // Verify settings persisted
  const checkSettings = await request('GET', '/org-settings');
  assert('GET confirms pdfUA enabled', checkSettings.body.settings && checkSettings.body.settings.pdfUA === true, 'got ' + JSON.stringify(checkSettings.body.settings));

  // --- Phase 5: Render WITH PDF/UA ---
  console.log('\n--- Phase 5: Render with PDF/UA enabled ---');
  const renderWithUA = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-with-ua-385b',
    channel: 'email',
    inputs: [{ invoiceNumber: 'INV-UA-001', amount: 'R 2,500.00' }]
  });
  assert('Render with UA succeeds', renderWithUA.status === 200 || renderWithUA.status === 201, 'got ' + renderWithUA.status);
  const docWithUA = renderWithUA.body && renderWithUA.body.document;
  assert('Document created with UA', !!(docWithUA && docWithUA.id), 'no document id');

  // Validate PDF/UA tags via API (should be present)
  const validateWithUA = await request('POST', '/render/validate-pdfua', { documentId: docWithUA.id });
  assert('Validate with-UA returns 200', validateWithUA.status === 200 || validateWithUA.status === 201, 'got ' + validateWithUA.status);
  console.log('  UA validation result:', JSON.stringify(validateWithUA.body));
  assert('PDF with UA has MarkInfo', validateWithUA.body.hasMarkInfo === true, 'hasMarkInfo=' + validateWithUA.body.hasMarkInfo);
  assert('PDF with UA has StructTreeRoot', validateWithUA.body.hasStructTreeRoot === true, 'hasStructTreeRoot=' + validateWithUA.body.hasStructTreeRoot);
  assert('PDF with UA has Lang', validateWithUA.body.hasLang === true, 'hasLang=' + validateWithUA.body.hasLang);
  assert('PDF with UA has DisplayDocTitle', validateWithUA.body.hasDisplayDocTitle === true, 'hasDisplayDocTitle=' + validateWithUA.body.hasDisplayDocTitle);
  assert('PDF with UA has pdfuaid:part in XMP', validateWithUA.body.hasPdfUAIdentifier === true, 'hasPdfUAIdentifier=' + validateWithUA.body.hasPdfUAIdentifier);
  assert('PDF with UA is valid', validateWithUA.body.valid === true, 'valid=' + validateWithUA.body.valid + ' errors=' + JSON.stringify(validateWithUA.body.errors));

  // --- Phase 6: Disable PDF/UA ---
  console.log('\n--- Phase 6: Disable PDF/UA ---');
  const disableUA = await request('PUT', '/org-settings', { pdfUA: false });
  assert('Disable pdfUA succeeds', disableUA.status === 200, 'got ' + disableUA.status);
  assert('pdfUA now false', disableUA.body.settings && disableUA.body.settings.pdfUA === false, 'got ' + JSON.stringify(disableUA.body.settings));

  // --- Phase 7: Render AFTER disabling PDF/UA ---
  console.log('\n--- Phase 7: Render after disabling PDF/UA ---');
  const renderAfterDisable = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-after-disable-385b',
    channel: 'print',
    inputs: [{ invoiceNumber: 'INV-DISABLED-001', amount: 'R 3,000.00' }]
  });
  assert('Render after disable succeeds', renderAfterDisable.status === 200 || renderAfterDisable.status === 201, 'got ' + renderAfterDisable.status);
  const docAfterDisable = renderAfterDisable.body && renderAfterDisable.body.document;
  assert('Document created after disable', !!(docAfterDisable && docAfterDisable.id), 'no document id');

  // Validate - should have NO UA tags
  const validateAfterDisable = await request('POST', '/render/validate-pdfua', { documentId: docAfterDisable.id });
  assert('PDF after disable: no MarkInfo', validateAfterDisable.body.hasMarkInfo === false, 'hasMarkInfo=' + validateAfterDisable.body.hasMarkInfo);
  assert('PDF after disable: no StructTreeRoot', validateAfterDisable.body.hasStructTreeRoot === false, 'hasStructTreeRoot=' + validateAfterDisable.body.hasStructTreeRoot);
  assert('PDF after disable: not valid UA', validateAfterDisable.body.valid === false, 'valid=' + validateAfterDisable.body.valid);

  // --- Phase 8: Settings reset endpoint ---
  console.log('\n--- Phase 8: Reset settings ---');
  await request('PUT', '/org-settings', { pdfUA: true });
  const beforeReset = await request('GET', '/org-settings');
  assert('UA enabled before reset', beforeReset.body.settings && beforeReset.body.settings.pdfUA === true);

  const resetRes = await request('POST', '/org-settings/reset');
  assert('Reset returns 200/201', resetRes.status === 200 || resetRes.status === 201, 'got ' + resetRes.status);
  assert('After reset pdfUA is false', resetRes.body.settings && resetRes.body.settings.pdfUA === false, 'got ' + JSON.stringify(resetRes.body.settings));
  assert('After reset pdfA is true', resetRes.body.settings && resetRes.body.settings.pdfA === true, 'got ' + JSON.stringify(resetRes.body.settings));

  // --- Phase 9: Settings validation ---
  console.log('\n--- Phase 9: Settings validation ---');
  const invalidUA = await request('PUT', '/org-settings', { pdfUA: 'yes' });
  assert('Invalid pdfUA type rejected', invalidUA.status === 400, 'got ' + invalidUA.status);

  const invalidPdfA = await request('PUT', '/org-settings', { pdfA: 123 });
  assert('Invalid pdfA type rejected', invalidPdfA.status === 400, 'got ' + invalidPdfA.status);

  // --- Phase 10: Different orgs have independent settings ---
  console.log('\n--- Phase 10: Multi-org isolation ---');
  const ORG2 = 'org-pdfua-385b-other';
  const TOKEN2 = makeToken('test-user-385-other', ORG2);

  // Enable UA for org1 but not org2
  await request('PUT', '/org-settings', { pdfUA: true });
  const org1Settings = await request('GET', '/org-settings');
  const org2Settings = await requestWithToken('GET', '/org-settings', null, TOKEN2);
  assert('Org1 has pdfUA enabled', org1Settings.body.settings && org1Settings.body.settings.pdfUA === true);
  assert('Org2 has pdfUA disabled (default)', org2Settings.body.settings && org2Settings.body.settings.pdfUA === false, 'got ' + JSON.stringify(org2Settings.body.settings));

  // --- Phase 11: Print channel also gets UA tags when enabled ---
  console.log('\n--- Phase 11: Print channel with UA ---');
  const renderPrintUA = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-print-ua-385b',
    channel: 'print',
    inputs: [{ invoiceNumber: 'INV-PRINT-UA', amount: 'R 4,000.00' }]
  });
  assert('Print render with UA succeeds', renderPrintUA.status === 200 || renderPrintUA.status === 201, 'got ' + renderPrintUA.status);
  if (renderPrintUA.body && renderPrintUA.body.document && renderPrintUA.body.document.id) {
    const validatePrint = await request('POST', '/render/validate-pdfua', { documentId: renderPrintUA.body.document.id });
    assert('Print PDF has UA tags (MarkInfo)', validatePrint.body.hasMarkInfo === true, 'hasMarkInfo=' + validatePrint.body.hasMarkInfo);
    assert('Print PDF has UA tags (StructTreeRoot)', validatePrint.body.hasStructTreeRoot === true, 'hasStructTreeRoot=' + validatePrint.body.hasStructTreeRoot);
    assert('Print PDF is valid UA', validatePrint.body.valid === true, 'valid=' + validatePrint.body.valid);
  } else {
    assert('Print PDF has UA tags (MarkInfo)', false, 'no document');
    assert('Print PDF has UA tags (StructTreeRoot)', false, 'no document');
    assert('Print PDF is valid UA', false, 'no document');
  }

  // --- Summary ---
  console.log('\n=== Results: ' + passed + '/' + total + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
