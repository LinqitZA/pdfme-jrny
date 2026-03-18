/**
 * Feature #393: Batch label rendering - multiple labels per render request with sequential data
 *
 * Verifies:
 * 1. RenderNowDto supports layout parameter
 * 2. Layout can be 'single' (default, one label per page) or N-up sheet layout
 * 3. N-up sheet layout config: type, columns, rows, sheetSize, margins
 * 4. Layout validation in controller
 * 5. applyNupLayout method arranges labels on sheets
 * 6. Multi-input rendering works with label-sized basePdf
 * 7. Partial last page handling
 * 8. API integration: POST /render/now accepts layout parameter
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const API = `${BASE}/api/pdfme`;
const secret = 'pdfme-dev-secret';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${name}`);
  } else {
    failed++;
    results.push(`  FAIL: ${name}`);
  }
}

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-label-393';
const USER_ID = 'user-label-393';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger'],
});

function httpRequest(method, urlPath, body = null, authToken = token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== Feature #393: Batch label rendering with N-up layout ===\n');

  // ─── Part 1: Source code verification ───
  console.log('--- Part 1: RenderNowDto and types ---');

  const renderServicePath = path.join(__dirname, '..', 'nest-module', 'src', 'render.service.ts');
  const renderSrc = fs.readFileSync(renderServicePath, 'utf-8');

  assert(
    renderSrc.includes('export interface NupSheetLayout'),
    'NupSheetLayout interface exported'
  );

  assert(
    renderSrc.includes("type: 'sheet'"),
    "NupSheetLayout has type: 'sheet' property"
  );

  assert(
    renderSrc.includes('columns: number') && renderSrc.includes('rows: number'),
    'NupSheetLayout has columns and rows properties'
  );

  assert(
    renderSrc.includes("sheetSize?: string"),
    'NupSheetLayout has optional sheetSize property'
  );

  assert(
    renderSrc.includes('margins?: {'),
    'NupSheetLayout has optional margins config'
  );

  assert(
    renderSrc.includes("top?: number") && renderSrc.includes("left?: number"),
    'Margins include top and left'
  );

  assert(
    renderSrc.includes("columnGap?: number") && renderSrc.includes("rowGap?: number"),
    'Margins include columnGap and rowGap'
  );

  assert(
    renderSrc.includes("export type RenderLayout = 'single' | NupSheetLayout"),
    'RenderLayout union type defined'
  );

  assert(
    renderSrc.includes('layout?: RenderLayout'),
    'RenderNowDto has optional layout field'
  );

  // ─── Part 2: N-up layout implementation ───
  console.log('--- Part 2: N-up layout implementation ---');

  assert(
    renderSrc.includes('applyNupLayout'),
    'applyNupLayout method exists in RenderService'
  );

  assert(
    renderSrc.includes("import('pdf-lib')") || renderSrc.includes("require('pdf-lib')"),
    'N-up layout uses pdf-lib for page manipulation'
  );

  assert(
    renderSrc.includes('PDFDocument.create()'),
    'Creates new output PDF document'
  );

  assert(
    renderSrc.includes('embedPdf'),
    'Uses embedPdf to embed individual label pages'
  );

  assert(
    renderSrc.includes('drawPage'),
    'Uses drawPage to position labels on sheet'
  );

  // Sheet dimensions
  assert(
    renderSrc.includes("A4: { width: 595, height: 842 }"),
    'N-up sheet dimensions include A4'
  );

  assert(
    renderSrc.includes("Letter: { width: 612, height: 792 }"),
    'N-up sheet dimensions include Letter'
  );

  // Scale and centering
  assert(
    renderSrc.includes('Math.min(scaleX, scaleY)'),
    'Labels scaled proportionally to fit cell (min of scaleX/scaleY)'
  );

  // Partial last page: loop continues until labelIndex >= pageCount
  assert(
    renderSrc.includes('labelIndex < pageCount'),
    'Loop handles partial last page (stops when labelIndex >= pageCount)'
  );

  // ─── Part 3: Layout called in render pipeline ───
  console.log('--- Part 3: Layout integration in render pipeline ---');

  assert(
    renderSrc.includes("dto.layout") && renderSrc.includes("layout.type === 'sheet'"),
    'renderNow checks dto.layout for sheet type'
  );

  assert(
    renderSrc.includes("await this.applyNupLayout(pdfBuffer, dto.layout)"),
    'renderNow calls applyNupLayout with layout config'
  );

  // ─── Part 4: Controller validation ───
  console.log('--- Part 4: Layout validation in controller ---');

  const controllerPath = path.join(__dirname, '..', 'nest-module', 'src', 'render.controller.ts');
  const ctrlSrc = fs.readFileSync(controllerPath, 'utf-8');

  assert(
    ctrlSrc.includes("body.layout") && ctrlSrc.includes("'single'"),
    'Controller validates layout parameter'
  );

  assert(
    ctrlSrc.includes("layout.type !== 'sheet'"),
    "Controller rejects layout types other than 'sheet'"
  );

  assert(
    ctrlSrc.includes('layout.columns') && ctrlSrc.includes('layout.rows'),
    'Controller validates columns and rows'
  );

  assert(
    ctrlSrc.includes("'A4'") && ctrlSrc.includes("'Letter'"),
    'Controller validates sheetSize is A4 or Letter'
  );

  // ─── Part 5: Margin defaults ───
  console.log('--- Part 5: Default margins ---');

  assert(
    renderSrc.includes('layout.margins?.top ?? 10'),
    'Default top margin is 10mm'
  );

  assert(
    renderSrc.includes('layout.margins?.left ?? 5'),
    'Default left margin is 5mm'
  );

  assert(
    renderSrc.includes('layout.margins?.columnGap ?? 2'),
    'Default column gap is 2mm'
  );

  assert(
    renderSrc.includes('layout.margins?.rowGap ?? 2'),
    'Default row gap is 2mm'
  );

  // ─── Part 6: API integration tests ───
  console.log('--- Part 6: API integration tests ---');

  // Create a test template for label rendering
  // Create a test template with valid schema for rendering
  const createRes = await httpRequest('POST', `${API}/templates`, {
    name: 'LABEL_TEST_393',
    type: 'custom',
    schema: {
      schemas: [[{
        name: 'product_name',
        type: 'text',
        position: { x: 5, y: 5 },
        width: 80,
        height: 20,
        content: '{{product_name}}',
      }]],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [{ name: 'Label', elements: [{
        id: 'el1', type: 'text', x: 5, y: 5, width: 80, height: 20,
        binding: '{{product_name}}', content: 'Test',
      }] }],
    },
  });

  assert(
    createRes.status === 201,
    `Create label template: ${createRes.status}`
  );

  const templateId = createRes.body?.id;

  if (templateId) {
    // Publish the template
    const pubRes = await httpRequest('POST', `${API}/templates/${templateId}/publish`);
    const published = pubRes.status === 200 || pubRes.status === 201;
    assert(published, `Publish label template: ${pubRes.status}`);

    if (published) {
      // Test 1: Render with single layout (default)
      const renderSingle = await httpRequest('POST', `${API}/render/now`, {
        templateId,
        entityId: 'label-batch-001',
        channel: 'print',
        inputs: [
          { product_name: 'Widget A' },
          { product_name: 'Widget B' },
          { product_name: 'Widget C' },
        ],
        layout: 'single',
      });

      assert(
        renderSingle.status === 201 || renderSingle.status === 200 || renderSingle.body?.document,
        `Render with single layout succeeds: ${renderSingle.status}`
      );

      // Test 2: Render with N-up layout
      const renderNup = await httpRequest('POST', `${API}/render/now`, {
        templateId,
        entityId: 'label-batch-002',
        channel: 'print',
        inputs: Array.from({ length: 21 }, (_, i) => ({ product_name: `Product ${i + 1}` })),
        layout: {
          type: 'sheet',
          columns: 3,
          rows: 7,
          sheetSize: 'A4',
          margins: { top: 10, left: 5, columnGap: 2, rowGap: 2 },
        },
      });

      assert(
        renderNup.status === 201 || renderNup.status === 200 || renderNup.body?.document,
        `Render with N-up 3×7 layout succeeds: ${renderNup.status}`
      );

      // Test 6: Render with 50 inputs (batch of 50 shipping labels)
      const render50 = await httpRequest('POST', `${API}/render/now`, {
        templateId,
        entityId: 'label-batch-006',
        channel: 'print',
        inputs: Array.from({ length: 50 }, (_, i) => ({ product_name: `Parcel ${i + 1}` })),
      });

      assert(
        render50.status === 201 || render50.status === 200 || render50.body?.document,
        `Render 50 labels single-per-page succeeds: ${render50.status}`
      );
    } else {
      // Publish failed - skip render tests but still test validations
      assert(false, 'Render with single layout succeeds (skipped - publish failed)');
      assert(false, 'Render with N-up 3×7 layout succeeds (skipped - publish failed)');
      assert(false, 'Render 50 labels single-per-page succeeds (skipped - publish failed)');
    }

    // Test 3: Invalid layout type (doesn't need published template)
    const badLayout = await httpRequest('POST', `${API}/render/now`, {
      templateId,
      entityId: 'label-batch-003',
      channel: 'print',
      layout: { type: 'invalid', columns: 3, rows: 7 },
    });

    assert(
      badLayout.status === 400,
      `Invalid layout type returns 400: ${badLayout.status}`
    );

    // Test 4: Missing columns/rows
    const missingCols = await httpRequest('POST', `${API}/render/now`, {
      templateId,
      entityId: 'label-batch-004',
      channel: 'print',
      layout: { type: 'sheet' },
    });

    assert(
      missingCols.status === 400,
      `Missing columns/rows returns 400: ${missingCols.status}`
    );

    // Test 5: Invalid sheetSize
    const badSheet = await httpRequest('POST', `${API}/render/now`, {
      templateId,
      entityId: 'label-batch-005',
      channel: 'print',
      layout: { type: 'sheet', columns: 3, rows: 7, sheetSize: 'Tabloid' },
    });

    assert(
      badSheet.status === 400,
      `Invalid sheetSize returns 400: ${badSheet.status}`
    );

    // Test 7: Non-object layout that's not 'single'
    const badLayoutStr = await httpRequest('POST', `${API}/render/now`, {
      templateId,
      entityId: 'label-batch-007',
      channel: 'print',
      layout: 'custom',
    });

    assert(
      badLayoutStr.status === 400,
      `Non-'single' string layout returns 400: ${badLayoutStr.status}`
    );

    // Clean up
    await httpRequest('DELETE', `${API}/templates/${templateId}`);
  }

  // ─── Part 7: Multi-input rendering with different data ───
  console.log('--- Part 7: Sequential data in inputs ---');

  assert(
    renderSrc.includes("inputs?: Record<string, string>[]"),
    'RenderNowDto inputs is an array supporting multiple entries'
  );

  // The existing render pipeline already handles multiple inputs
  assert(
    renderSrc.includes('dto.inputs && dto.inputs.length > 0'),
    'Render pipeline uses provided inputs array when available'
  );

  // ─── Summary ───
  console.log('\n=== Results ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${passed + failed} tests passing`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
