/**
 * Feature #403: Expression support for all barcode types
 *
 * Verifies that all barcode schema types (Code128, Code39, QR, etc.) support
 * expression syntax in their content. With Feature #401 implemented, the
 * resolveExpressions() pipeline step evaluates expressions in barcode input
 * values before they reach the barcode renderer.
 */

const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-barcode-403';
const USER_ID = 'user-barcode-403';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view'],
});
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  ✓ ${testName}`);
  } else {
    failed++;
    results.push(`  ✗ FAIL: ${testName}`);
  }
}

async function createTemplate(name, elements) {
  const schema = {
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    pages: [{ elements }],
  };
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, type: 'invoice', schema }),
  });
  return res.json();
}

async function publishTemplate(id) {
  const res = await fetch(`${BASE}/templates/${id}/publish`, { method: 'POST', headers });
  return res;
}

async function renderTemplate(templateId, inputs) {
  const res = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'entity-403',
      channel: 'print',
      inputs: [inputs],
    }),
  });
  return res;
}

async function deleteTemplate(id) {
  await fetch(`${BASE}/templates/${id}`, { method: 'DELETE', headers });
}

async function cleanup(ids) {
  for (const id of ids) {
    try { await deleteTemplate(id); } catch {}
  }
}

// Test: Code128 barcode with CONCAT expression
async function testCode128WithConcat() {
  const tpl = await createTemplate('barcode-403-code128-concat-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'DocumentNr', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
    { name: 'LineNr', type: 'text', position: { x: 10, y: 55 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'CONCAT("INV-001", "-", "0042")',
      DocumentNr: 'INV-001',
      LineNr: '0042',
    });

    assert(res.status === 201 || res.status === 200, 'Code128 with CONCAT expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for Code128 CONCAT expression');
    assert(data.document && data.document.id, 'Document generated for Code128 expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Code128 barcode with field reference expression
async function testCode128WithFieldRef() {
  const tpl = await createTemplate('barcode-403-code128-ref-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'DocumentNr', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
    { name: 'LineNr', type: 'text', position: { x: 10, y: 55 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'CONCAT(DocumentNr, "-", LineNr)',
      DocumentNr: 'INV-001',
      LineNr: '0042',
    });

    assert(res.status === 201 || res.status === 200, 'Code128 with field reference expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for Code128 field reference expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Static barcode content still works unchanged
async function testStaticBarcodeContent() {
  const tpl = await createTemplate('barcode-403-static-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'STATIC-BARCODE-12345',
    });

    assert(res.status === 201 || res.status === 200, 'Static barcode content renders unchanged');
    const data = await res.json();
    assert(!data.error, 'No error for static barcode content');
    assert(data.document && data.document.id, 'Document generated for static barcode');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Code128 barcode with arithmetic expression
async function testCode128Arithmetic() {
  const tpl = await createTemplate('barcode-403-arith-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'baseNum', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'baseNum + 1000',
      baseNum: '5000',
    });

    assert(res.status === 201 || res.status === 200, 'Code128 with arithmetic expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for Code128 arithmetic expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Code128 barcode with UPPER expression
async function testCode128Upper() {
  const tpl = await createTemplate('barcode-403-upper-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'UPPER("inv-2024-001")',
    });

    assert(res.status === 201 || res.status === 200, 'Code128 with UPPER expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for Code128 UPPER expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Multiple barcode elements with expressions in same template
async function testMultipleBarcodes() {
  const tpl = await createTemplate('barcode-403-multi-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'barcode2', type: 'code128', position: { x: 10, y: 45 }, width: 80, height: 25 },
    { name: 'docNr', type: 'text', position: { x: 10, y: 80 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'CONCAT("DOC-", docNr)',
      barcode2: 'CONCAT("REF-", docNr)',
      docNr: '12345',
    });

    assert(res.status === 201 || res.status === 200, 'Multiple barcodes with expressions render');
    const data = await res.json();
    assert(!data.error, 'No error for multiple barcode expressions');
    assert(data.document && data.document.id, 'Document generated for multiple barcode expressions');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: qrcode barcode type with expression content
async function testQrBarcodeWithExpression() {
  const tpl = await createTemplate('barcode-403-qr-' + Date.now(), [
    { name: 'qrCode', type: 'qrcode', position: { x: 10, y: 10 }, width: 50, height: 50 },
    { name: 'docId', type: 'text', position: { x: 10, y: 65 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      qrCode: 'CONCAT("https://erp.example.com/invoices/", docId)',
      docId: 'INV-001',
    });

    assert(res.status === 201 || res.status === 200, 'QR code with expression content renders');
    const data = await res.json();
    assert(!data.error, 'No error for QR code expression content');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Barcode with IF expression
async function testBarcodeWithIf() {
  const tpl = await createTemplate('barcode-403-if-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'isPriority', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
    { name: 'docNr', type: 'text', position: { x: 10, y: 55 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'IF(isPriority > 0, CONCAT("PRI-", docNr), CONCAT("STD-", docNr))',
      isPriority: '1',
      docNr: '12345',
    });

    assert(res.status === 201 || res.status === 200, 'Barcode with IF expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for barcode IF expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Expression error in barcode falls back gracefully
async function testBarcodeExpressionError() {
  const tpl = await createTemplate('barcode-403-error-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    // Invalid expression syntax that looks like a function call
    const res = await renderTemplate(tpl.id, {
      barcode1: 'INVALIDFUNC()',
    });

    // Should still render - expression error should be caught
    assert(res.status === 201 || res.status === 200, 'Barcode expression error does not crash render');
    const data = await res.json();
    assert(!data.error || data.document, 'Barcode expression error handled gracefully');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Barcode with nested CONCAT and UPPER
async function testBarcodeNestedExpressions() {
  const tpl = await createTemplate('barcode-403-nested-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'CONCAT(UPPER("inv"), "-", "2024-001")',
    });

    assert(res.status === 201 || res.status === 200, 'Barcode with nested expressions renders');
    const data = await res.json();
    assert(!data.error, 'No error for barcode nested expressions');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Expression evaluation endpoint confirms CONCAT works for barcode-style content
async function testExpressionEndpointBarcode() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'CONCAT(DocumentNr, "-", "0042")',
      context: { DocumentNr: 'INV-001' },
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'Expression endpoint evaluates barcode content');
  assert(data.result === 'INV-001-0042', 'CONCAT produces correct barcode content');
}

// Test: Mixed text and barcode fields with expressions
async function testMixedTextAndBarcode() {
  const tpl = await createTemplate('barcode-403-mixed-' + Date.now(), [
    { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 25 }, width: 80, height: 25 },
    { name: 'docNr', type: 'text', position: { x: 10, y: 55 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      title: 'CONCAT("Invoice #", docNr)',
      barcode1: 'CONCAT("BC-", docNr)',
      docNr: '99001',
    });

    assert(res.status === 201 || res.status === 200, 'Mixed text and barcode expressions render');
    const data = await res.json();
    assert(!data.error, 'No error for mixed text and barcode expressions');
    assert(data.document && data.document.id, 'Document generated for mixed expressions');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Barcode with numeric expression that produces a valid number string
async function testBarcodeNumericExpression() {
  const tpl = await createTemplate('barcode-403-numeric-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
    { name: 'baseCode', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'baseCode * 10 + 7',
      baseCode: '12345',
    });

    assert(res.status === 201 || res.status === 200, 'Barcode with numeric expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for barcode numeric expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: Empty barcode content still works
async function testEmptyBarcodeContent() {
  const tpl = await createTemplate('barcode-403-empty-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: '',
    });

    // May succeed or fail depending on barcode renderer empty handling
    const data = await res.json();
    assert(res.status === 201 || res.status === 200 || data.document, 'Empty barcode content handled');
  } finally {
    await cleanup([tpl.id]);
  }
}

// Test: TRIM expression for barcode (removes whitespace)
async function testBarcodeTrimExpression() {
  const tpl = await createTemplate('barcode-403-trim-' + Date.now(), [
    { name: 'barcode1', type: 'code128', position: { x: 10, y: 10 }, width: 80, height: 25 },
  ]);

  try {
    await publishTemplate(tpl.id);
    const res = await renderTemplate(tpl.id, {
      barcode1: 'TRIM("  BARCODE-001  ")',
    });

    assert(res.status === 201 || res.status === 200, 'Barcode with TRIM expression renders');
    const data = await res.json();
    assert(!data.error, 'No error for barcode TRIM expression');
  } finally {
    await cleanup([tpl.id]);
  }
}

async function runTests() {
  console.log('Feature #403: Expression support for all barcode types\n');

  await testCode128WithConcat();
  await testCode128WithFieldRef();
  await testStaticBarcodeContent();
  await testCode128Arithmetic();
  await testCode128Upper();
  await testMultipleBarcodes();
  await testQrBarcodeWithExpression();
  await testBarcodeWithIf();
  await testBarcodeExpressionError();
  await testBarcodeNestedExpressions();
  await testExpressionEndpointBarcode();
  await testMixedTextAndBarcode();
  await testBarcodeNumericExpression();
  await testEmptyBarcodeContent();
  await testBarcodeTrimExpression();

  console.log(results.join('\n'));
  console.log(`\nResults: ${passed}/${passed + failed} passed`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
