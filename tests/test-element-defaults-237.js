/**
 * Feature #237: Designer new element has default properties
 * New elements have sensible default position/size
 *
 * Since browser automation is unavailable (headless server),
 * we verify through:
 * 1. SSR HTML output contains correct default element blocks
 * 2. API verification that templates with default elements work
 * 3. Code structure verification of defaults
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE_API = 'http://localhost:3000';
const BASE_UI = 'http://localhost:3001';
const ORG_ID = 'org-defaults-237';

const token = signJwt({ sub: 'defaults-user-237', orgId: ORG_ID, roles: ['template:edit', 'template:publish'] });
const fs = require('fs');
const path = require('path');

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, BASE_API);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function uiRequest(uiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(uiPath, BASE_UI);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
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

async function run() {
  console.log('Feature #237: Designer new element has default properties\n');

  // ─── Part 1: Verify getDefaultElement function in source code ───
  console.log('Part 1: Verify getDefaultElement provides sensible defaults');

  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const designerSrc = fs.readFileSync(designerPath, 'utf-8');

  // Check that getDefaultElement function exists
  assert(designerSrc.includes('function getDefaultElement(type: ElementType)'), 'getDefaultElement function exists');

  // Verify text defaults
  const textDefaults = designerSrc.match(/case 'text':\s*return \{[^}]+\}/s);
  assert(textDefaults !== null, 'Text element has defined defaults');
  if (textDefaults) {
    const textStr = textDefaults[0];
    assert(textStr.includes('w: 200'), 'Text default width is 200');
    assert(textStr.includes('h: 24'), 'Text default height is 24');
    assert(textStr.includes("fontFamily: 'Helvetica'"), 'Text default font is Helvetica');
    assert(textStr.includes('fontSize: 14'), 'Text default fontSize is 14');
    assert(textStr.includes("textAlign: 'left'"), 'Text default textAlign is left');
    assert(textStr.includes("color: '#000000'"), 'Text default color is black');
    assert(textStr.includes("fontWeight: 'normal'"), 'Text default fontWeight is normal');
    assert(textStr.includes('lineHeight: 1.4'), 'Text default lineHeight is 1.4');
  }

  // Verify image defaults
  const imageDefaults = designerSrc.match(/case 'image':\s*return \{[^}]+\}/s);
  assert(imageDefaults !== null, 'Image element has defined defaults');
  if (imageDefaults) {
    const imgStr = imageDefaults[0];
    assert(imgStr.includes('w: 150'), 'Image default width is 150');
    assert(imgStr.includes('h: 100'), 'Image default height is 100');
    assert(imgStr.includes("objectFit: 'contain'"), 'Image default objectFit is contain');
    assert(imgStr.includes('opacity: 100'), 'Image default opacity is 100');
  }

  // Verify signature defaults
  const sigDefaults = designerSrc.match(/case 'signature':\s*return \{[^}]+\}/s);
  assert(sigDefaults !== null, 'Signature element has defined defaults');
  if (sigDefaults) {
    const sigStr = sigDefaults[0];
    assert(sigStr.includes('w: 200'), 'Signature default width is 200');
    assert(sigStr.includes('h: 60'), 'Signature default height is 60');
  }

  // Verify line-items table defaults (complex nested object, search by line)
  const litLineIndex = designerSrc.indexOf("case 'line-items':");
  assert(litLineIndex !== -1, 'Line items table has defined defaults');
  if (litLineIndex !== -1) {
    const litSection = designerSrc.substring(litLineIndex, litLineIndex + 500);
    assert(litSection.includes('w: 495'), 'Line items default width is 495 (near page width)');
    assert(litSection.includes('h: 200'), 'Line items default height is 200');
    assert(litSection.includes('showHeader: true'), 'Line items showHeader defaults to true');
    assert(litSection.includes("borderStyle: 'solid'"), 'Line items borderStyle defaults to solid');
  }

  // Verify base position
  assert(designerSrc.includes('const base = { type, x: 50, y: 50 }'), 'Base element position is (50, 50)');

  // Verify watermark defaults
  const wmDefaults = designerSrc.match(/case 'watermark':\s*return \{[^}]+\}/s);
  assert(wmDefaults !== null, 'Watermark element has defined defaults');
  if (wmDefaults) {
    const wmStr = wmDefaults[0];
    assert(wmStr.includes("content: 'DRAFT'"), 'Watermark default text is DRAFT');
    assert(wmStr.includes('fontSize: 72'), 'Watermark default fontSize is 72');
  }

  // Verify calculated field defaults
  const calcDefaults = designerSrc.match(/case 'calculated':\s*return \{[^}]+\}/s);
  assert(calcDefaults !== null, 'Calculated field has defined defaults');
  if (calcDefaults) {
    const calcStr = calcDefaults[0];
    assert(calcStr.includes("textAlign: 'right'"), 'Calculated field default align is right (for numbers)');
    assert(calcStr.includes("content: '0.00'"), 'Calculated field default content is 0.00');
  }

  // Verify QR barcode defaults
  const qrDefaults = designerSrc.match(/case 'qr-barcode':\s*return \{[^}]+\}/s);
  assert(qrDefaults !== null, 'QR barcode has defined defaults');
  if (qrDefaults) {
    const qrStr = qrDefaults[0];
    assert(qrStr.includes('w: 80'), 'QR default width is 80');
    assert(qrStr.includes('h: 80'), 'QR default height is 80 (square)');
  }

  // Verify addElementToCanvas sets additional defaults
  console.log('\nPart 1b: Verify addElementToCanvas sets additional defaults');
  assert(designerSrc.includes("pageScope: 'all'"), 'New elements default pageScope to all');
  assert(designerSrc.includes("outputChannel: 'both'"), 'New elements default outputChannel to both');
  assert(designerSrc.includes("conditionalVisibility: 'always'"), 'New elements default conditionalVisibility to always');

  // Verify offset stacking logic
  assert(designerSrc.includes('const offset = existingCount * 20'), 'Elements offset by 20px to avoid stacking');

  // ─── Part 2: Verify designer UI renders block types ───
  console.log('\nPart 2: Verify designer UI renders draggable blocks');
  const uiRes = await uiRequest('/');
  assert(uiRes.status === 200, `Designer UI loads (status ${uiRes.status})`);

  // Verify block types are in the HTML
  assert(uiRes.body.includes('data-testid="block-text"'), 'Text block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-image"'), 'Image block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-signature"'), 'Signature block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-line-items"'), 'Line items block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-qr-barcode"'), 'QR barcode block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-watermark"'), 'Watermark block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-calculated"'), 'Calculated block rendered in UI');
  assert(uiRes.body.includes('data-testid="block-rich-text"'), 'Rich text block rendered in UI');
  assert(uiRes.body.includes('draggable="true"'), 'Blocks are draggable');

  // ─── Part 3: Verify templates with default-style elements work via API ───
  console.log('\nPart 3: Verify template with default elements works via API');

  // Create template with elements at default positions/sizes
  const createRes = await apiRequest('POST', '/api/pdfme/templates', {
    name: 'Default Elements Test 237',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 50, y: 50 }, width: 200, height: 24 },
        { name: 'amount', type: 'text', position: { x: 50, y: 80 }, width: 120, height: 24 },
      ]],
      columns: ['title', 'amount'],
    },
  });
  assert(createRes.status === 201, `Template with default-positioned elements created`);
  const templateId = createRes.body.id;

  // Verify the template can be fetched with defaults preserved
  const getRes = await apiRequest('GET', `/api/pdfme/templates/${templateId}`);
  assert(getRes.status === 200, 'Template retrieved successfully');
  const schema = getRes.body.schema;
  assert(schema.schemas && schema.schemas[0] && schema.schemas[0].length === 2, 'Schema has 2 elements');

  const elem1 = schema.schemas[0][0];
  assert(elem1.position.x === 50, `Element 1 x position preserved: ${elem1.position.x}`);
  assert(elem1.position.y === 50, `Element 1 y position preserved: ${elem1.position.y}`);
  assert(elem1.width === 200, `Element 1 width preserved: ${elem1.width}`);
  assert(elem1.height === 24, `Element 1 height preserved: ${elem1.height}`);

  // Verify preview works with default-positioned elements
  const previewRes = await apiRequest('POST', `/api/pdfme/templates/${templateId}/preview`, { channel: 'print' });
  assert(previewRes.status === 201 || previewRes.status === 200, `Preview with default elements succeeds (${previewRes.status})`);

  // ─── Part 4: Verify default element falls back for unknown types ───
  console.log('\nPart 4: Verify default fallback for unknown element types');
  const defaultMatch = designerSrc.match(/default:\s*return \{[^}]+\}/s);
  assert(defaultMatch !== null, 'Default case exists for unknown types');
  if (defaultMatch) {
    const defStr = defaultMatch[0];
    assert(defStr.includes('w: 100'), 'Default fallback width is 100');
    assert(defStr.includes('h: 40'), 'Default fallback height is 40');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
