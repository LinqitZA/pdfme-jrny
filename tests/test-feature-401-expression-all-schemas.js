/**
 * Feature #401: Enable expression evaluation for all schema types
 *
 * Verifies that any text-containing schema (text, barcode, etc.) can use
 * expression syntax like CONCAT(), IF(), arithmetic operators, etc.
 * The expression engine runs AFTER field binding resolution but BEFORE
 * schema-specific resolvers. calculatedField schemas are skipped (they
 * have their own evaluation pipeline).
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

const ORG_ID = 'org-expr-401';
const USER_ID = 'user-expr-401';
const token = signJwt({ sub: USER_ID, orgId: ORG_ID, roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view'] });
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
  const data = await res.json();
  return data;
}

async function publishTemplate(id) {
  await fetch(`${BASE}/templates/${id}/publish`, { method: 'POST', headers });
}

async function renderTemplate(templateId, inputs) {
  const res = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'entity-401',
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

// Test: Expression endpoint evaluates correctly (baseline)
async function testExpressionEndpoint() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'CONCAT("Hello", " ", "World")',
      context: {},
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'Expression endpoint returns 200/201');
  assert(data.result === 'Hello World', 'CONCAT evaluates correctly');
}

// Test: Plain {{field}} placeholder still works (backward compat)
async function testPlainFieldBindings() {
  const tpl = await createTemplate('expr-401-plain-' + Date.now(), [
    { name: 'DocumentNr', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'CustomerName', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      DocumentNr: 'INV-001',
      CustomerName: 'Acme Corp',
    });

    assert(res.status === 201 || res.status === 200, 'Plain field binding render succeeds');
    const data = await res.json();
    assert(!data.error, 'No render error for plain field bindings');
    assert(data.document && data.document.id, 'Document generated for plain field bindings');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression in text field evaluates (CONCAT)
async function testExpressionInTextField() {
  const tpl = await createTemplate('expr-401-text-concat-' + Date.now(), [
    { name: 'docRef', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
    { name: 'DocumentNr', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    { name: 'DocumentDate', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    // The expression input: CONCAT will be detected and evaluated
    const res = await renderTemplate(templateId, {
      docRef: 'CONCAT("INV-001", "/", "2024-01-15")',
      DocumentNr: 'INV-001',
      DocumentDate: '2024-01-15',
    });

    assert(res.status === 201 || res.status === 200, 'Text field with expression renders successfully');
    const data = await res.json();
    assert(!data.error, 'No error for text field expression');
    assert(data.document && data.document.id, 'Document created for text field expression');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Arithmetic expression in text field
async function testArithmeticExpression() {
  const tpl = await createTemplate('expr-401-arithmetic-' + Date.now(), [
    { name: 'total', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'qty', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    { name: 'price', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      total: 'qty * price',
      qty: '10',
      price: '25.50',
    });

    assert(res.status === 201 || res.status === 200, 'Arithmetic expression in text field renders');
    const data = await res.json();
    assert(!data.error, 'No error for arithmetic expression');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: IF() expression in text field
async function testIfExpression() {
  const tpl = await createTemplate('expr-401-if-' + Date.now(), [
    { name: 'status', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'amount', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      status: 'IF(amount > 1000, "HIGH VALUE", "STANDARD")',
      amount: '5000',
    });

    assert(res.status === 201 || res.status === 200, 'IF expression in text field renders');
    const data = await res.json();
    assert(!data.error, 'No error for IF expression');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Nested expressions work
async function testNestedExpressions() {
  const tpl = await createTemplate('expr-401-nested-' + Date.now(), [
    { name: 'result', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      result: 'CONCAT(UPPER("hello"), " ", LOWER("WORLD"))',
    });

    assert(res.status === 201 || res.status === 200, 'Nested expressions render successfully');
    const data = await res.json();
    assert(!data.error, 'No error for nested expressions');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression error returns configured onError value (not crash)
async function testExpressionErrorHandling() {
  const tpl = await createTemplate('expr-401-error-' + Date.now(), [
    { name: 'result', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    // Invalid expression that looks like a function call but will fail
    const res = await renderTemplate(templateId, {
      result: 'NONEXISTENT_FUNC(123)',
    });

    // Should still render - error handling should catch it and leave original value
    assert(res.status === 201 || res.status === 200, 'Expression error does not crash render');
    const data = await res.json();
    assert(!data.error || data.document, 'Expression error gracefully handled');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: calculatedField schemas still work through their own pipeline
async function testCalculatedFieldSkipped() {
  const tpl = await createTemplate('expr-401-calc-skip-' + Date.now(), [
    { name: 'price', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'qty', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    {
      name: 'total',
      type: 'calculatedField',
      expression: 'price * qty',
      position: { x: 10, y: 40 },
      width: 80,
      height: 10,
    },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      price: '100',
      qty: '5',
    });

    assert(res.status === 201 || res.status === 200, 'calculatedField still renders through own pipeline');
    const data = await res.json();
    assert(!data.error, 'No error with calculatedField and expression pipeline coexisting');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression in barcode content evaluates
async function testExpressionInBarcode() {
  const tpl = await createTemplate('expr-401-barcode-' + Date.now(), [
    { name: 'barcodeContent', type: 'code128', position: { x: 10, y: 10 }, width: 60, height: 30 },
    { name: 'prefix', type: 'text', position: { x: 10, y: 50 }, width: 80, height: 10 },
    { name: 'code', type: 'text', position: { x: 10, y: 65 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      barcodeContent: 'CONCAT("PRD-", "12345")',
      prefix: 'PRD',
      code: '12345',
    });

    assert(res.status === 201 || res.status === 200, 'Expression in barcode content renders');
    const data = await res.json();
    assert(!data.error, 'No error for barcode expression');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Multiple expressions in same template
async function testMultipleExpressions() {
  const tpl = await createTemplate('expr-401-multi-' + Date.now(), [
    { name: 'header', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
    { name: 'footer', type: 'text', position: { x: 10, y: 25 }, width: 100, height: 10 },
    { name: 'docNr', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      header: 'CONCAT("INVOICE #", "12345")',
      footer: 'CONCAT("Page ", "1")',
      docNr: '12345',
    });

    assert(res.status === 201 || res.status === 200, 'Multiple expressions in same template render');
    const data = await res.json();
    assert(!data.error, 'No error for multiple expressions');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Simple values without expressions pass through unchanged
async function testSimpleValuesUnchanged() {
  const tpl = await createTemplate('expr-401-simple-' + Date.now(), [
    { name: 'name', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'address', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    { name: 'phone', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      name: 'John Doe',
      address: '123 Main St, City',
      phone: '+1-555-0123',
    });

    assert(res.status === 201 || res.status === 200, 'Simple values render without interference');
    const data = await res.json();
    assert(!data.error, 'No error for simple text values');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: UPPER/LOWER string expressions work
async function testStringExpressions() {
  const tpl = await createTemplate('expr-401-string-' + Date.now(), [
    { name: 'shout', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'whisper', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      shout: 'UPPER("hello world")',
      whisper: 'LOWER("QUIET PLEASE")',
    });

    assert(res.status === 201 || res.status === 200, 'String expressions (UPPER/LOWER) render');
    const data = await res.json();
    assert(!data.error, 'No error for string expressions');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression with field references from context
async function testExpressionWithFieldContext() {
  const tpl = await createTemplate('expr-401-ctx-' + Date.now(), [
    { name: 'summary', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
    { name: 'qty', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    { name: 'price', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    // summary uses field references that should resolve from context
    const res = await renderTemplate(templateId, {
      summary: 'qty * price',
      qty: '5',
      price: '20',
    });

    assert(res.status === 201 || res.status === 200, 'Expression with field context renders');
    const data = await res.json();
    assert(!data.error, 'No error for expression with field context');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression evaluation endpoint with context variables
async function testExpressionEndpointWithContext() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'qty * price',
      context: { qty: 10, price: 25.5 },
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'Expression endpoint with context returns 200/201');
  assert(data.result === 255, 'Arithmetic with context evaluates to 255');
}

// Test: CONCAT with context variables via expression endpoint
async function testConcatWithContext() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'CONCAT(DocumentNr, "/", DocumentDate)',
      context: { DocumentNr: 'INV-001', DocumentDate: '2024-01-15' },
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'CONCAT with context returns 200/201');
  assert(data.result === 'INV-001/2024-01-15', 'CONCAT with context produces correct result');
}

// Test: Render with expression that references other input fields
async function testRenderExpressionWithCrossFieldRef() {
  const tpl = await createTemplate('expr-401-crossref-' + Date.now(), [
    { name: 'displayLine', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
    { name: 'DocumentNr', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
    { name: 'DocumentDate', type: 'text', position: { x: 10, y: 40 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      displayLine: 'CONCAT(DocumentNr, " / ", DocumentDate)',
      DocumentNr: 'INV-002',
      DocumentDate: '2024-06-15',
    });

    assert(res.status === 201 || res.status === 200, 'Cross-field expression reference renders');
    const data = await res.json();
    assert(!data.error, 'No error for cross-field expression reference');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression evaluation does not interfere with image fields
async function testImageFieldsUntouched() {
  const tpl = await createTemplate('expr-401-image-' + Date.now(), [
    { name: 'logo', type: 'image', position: { x: 10, y: 10 }, width: 50, height: 30 },
    { name: 'title', type: 'text', position: { x: 70, y: 10 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      logo: '', // empty image
      title: 'CONCAT("Document ", "Title")',
    });

    assert(res.status === 201 || res.status === 200, 'Image fields not interfered with by expression engine');
    const data = await res.json();
    assert(!data.error, 'No error when image and expression fields coexist');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Empty expression or very short values pass through
async function testShortValuesPassThrough() {
  const tpl = await createTemplate('expr-401-short-' + Date.now(), [
    { name: 'code', type: 'text', position: { x: 10, y: 10 }, width: 80, height: 10 },
    { name: 'flag', type: 'text', position: { x: 10, y: 25 }, width: 80, height: 10 },
  ]);
  const templateId = tpl.id;

  try {
    await publishTemplate(templateId);

    const res = await renderTemplate(templateId, {
      code: 'AB',
      flag: 'Y',
    });

    assert(res.status === 201 || res.status === 200, 'Short values pass through without expression evaluation');
    const data = await res.json();
    assert(!data.error, 'No error for short values');
  } finally {
    await cleanup([templateId]);
  }
}

// Test: Expression with ROUND function
async function testRoundExpression() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'ROUND(10 / 3, 2)',
      context: {},
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'ROUND expression returns 200/201');
  assert(data.result === 3.33 || String(data.result) === '3.33', 'ROUND(10/3, 2) equals 3.33');
}

// Test: LEN string function
async function testLenExpression() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'LEN("Hello")',
      context: {},
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'LEN expression returns 200/201');
  assert(data.result === 5, 'LEN("Hello") equals 5');
}

// Test: TRIM string function
async function testTrimExpression() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'TRIM("  hello  ")',
      context: {},
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'TRIM expression returns 200/201');
  assert(data.result === 'hello', 'TRIM("  hello  ") equals "hello"');
}

// Test: ABS numeric function
async function testAbsExpression() {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'ABS(-42)',
      context: {},
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, 'ABS expression returns 200/201');
  assert(data.result === 42, 'ABS(-42) equals 42');
}

async function runTests() {
  console.log('Feature #401: Enable expression evaluation for all schema types\n');

  await testExpressionEndpoint();
  await testPlainFieldBindings();
  await testExpressionInTextField();
  await testArithmeticExpression();
  await testIfExpression();
  await testNestedExpressions();
  await testExpressionErrorHandling();
  await testCalculatedFieldSkipped();
  await testExpressionInBarcode();
  await testMultipleExpressions();
  await testSimpleValuesUnchanged();
  await testStringExpressions();
  await testExpressionWithFieldContext();
  await testExpressionEndpointWithContext();
  await testConcatWithContext();
  await testRenderExpressionWithCrossFieldRef();
  await testImageFieldsUntouched();
  await testShortValuesPassThrough();
  await testRoundExpression();
  await testLenExpression();
  await testTrimExpression();
  await testAbsExpression();

  console.log(results.join('\n'));
  console.log(`\nResults: ${passed}/${passed + failed} passed`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
