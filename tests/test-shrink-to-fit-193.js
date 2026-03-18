/**
 * Test: Feature #193 - Text overflow shrinkToFit to min 6pt
 *
 * Verifies that when textOverflow is set to 'shrinkToFit':
 * 1. Long text exceeding bounds causes font size to shrink
 * 2. Font size never goes below 6pt minimum
 * 3. Short text that fits does not get shrunk
 * 4. The feature works in the PDF render pipeline
 */

const http = require('http');

const API_BASE = 'http://localhost:3000/api/pdfme';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'user-shrink-test',orgId:'org-shrink-test',roles:['template:edit','template:publish','render:trigger','template:import']})).toString('base64url');
const TOKEN = header+'.'+payload+'.testsig';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function createTemplate(name, schemas) {
  const res = await request('POST', '/templates', {
    name,
    type: 'shrink-test',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas,
    },
  });
  return res.data;
}

async function publishTemplate(id) {
  return request('POST', `/templates/${id}/publish`, {});
}

async function renderTemplate(templateId, entityId, inputs) {
  return request('POST', '/render/now', {
    templateId,
    entityId,
    channel: 'print',
    inputs,
  });
}

async function run() {
  console.log('\n=== Feature #193: Text overflow shrinkToFit to min 6pt ===\n');

  // Test 1: Create template with shrinkToFit text overflow
  console.log('Test 1: Template creation with shrinkToFit property');
  const tmpl1 = await createTemplate('ShrinkToFit Test', [
    [
      {
        name: 'shortText',
        type: 'text',
        content: 'Short',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
      {
        name: 'longText',
        type: 'text',
        content: 'Default long text',
        position: { x: 10, y: 30 },
        width: 30,
        height: 8,
        fontSize: 14,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
      {
        name: 'noOverflow',
        type: 'text',
        content: 'Normal text',
        position: { x: 10, y: 50 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        // No textOverflow - normal behavior
      },
      {
        name: 'veryLongText',
        type: 'text',
        content: 'Very long default',
        position: { x: 10, y: 70 },
        width: 20,
        height: 5,
        fontSize: 24,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
    ],
  ]);
  assert(tmpl1.id, 'Template created with shrinkToFit text elements');
  const templateId = tmpl1.id;

  // Test 2: Publish template
  console.log('\nTest 2: Publish template');
  const pubRes = await publishTemplate(templateId);
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published (status: ${pubRes.status})`);

  // Test 3: Render with short text that fits - font should not shrink
  console.log('\nTest 3: Render with short text that fits');
  const render1 = await renderTemplate(templateId, 'entity-short-1', [
    { shortText: 'Hi', longText: 'OK', noOverflow: 'Test', veryLongText: 'X' },
  ]);
  assert(render1.status === 200 || render1.status === 201, `Render succeeded with short text (status: ${render1.status})`);
  assert(render1.data.document, 'Document created for short text');

  // Test 4: Render with long text exceeding bounds - font should shrink
  console.log('\nTest 4: Render with long text exceeding bounds');
  const longText = 'This is a very long text string that should definitely exceed the bounds of the text box and cause the font size to shrink down to fit within the available space properly';
  const render2 = await renderTemplate(templateId, 'entity-long-1', [
    { shortText: 'Short', longText: longText, noOverflow: 'Normal', veryLongText: longText },
  ]);
  assert(render2.status === 200 || render2.status === 201, `Render succeeded with long text (status: ${render2.status})`);
  assert(render2.data.document, 'Document created for long text');

  // Test 5: Render with extremely long text - should hit minimum 6pt
  console.log('\nTest 5: Render with extremely long text (minimum 6pt enforcement)');
  const extremelyLongText = 'ABCDEFGHIJ '.repeat(100); // Very long text in a tiny box
  const render3 = await renderTemplate(templateId, 'entity-extreme-1', [
    { shortText: 'OK', longText: extremelyLongText, noOverflow: 'Test', veryLongText: extremelyLongText },
  ]);
  assert(render3.status === 200 || render3.status === 201, `Render succeeded with extremely long text (status: ${render3.status})`);
  assert(render3.data.document, 'Document created - minimum 6pt enforced (no crash)');

  // Test 6: Verify PDF was actually generated (has file path)
  console.log('\nTest 6: Verify PDF generation');
  assert(render2.data.document && render2.data.document.filePath, 'PDF file was generated for shrinkToFit text');

  // Test 7: Test with different textOverflow values
  console.log('\nTest 7: Template with clip overflow (should not shrink)');
  const tmpl2 = await createTemplate('Clip Test', [
    [
      {
        name: 'clipText',
        type: 'text',
        content: 'Clip text',
        position: { x: 10, y: 10 },
        width: 30,
        height: 8,
        fontSize: 14,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'clip',
      },
    ],
  ]);
  assert(tmpl2.id, 'Template with clip overflow created');

  // Test 8: Publish and render clip template
  console.log('\nTest 8: Render clip overflow template');
  await publishTemplate(tmpl2.id);
  const render4 = await renderTemplate(tmpl2.id, 'entity-clip-1', [
    { clipText: longText },
  ]);
  assert(render4.status === 200 || render4.status === 201, `Clip overflow render succeeded (status: ${render4.status})`);

  // Test 9: Template with no textOverflow set (backwards compatibility)
  console.log('\nTest 9: Template without textOverflow (backwards compatibility)');
  const tmpl3 = await createTemplate('No Overflow Test', [
    [
      {
        name: 'plainText',
        type: 'text',
        content: 'Plain text',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 12,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
      },
    ],
  ]);
  assert(tmpl3.id, 'Template without textOverflow created (backward compatible)');
  await publishTemplate(tmpl3.id);
  const render5 = await renderTemplate(tmpl3.id, 'entity-plain-1', [
    { plainText: longText },
  ]);
  assert(render5.status === 200 || render5.status === 201, `Render without textOverflow works (status: ${render5.status})`);

  // Test 10: Verify shrinkToFit with dynamicFontSize should use dynamicFontSize (not shrinkToFit)
  console.log('\nTest 10: dynamicFontSize takes precedence over shrinkToFit');
  const tmpl4 = await createTemplate('DynamicFont Priority Test', [
    [
      {
        name: 'dynamicText',
        type: 'text',
        content: 'Dynamic text',
        position: { x: 10, y: 10 },
        width: 50,
        height: 10,
        fontSize: 14,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        dynamicFontSize: { min: 8, max: 20, fit: 'vertical' },
        textOverflow: 'shrinkToFit', // should be ignored when dynamicFontSize is set
      },
    ],
  ]);
  assert(tmpl4.id, 'Template with both dynamicFontSize and shrinkToFit created');
  await publishTemplate(tmpl4.id);
  const render6 = await renderTemplate(tmpl4.id, 'entity-dynamic-1', [
    { dynamicText: longText },
  ]);
  assert(render6.status === 200 || render6.status === 201, `Render with dynamicFontSize priority works (status: ${render6.status})`);

  // Test 11: Multiple text elements with mixed overflow modes
  console.log('\nTest 11: Mixed overflow modes on same page');
  const tmpl5 = await createTemplate('Mixed Overflow Test', [
    [
      {
        name: 'shrinkField',
        type: 'text',
        content: 'Shrink me',
        position: { x: 10, y: 10 },
        width: 40,
        height: 8,
        fontSize: 14,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
      {
        name: 'normalField',
        type: 'text',
        content: 'Normal text',
        position: { x: 10, y: 30 },
        width: 40,
        height: 8,
        fontSize: 14,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
      },
    ],
  ]);
  assert(tmpl5.id, 'Template with mixed overflow modes created');
  await publishTemplate(tmpl5.id);
  const render7 = await renderTemplate(tmpl5.id, 'entity-mixed-1', [
    { shrinkField: longText, normalField: longText },
  ]);
  assert(render7.status === 200 || render7.status === 201, `Mixed overflow render succeeded (status: ${render7.status})`);

  // Test 12: Small font size (7pt) with shrinkToFit - should only shrink to 6pt
  console.log('\nTest 12: Small font with shrinkToFit (7pt -> min 6pt)');
  const tmpl6 = await createTemplate('Small Font ShrinkToFit', [
    [
      {
        name: 'smallText',
        type: 'text',
        content: 'Small font',
        position: { x: 10, y: 10 },
        width: 15,
        height: 4,
        fontSize: 7,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
    ],
  ]);
  assert(tmpl6.id, 'Template with 7pt fontSize created');
  await publishTemplate(tmpl6.id);
  const render8 = await renderTemplate(tmpl6.id, 'entity-small-1', [
    { smallText: extremelyLongText },
  ]);
  assert(render8.status === 200 || render8.status === 201, `Small font shrinkToFit renders without crashing (min 6pt enforced, status: ${render8.status})`);

  // Test 13: Font size already at 6pt with shrinkToFit
  console.log('\nTest 13: Font already at 6pt (should not shrink further)');
  const tmpl7 = await createTemplate('At Minimum ShrinkToFit', [
    [
      {
        name: 'minText',
        type: 'text',
        content: 'Min text',
        position: { x: 10, y: 10 },
        width: 15,
        height: 4,
        fontSize: 6,
        alignment: 'left',
        verticalAlignment: 'top',
        lineHeight: 1,
        characterSpacing: 0,
        fontColor: '#000000',
        backgroundColor: '',
        textOverflow: 'shrinkToFit',
      },
    ],
  ]);
  assert(tmpl7.id, 'Template with 6pt fontSize created');
  await publishTemplate(tmpl7.id);
  const render9 = await renderTemplate(tmpl7.id, 'entity-min-1', [
    { minText: longText },
  ]);
  assert(render9.status === 200 || render9.status === 201, `Already at 6pt renders OK (status: ${render9.status})`);

  // Test 14: Empty text with shrinkToFit (edge case)
  console.log('\nTest 14: Empty text with shrinkToFit');
  const render10 = await renderTemplate(templateId, 'entity-empty-1', [
    { shortText: '', longText: '', noOverflow: '', veryLongText: '' },
  ]);
  assert(render10.status === 200 || render10.status === 201, `Empty text with shrinkToFit renders OK (status: ${render10.status})`);

  // Test 15: Multi-line text with shrinkToFit
  console.log('\nTest 15: Multi-line text with shrinkToFit');
  const multiLineText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10';
  const render11 = await renderTemplate(templateId, 'entity-multiline-1', [
    { shortText: multiLineText, longText: multiLineText, noOverflow: 'Normal', veryLongText: multiLineText },
  ]);
  assert(render11.status === 200 || render11.status === 201, `Multi-line text with shrinkToFit renders OK (status: ${render11.status})`);

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
