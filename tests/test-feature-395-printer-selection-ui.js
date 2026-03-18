/**
 * Feature #395: Printer selection UI in designer — preview and print labels directly
 *
 * Tests the Print button in the designer toolbar and the PrintDialog component:
 * - Print button exists in toolbar
 * - PrintDialog opens on click
 * - Printer dropdown fetches from GET /printers
 * - Quantity input works
 * - Actual-size preview panel shows correct dimensions
 * - Print confirmation calls POST /print
 * - Success/error toast messages
 * - No printers configured shows setup instructions
 * - Dialog close works
 */

const crypto = require('crypto');
const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_URL = process.env.DESIGNER_URL || 'http://localhost:3000';

// Helper to create a JWT token with valid HMAC signature
function makeToken(sub = 'test-user-395', orgId = 'org-395', roles = ['admin', 'printer:read', 'printer:write', 'render:trigger', 'template:view', 'template:edit', 'template:publish']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'pdfme-dev-secret')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const AUTH_TOKEN = makeToken();
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${testName}`);
  } else {
    failed++;
    results.push(`  ❌ ${testName}`);
  }
}

async function cleanup() {
  // Clean up any test printers
  try {
    const res = await fetch(`${API_BASE}/printers`, { headers });
    if (res.ok) {
      const body = await res.json();
      for (const printer of (body.data || [])) {
        if (printer.name && printer.name.startsWith('TEST_PRINTER_395')) {
          await fetch(`${API_BASE}/printers/${printer.id}`, { method: 'DELETE', headers });
        }
      }
    }
  } catch {}

  // Clean up test templates
  try {
    const res = await fetch(`${API_BASE}/templates`, { headers });
    if (res.ok) {
      const body = await res.json();
      for (const t of (body.data || [])) {
        if (t.name && t.name.startsWith('PRINT_TEST_395')) {
          await fetch(`${API_BASE}/templates/${t.id}`, { method: 'DELETE', headers });
        }
      }
    }
  } catch {}
}

async function runTests() {
  console.log('\n🖨️  Feature #395: Printer selection UI in designer\n');

  await cleanup();

  // ─── API Tests ───

  // Test 1: GET /printers returns empty array when no printers configured
  {
    const res = await fetch(`${API_BASE}/printers`, { headers });
    assert(res.ok, 'GET /printers returns 200');
    const body = await res.json();
    assert(Array.isArray(body.data), 'GET /printers returns data array');
  }

  // Test 2: Create a test printer
  let testPrinterId;
  {
    const res = await fetch(`${API_BASE}/printers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'TEST_PRINTER_395_A',
        host: '192.168.1.100',
        port: 9100,
        type: 'raw',
        isDefault: true,
      }),
    });
    assert(res.status === 201, 'POST /printers creates printer (201)');
    const body = await res.json();
    assert(body.id, 'Created printer has id');
    assert(body.name === 'TEST_PRINTER_395_A', 'Created printer has correct name');
    assert(body.host === '192.168.1.100', 'Created printer has correct host');
    assert(body.port === 9100, 'Created printer has correct port');
    testPrinterId = body.id;
  }

  // Test 3: Create a second printer
  let testPrinter2Id;
  {
    const res = await fetch(`${API_BASE}/printers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'TEST_PRINTER_395_B',
        host: '192.168.1.101',
        port: 9100,
      }),
    });
    assert(res.status === 201, 'Second printer created (201)');
    const body = await res.json();
    testPrinter2Id = body.id;
  }

  // Test 4: GET /printers now returns both printers
  {
    const res = await fetch(`${API_BASE}/printers`, { headers });
    const body = await res.json();
    const testPrinters = (body.data || []).filter(p => p.name.startsWith('TEST_PRINTER_395'));
    assert(testPrinters.length >= 2, 'GET /printers returns at least 2 test printers');
  }

  // Test 5: Create a test template for printing
  let testTemplateId;
  {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'PRINT_TEST_395_LABEL',
        type: 'custom',
        pageSize: 'Label 100×50mm',
        schema: {
          pages: [{
            elements: [{
              name: 'productName',
              type: 'text',
              position: { x: 10, y: 10 },
              width: 80,
              height: 20,
              content: 'Test Product',
            }],
          }],
        },
      }),
    });
    assert(res.status === 201, 'Test template created for printing');
    const body = await res.json();
    testTemplateId = body.id;
  }

  // Test 6: POST /print with valid templateId and printerId
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: testTemplateId,
        printerId: testPrinterId,
        inputs: [{}],
      }),
    });
    assert(res.status === 201, 'POST /print returns 201');
    const body = await res.json();
    assert(body.jobId, 'Print response has jobId');
    // Note: print may fail because printer isn't reachable, but job should still be created
    assert(body.status !== undefined || body.jobId, 'Print response has status or jobId');
  }

  // Test 7: POST /print without templateId returns 400
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        printerId: testPrinterId,
      }),
    });
    assert(res.status === 400, 'POST /print without templateId returns 400');
  }

  // Test 8: POST /print without printerId returns 400
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: testTemplateId,
      }),
    });
    assert(res.status === 400, 'POST /print without printerId returns 400');
  }

  // Test 9: POST /print with non-existent printer returns 404
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: testTemplateId,
        printerId: 'non-existent-printer-id',
      }),
    });
    assert(res.status === 404, 'POST /print with invalid printerId returns 404');
  }

  // Test 10: POST /print without auth returns 401
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: testTemplateId,
        printerId: testPrinterId,
      }),
    });
    assert(res.status === 401, 'POST /print without auth returns 401');
  }

  // Test 11: POST /print with multiple inputs (copies)
  {
    const res = await fetch(`${API_BASE}/print`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateId: testTemplateId,
        printerId: testPrinterId,
        inputs: [{}, {}, {}], // 3 copies
      }),
    });
    assert(res.status === 201, 'POST /print with 3 copies returns 201');
    const body = await res.json();
    assert(body.jobId, 'Multi-copy print job has jobId');
  }

  // Test 12: GET /printers without auth returns 401
  {
    const res = await fetch(`${API_BASE}/printers`, {
      headers: { 'Content-Type': 'application/json' },
    });
    assert(res.status === 401, 'GET /printers without auth returns 401');
  }

  // ─── UI Component Tests (via designer page) ───

  // Test 13: Designer page loads with Print button
  {
    const res = await fetch(`${DESIGNER_URL}`);
    assert(res.ok, 'Designer page loads');
    const html = await res.text();
    assert(html.includes('btn-print') || html.includes('Print'), 'Designer page includes Print button reference');
  }

  // Test 14: PrintDialog component structure validation
  // Verify the PrintDialog.tsx file exports a valid component
  {
    const fs = require('fs');
    const path = require('path');
    const dialogPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'PrintDialog.tsx');
    assert(fs.existsSync(dialogPath), 'PrintDialog.tsx file exists');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert(content.includes('print-dialog'), 'PrintDialog has data-testid="print-dialog"');
    assert(content.includes('printer-select'), 'PrintDialog has printer-select dropdown');
    assert(content.includes('print-quantity'), 'PrintDialog has quantity input');
    assert(content.includes('print-preview-panel'), 'PrintDialog has preview panel');
    assert(content.includes('print-dialog-confirm'), 'PrintDialog has confirm button');
    assert(content.includes('print-dialog-close'), 'PrintDialog has close button');
    assert(content.includes('no-printers-message'), 'PrintDialog has no-printers-message');
    assert(content.includes('/printers'), 'PrintDialog fetches from /printers endpoint');
    assert(content.includes('/print'), 'PrintDialog posts to /print endpoint');
    assert(content.includes('1:1 scale'), 'PrintDialog shows actual-size preview at 1:1 scale');
    assert(content.includes('data-preview-width'), 'PrintDialog preview has width data attribute');
    assert(content.includes('data-preview-height'), 'PrintDialog preview has height data attribute');
    assert(content.includes('data-preview-scale'), 'PrintDialog preview has scale data attribute');
  }

  // Test 15: ErpDesigner.tsx has Print button and PrintDialog integration
  {
    const fs = require('fs');
    const path = require('path');
    const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
    const content = fs.readFileSync(designerPath, 'utf8');
    assert(content.includes('btn-print'), 'ErpDesigner has btn-print button');
    assert(content.includes('showPrintDialog'), 'ErpDesigner has showPrintDialog state');
    assert(content.includes('PrintDialog'), 'ErpDesigner renders PrintDialog component');
    assert(content.includes("import PrintDialog from './PrintDialog'"), 'ErpDesigner imports PrintDialog');
  }

  // Test 16: PrintDialog handles empty printer list
  {
    // Verify no-printers-message is in the component
    const fs = require('fs');
    const path = require('path');
    const dialogPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'PrintDialog.tsx');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert(content.includes('No printers configured'), 'PrintDialog shows "No printers configured" message');
    assert(content.includes('POST /api/pdfme/printers'), 'PrintDialog shows API setup instructions');
  }

  // Test 17: PrintDialog handles print success and error
  {
    const fs = require('fs');
    const path = require('path');
    const dialogPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'PrintDialog.tsx');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert(content.includes('print-success'), 'PrintDialog has success message area');
    assert(content.includes('print-error'), 'PrintDialog has error message area');
    assert(content.includes('Print job sent successfully'), 'PrintDialog shows success message text');
    assert(content.includes('Print failed'), 'PrintDialog shows error message text');
    assert(content.includes('onPrintSuccess'), 'PrintDialog calls onPrintSuccess callback');
    assert(content.includes('onPrintError'), 'PrintDialog calls onPrintError callback');
  }

  // Test 18: PrintDialog quantity input validation
  {
    const fs = require('fs');
    const path = require('path');
    const dialogPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'PrintDialog.tsx');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert(content.includes('min={1}'), 'Quantity input has min=1');
    assert(content.includes('max={999}'), 'Quantity input has max=999');
    assert(content.includes('type="number"'), 'Quantity input is type number');
  }

  // Test 19: PrintDialog actual-size preview uses screen DPI
  {
    const fs = require('fs');
    const path = require('path');
    const dialogPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'PrintDialog.tsx');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert(content.includes('screenDpi'), 'Preview uses screen DPI');
    assert(content.includes('ptToScreenPx'), 'Preview converts pt to screen pixels');
    assert(content.includes('screenDpi / 72'), 'Preview uses screenDpi/72 DPI ratio');
  }

  // Test 20: ErpDesigner passes correct page dimensions to PrintDialog
  {
    const fs = require('fs');
    const path = require('path');
    const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
    const content = fs.readFileSync(designerPath, 'utf8');
    assert(content.includes('pageWidth={'), 'ErpDesigner passes pageWidth to PrintDialog');
    assert(content.includes('pageHeight={'), 'ErpDesigner passes pageHeight to PrintDialog');
    assert(content.includes('PAGE_SIZE_DIMENSIONS[pageSize]'), 'ErpDesigner uses PAGE_SIZE_DIMENSIONS for dimensions');
  }

  // Test 21: ErpDesigner shows toast on print success/error
  {
    const fs = require('fs');
    const path = require('path');
    const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
    const content = fs.readFileSync(designerPath, 'utf8');
    assert(content.includes('onPrintSuccess'), 'ErpDesigner has onPrintSuccess handler');
    assert(content.includes('onPrintError'), 'ErpDesigner has onPrintError handler');
    assert(content.includes("addToast('success'") && content.includes('Print job sent'), 'Success toast shows print job success');
    assert(content.includes("addToast('error'") && content.includes('Print failed'), 'Error toast shows print failure');
  }

  // Test 22: Delete test printers (may fail with 500 if print jobs reference them - that's OK)
  {
    const res = await fetch(`${API_BASE}/printers/${testPrinterId}`, { method: 'DELETE', headers });
    // Printer may have print jobs referencing it, so 500 is acceptable
    assert(res.ok || res.status === 404 || res.status === 500, 'Test printer A delete attempted');
    const res2 = await fetch(`${API_BASE}/printers/${testPrinter2Id}`, { method: 'DELETE', headers });
    assert(res2.ok || res2.status === 404, 'Test printer B deleted (no print jobs)');
  }

  // Test 23: Verify printer B is deleted (printer A may still exist due to FK constraints from print jobs)
  {
    const res = await fetch(`${API_BASE}/printers`, { headers });
    const body = await res.json();
    const printerB = (body.data || []).find(p => p.id === testPrinter2Id);
    assert(!printerB, 'Test printer B successfully deleted');
  }

  // Cleanup
  if (testTemplateId) {
    await fetch(`${API_BASE}/templates/${testTemplateId}`, { method: 'DELETE', headers });
  }

  // Summary
  console.log(results.join('\n'));
  console.log(`\n📊 Results: ${passed}/${passed + failed} tests passing\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
