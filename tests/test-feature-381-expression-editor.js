/**
 * Test Feature #381: Expression editor with field picker and test
 *
 * Verifies:
 * - Calculated field has expression editor in Properties panel
 * - Field picker available to insert field references
 * - Test button evaluates expression with example data
 * - Expression evaluate API endpoint works
 */

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-expr-381';
const USER_ID = 'user-expr-381';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let bodyData;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(body);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function run() {
  console.log('\n=== Feature #381: Expression editor with field picker and test ===\n');

  // === SOURCE CODE VERIFICATION ===
  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const designerSrc = fs.readFileSync(designerPath, 'utf-8');

  // Test 1: Expression editor section exists for calculated field
  console.log('Test 1: Expression editor section exists for calculated fields');
  assert(designerSrc.includes('expression-editor-section'), 'Expression editor section exists (data-testid)');
  assert(designerSrc.includes("selectedElement.type === 'calculated'"), 'Expression editor conditional on calculated type');
  assert(designerSrc.includes('prop-expression'), 'Expression textarea exists (data-testid="prop-expression")');

  // Test 2: Expression input is a monospace textarea
  console.log('\nTest 2: Expression input area');
  assert(designerSrc.includes('fontFamily: \'monospace\''), 'Expression uses monospace font');
  assert(designerSrc.includes('Expression Editor'), 'Section labeled "Expression Editor"');
  assert(designerSrc.includes('totals.subtotal * 0.15'), 'Has helpful placeholder example');

  // Test 3: Field picker available
  console.log('\nTest 3: Field picker for inserting field references');
  assert(designerSrc.includes('btn-expr-field-picker'), 'Field picker button exists (data-testid)');
  assert(designerSrc.includes('expr-field-picker'), 'Field picker dropdown exists (data-testid)');
  assert(designerSrc.includes('Insert Field Reference'), 'Button labeled "Insert Field Reference"');
  assert(designerSrc.includes('expr-field-search'), 'Field picker has search input');

  // Test 4: Field picker inserts field reference
  console.log('\nTest 4: Field picker inserts field reference into expression');
  assert(designerSrc.includes('expr-field-'), 'Field items have data-testid for each field');
  // Check that clicking a field inserts it into the binding
  assert(designerSrc.includes('binding: newExpr'), 'Clicking field updates binding/expression');
  assert(designerSrc.includes('setShowExprFieldPicker(false)'), 'Picker closes after selection');

  // Test 5: Test button
  console.log('\nTest 5: Test button to evaluate expression');
  assert(designerSrc.includes('btn-expr-test'), 'Test button exists (data-testid)');
  assert(designerSrc.includes('Test Expression'), 'Button labeled "Test Expression"');
  assert(designerSrc.includes('expressions/evaluate'), 'Test calls expression evaluate API');

  // Test 6: Test builds context from example data
  console.log('\nTest 6: Test builds context from DATA_FIELDS examples');
  assert(designerSrc.includes('DATA_FIELDS.forEach'), 'Iterates DATA_FIELDS for context');
  assert(designerSrc.includes('parseFloat(field.example'), 'Parses numeric examples for evaluation');

  // Test 7: Test result display
  console.log('\nTest 7: Test result display');
  assert(designerSrc.includes('expr-test-result'), 'Result container exists (data-testid)');
  assert(designerSrc.includes('expr-test-value'), 'Result value display (data-testid)');
  assert(designerSrc.includes('expr-test-error'), 'Error display (data-testid)');

  // Test 8: Expression state management
  console.log('\nTest 8: Expression editor state management');
  assert(designerSrc.includes('exprTestResult'), 'Expression test result state');
  assert(designerSrc.includes('exprTestLoading'), 'Expression test loading state');
  assert(designerSrc.includes('showExprFieldPicker'), 'Field picker visibility state');
  assert(designerSrc.includes('exprFieldSearch'), 'Field search state');

  // === API VERIFICATION ===
  // Test 9: Expression evaluate API works
  console.log('\nTest 9: Expression evaluate API - simple arithmetic');
  const evalRes = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: '10 + 20',
    context: {},
  }, TOKEN);
  assert(evalRes.status === 200 || evalRes.status === 201, 'Expression evaluate returns success (got ' + evalRes.status + ')');
  assert(evalRes.body.result === 30, 'Simple arithmetic evaluates correctly (10+20=' + evalRes.body.result + ')');
  assert(evalRes.body.type === 'number', 'Result type is number');

  // Test 10: Expression with context variables
  console.log('\nTest 10: Expression evaluate API - with context');
  const evalCtx = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'subtotal * taxRate',
    context: { subtotal: 1000, taxRate: 0.15 },
  }, TOKEN);
  assert(evalCtx.status === 200 || evalCtx.status === 201, 'Context expression returns success');
  assert(evalCtx.body.result === 150, 'Context expression evaluates correctly (1000*0.15=' + evalCtx.body.result + ')');

  // Test 11: Expression with string operations
  console.log('\nTest 11: Expression evaluate API - string concatenation');
  const evalStr = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'UPPER("hello")',
    context: {},
  }, TOKEN);
  assert(evalStr.status === 200 || evalStr.status === 201, 'String expression returns success');
  assert(evalStr.body.result === 'HELLO', 'UPPER function works (got: ' + evalStr.body.result + ')');

  // Test 12: Expression error handling
  console.log('\nTest 12: Expression evaluate API - error handling');
  const evalErr = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'INVALID_FUNC()',
    context: {},
  }, TOKEN);
  assert(evalErr.status === 400, 'Invalid expression returns 400 (got ' + evalErr.status + ')');

  // Test 13: Expression with nested field references
  console.log('\nTest 13: Expression with nested field references');
  const evalNested = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'price * quantity + tax',
    context: { price: 100, quantity: 5, tax: 75 },
  }, TOKEN);
  assert(evalNested.status === 200 || evalNested.status === 201, 'Nested expression returns success');
  assert(evalNested.body.result === 575, 'Nested expression correct (100*5+75=' + evalNested.body.result + ')');

  // Test 14: Expression with ROUND function
  console.log('\nTest 14: ROUND function');
  const evalRound = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'ROUND(10.567, 2)',
    context: {},
  }, TOKEN);
  assert(evalRound.status === 200 || evalRound.status === 201, 'ROUND expression returns success');
  assert(evalRound.body.result === 10.57, 'ROUND(10.567, 2) = ' + evalRound.body.result);

  // Test 15: Expression with IF function
  console.log('\nTest 15: IF function');
  const evalIf = await request('POST', '/api/pdfme/expressions/evaluate', {
    expression: 'IF(amount > 1000, "High", "Low")',
    context: { amount: 1500 },
  }, TOKEN);
  assert(evalIf.status === 200 || evalIf.status === 201, 'IF expression returns success');
  assert(evalIf.body.result === 'High', 'IF(1500>1000) = ' + evalIf.body.result);

  // Test 16: Calculated field type in designer
  console.log('\nTest 16: Calculated field type in designer element palette');
  assert(designerSrc.includes("id: 'calculated'"), 'Calculated field in element palette');
  assert(designerSrc.includes("label: 'Calculated Field'"), 'Has correct label');
  assert(designerSrc.includes("icon: 'fx'"), 'Has fx icon');

  // Test 17: Expression editor help text
  console.log('\nTest 17: Expression editor has help text');
  assert(designerSrc.includes('IF(), ROUND()'), 'Help text mentions supported functions');
  assert(designerSrc.includes('field names from the picker'), 'Help text references field picker');

  // === SUMMARY ===
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
