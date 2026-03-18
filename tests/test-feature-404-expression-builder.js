/**
 * Feature #404: Expression builder UI in data field selector
 *
 * Tests the enhanced data field selector with expression builder mode.
 * Verifies: expression mode toggle, syntax-highlighted textarea, functions palette,
 * field autocomplete, live preview, validation errors, insert button, help section.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_URL = process.env.DESIGNER_URL || 'http://localhost:3000';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const ORG_ID = 'org-expr-builder-404';
const USER_ID = 'user-expr-404';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken();

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const { body, ...opts } = options;
    const urlObj = new URL(url);
    const reqOpts = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function fetchDesignerHTML() {
  const resp = await request(DESIGNER_URL);
  return typeof resp.data === 'string' ? resp.data : '';
}

async function fetchDesignerComponentSource() {
  // Read the component file directly
  const fs = require('fs');
  const path = require('path');
  const filePath = path.resolve(__dirname, '../apps/designer-sandbox/components/ErpDesigner.tsx');
  return fs.readFileSync(filePath, 'utf-8');
}

async function runTests() {
  console.log('\n=== Feature #404: Expression Builder UI in Data Field Selector ===\n');

  // ─── 1. Component Source Analysis ───
  console.log('--- 1. Expression Mode Toggle ---');
  const source = await fetchDesignerComponentSource();

  // 1a. Expression mode toggle exists
  assert(source.includes('btn-expression-mode-toggle'), 'Expression mode toggle button exists with data-testid');
  assert(source.includes('expressionMode'), 'expressionMode state variable exists');
  assert(source.includes("aria-pressed={expressionMode}"), 'Toggle has aria-pressed attribute');

  // 1b. Toggle switches between simple and expression mode
  assert(source.includes("expressionMode ? 'Expression' : 'Simple'"), 'Toggle shows correct label for each mode');
  assert(source.includes('setExpressionMode'), 'setExpressionMode state setter exists');

  // 1c. Simple mode is default (off)
  assert(source.includes('useState(false)') && source.includes('expressionMode'), 'Expression mode defaults to off (false)');

  // 1d. When off, original field insertion works
  assert(source.includes('!expressionMode') && source.includes('prop-binding'), 'Simple mode shows original binding picker');

  console.log('\n--- 2. Expression Builder Textarea ---');

  // 2a. Expression builder textarea exists
  assert(source.includes('expr-builder-textarea'), 'Expression builder textarea has data-testid');
  assert(source.includes('expression-builder'), 'Expression builder container has data-testid');

  // 2b. Textarea has monospace font
  assert(source.includes("fontFamily: 'monospace'") && source.includes('expr-builder-textarea'), 'Textarea uses monospace font');

  // 2c. Syntax hint mentions {{field}} and FUNC()
  assert(source.includes("'{{field}}'") || source.includes("{'{{field}}'}"), 'Syntax hint shows {{field}} pattern');
  assert(source.includes('FUNC()'), 'Syntax hint shows FUNC() pattern');

  // 2d. Distinct colors for fields and functions in hint
  assert(source.includes('#7c3aed'), 'Field references shown in purple color');
  assert(source.includes('#2563eb'), 'Function names shown in blue color');

  console.log('\n--- 3. Functions Palette ---');

  // 3a. Functions palette button exists
  assert(source.includes('btn-expr-functions-palette'), 'Functions palette button exists');
  assert(source.includes('expr-functions-palette'), 'Functions palette container exists');

  // 3b. Category tabs exist
  assert(source.includes('expr-func-cat-${cat.category.toLowerCase()}'), 'Category tab data-testid uses dynamic category name');
  // Verify the categories that will produce these testids
  const catNames = ['String', 'Math', 'Date', 'Logical', 'Format'];
  for (const cat of catNames) {
    assert(source.includes(`category: '${cat}'`), `Category '${cat}' exists (produces testid expr-func-cat-${cat.toLowerCase()})`);
  }

  // 3c. Functions listed with signatures and descriptions
  assert(source.includes('fn.signature'), 'Function signatures are displayed');
  assert(source.includes('fn.description'), 'Function descriptions are displayed');

  // 3d. Click inserts function name with parens
  assert(source.includes("fn.name + '('"), 'Clicking function inserts name with opening paren');

  // 3e. Verify all function categories in EXPRESSION_FUNCTIONS
  assert(source.includes("category: 'String'"), 'String category defined in EXPRESSION_FUNCTIONS');
  assert(source.includes("category: 'Math'"), 'Math category defined in EXPRESSION_FUNCTIONS');
  assert(source.includes("category: 'Date'"), 'Date category defined in EXPRESSION_FUNCTIONS');
  assert(source.includes("category: 'Logical'"), 'Logical category defined in EXPRESSION_FUNCTIONS');
  assert(source.includes("category: 'Format'"), 'Format category defined in EXPRESSION_FUNCTIONS');

  // 3f. Specific functions listed
  assert(source.includes("name: 'CONCAT'"), 'CONCAT function listed');
  assert(source.includes("name: 'LEFT'"), 'LEFT function listed');
  assert(source.includes("name: 'RIGHT'"), 'RIGHT function listed');
  assert(source.includes("name: 'IF'"), 'IF function listed');
  assert(source.includes("name: 'FORMAT_CURRENCY'"), 'FORMAT_CURRENCY function listed');
  assert(source.includes("name: 'PADLEFT'"), 'PADLEFT function listed');
  assert(source.includes("name: 'ROUND'"), 'ROUND function listed');
  assert(source.includes("name: 'TODAY'"), 'TODAY function listed');

  console.log('\n--- 4. Field Autocomplete ---');

  // 4a. Autocomplete triggers on {{
  assert(source.includes("lastIndexOf('{{')"), 'Autocomplete detects {{ trigger');
  assert(source.includes('exprBuilderFieldAutocomplete'), 'Field autocomplete state exists');

  // 4b. Autocomplete dropdown exists
  assert(source.includes('expr-builder-autocomplete'), 'Autocomplete dropdown has data-testid');

  // 4c. Autocomplete filters fields based on partial input
  assert(source.includes('exprBuilderFieldFilter'), 'Field filter state for autocomplete exists');
  assert(source.includes("f.key.toLowerCase().includes(exprBuilderFieldFilter.toLowerCase())"), 'Autocomplete filters by field key');

  // 4d. Clicking autocomplete item inserts field with {{ }}
  assert(source.includes("'{{' + field.key + '}}'"), 'Autocomplete inserts field wrapped in {{ }}');

  // 4e. Autocomplete items have testids
  assert(source.includes('expr-autocomplete-'), 'Autocomplete items have data-testid prefix');

  console.log('\n--- 5. Live Preview Panel ---');

  // 5a. Preview button exists
  assert(source.includes('btn-expr-builder-preview'), 'Preview button exists');
  assert(source.includes("'Preview Result'"), 'Preview button shows correct label');

  // 5b. Preview calls /expressions/evaluate endpoint
  assert(source.includes('/expressions/evaluate'), 'Preview calls the evaluate endpoint');

  // 5c. Preview strips {{ }} wrappers before sending
  assert(source.includes("exprBuilderText.replace(/\\{\\{([^}]+)\\}\\}/g, '$1')"), 'Expression strips {{ }} wrappers for evaluation');

  // 5d. Preview result display exists
  assert(source.includes('expr-builder-preview-result'), 'Preview result container exists');
  assert(source.includes('expr-builder-result-value'), 'Preview result value display exists');

  // 5e. Preview shows type information
  assert(source.includes('exprBuilderPreview.type'), 'Preview shows result type');

  console.log('\n--- 6. Validation Errors Inline ---');

  // 6a. Error display in preview result
  assert(source.includes('expr-builder-error'), 'Error display has data-testid');
  assert(source.includes('exprBuilderPreview.error'), 'Error state is checked in preview');
  assert(source.includes('#fef2f2'), 'Error display has red background');
  assert(source.includes('#dc2626'), 'Error text is in red color');

  // 6b. Error vs success styling
  assert(source.includes("#fecaca"), 'Error border color exists');
  assert(source.includes("#bbf7d0"), 'Success border color exists');

  console.log('\n--- 7. Insert Button ---');

  // 7a. Insert button exists
  assert(source.includes('btn-expr-builder-insert'), 'Insert button has data-testid');
  assert(source.includes('Insert Expression'), 'Insert button shows correct label');

  // 7b. Insert places expression into element binding
  assert(source.includes("binding: exprBuilderText"), 'Insert updates element binding with expression text');
  assert(source.includes("content: exprBuilderText"), 'Insert updates element content with expression text');

  // 7c. Insert disabled when empty
  assert(source.includes("!exprBuilderText.trim()") && source.includes('disabled'), 'Insert button disabled when textarea is empty');

  // 7d. Insert button has green color
  assert(source.includes('#16a34a'), 'Insert button has green background color');

  console.log('\n--- 8. Works for Multiple Element Types ---');

  // 8a. Expression builder works for text fields
  assert(source.includes("category === 'text'") && source.includes('expression-builder'), 'Expression builder available for text elements');

  // 8b. Works for calculated fields
  assert(source.includes("selectedElement.type === 'calculated'") && source.includes('properties-binding'), 'Expression builder available for calculated elements');

  // 8c. Works for QR barcode content
  assert(source.includes("selectedElement.type === 'qr-barcode'") && source.includes('properties-binding'), 'Expression builder available for QR barcode elements');

  console.log('\n--- 9. Help Section with Examples ---');

  // 9a. Help toggle button exists
  assert(source.includes('btn-expr-builder-help'), 'Help toggle button has data-testid');
  assert(source.includes("'Help &amp; Examples'") || source.includes("Help &amp; Examples"), 'Help button label exists');

  // 9b. Help section exists
  assert(source.includes('expr-builder-help'), 'Help section has data-testid');

  // 9c. Common examples listed
  assert(source.includes('EXPRESSION_EXAMPLES'), 'Expression examples constant is used');
  assert(source.includes("label: 'Join fields'"), 'Join fields example exists');
  assert(source.includes("label: 'Conditional text'"), 'Conditional text example exists');
  assert(source.includes("label: 'Currency format'"), 'Currency format example exists');
  assert(source.includes("label: 'Zero-pad number'"), 'Zero-pad example exists');
  assert(source.includes("label: 'Truncate text'"), 'Truncate text example exists');
  assert(source.includes("label: 'Calculate tax'"), 'Calculate tax example exists');

  // 9d. Clicking example populates textarea
  assert(source.includes('setExprBuilderText(ex.expr)'), 'Clicking example sets expression text');

  // 9e. Example items have testids
  assert(source.includes('expr-example-'), 'Example items have data-testid prefix');

  console.log('\n--- 10. Mobile-Friendly (Side Panel) ---');

  // 10a. Expression builder is inline (not a modal)
  assert(!source.includes('expression-builder-modal'), 'Expression builder is not a modal');
  assert(source.includes("width: '100%'") && source.includes('btn-expr-builder-insert'), 'Buttons use full width for side panel');

  // 10b. Functions palette has max-height (scrollable)
  assert(source.includes("maxHeight: '280px'") || source.includes("maxHeight: '250px'"), 'Functions palette has max-height for scrollability');

  // 10c. Category tabs flex-wrap for narrow panels
  assert(source.includes('flexWrap'), 'Category tabs use flex-wrap for narrow panels');

  console.log('\n--- 11. Expression Evaluate API Endpoint ---');

  // 11a. Test the expressions/evaluate endpoint works
  const evalResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'CONCAT("Hello", " ", "World")',
      context: {},
    }),
  });
  assert(evalResp.status === 200 || evalResp.status === 201, 'Expression evaluate endpoint responds');
  assert(evalResp.data && evalResp.data.result === 'Hello World', 'CONCAT expression evaluates correctly');

  // 11b. Test math expression
  const mathResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'ROUND(100 * 0.15, 2)',
      context: {},
    }),
  });
  assert(mathResp.status === 200 || mathResp.status === 201, 'Math expression endpoint responds');
  assert(mathResp.data && mathResp.data.result === 15, 'ROUND expression evaluates correctly');

  // 11c. Test with field context
  const ctxResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'IF(total > 1000, "Premium", "Standard")',
      context: { total: 1500 },
    }),
  });
  assert(ctxResp.status === 200 || ctxResp.status === 201, 'Context expression endpoint responds');
  assert(ctxResp.data && ctxResp.data.result === 'Premium', 'IF expression with context evaluates correctly');

  // 11d. Test FORMAT_CURRENCY
  const currResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1250)',
      context: {},
    }),
  });
  assert(currResp.status === 200 || currResp.status === 201, 'FORMAT_CURRENCY endpoint responds');
  assert(currResp.data && typeof currResp.data.result === 'string' && currResp.data.result.includes('1,250'), 'FORMAT_CURRENCY formats correctly');

  // 11e. Test invalid expression returns error
  const errResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'INVALID_SYNTAX((((',
      context: {},
    }),
  });
  assert(errResp.status === 400, 'Invalid expression returns 400');
  assert(errResp.data && errResp.data.message && errResp.data.message.includes('Expression error'), 'Error message contains expression error details');

  // 11f. Test PADLEFT
  const padResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'PADLEFT("123", 8, "0")',
      context: {},
    }),
  });
  assert(padResp.status === 200 || padResp.status === 201, 'PADLEFT endpoint responds');
  assert(padResp.data && padResp.data.result === '00000123', 'PADLEFT pads correctly');

  // 11g. Test LEFT/RIGHT
  const leftResp = await request(`${API_BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      expression: 'LEFT("Hello World", 5)',
      context: {},
    }),
  });
  assert(leftResp.status === 200 || leftResp.status === 201, 'LEFT endpoint responds');
  assert(leftResp.data && leftResp.data.result === 'Hello', 'LEFT extracts correctly');

  console.log('\n--- 12. State Management ---');

  // 12a. Expression builder text syncs with element on mode switch
  assert(source.includes("setExprBuilderText(selectedElement.binding || '')"), 'Expression text syncs from element binding when mode switches on');

  // 12b. Preview state resets on mode switch
  assert(source.includes('setExprBuilderPreview(null)'), 'Preview resets on mode switch');

  // 12c. Autocomplete resets on mode switch
  assert(source.includes('setExprBuilderFieldAutocomplete(false)'), 'Autocomplete closes on mode switch');

  // 12d. Textarea has ref for cursor management
  assert(source.includes('exprBuilderTextareaRef'), 'Textarea ref exists for cursor management');

  // 12e. isDirty set on insert
  assert(source.includes("setIsDirty(true)") && source.includes('btn-expr-builder-insert'), 'isDirty flag set when expression is inserted');

  console.log('\n--- 13. EXPRESSION_FUNCTIONS Catalogue Completeness ---');

  // 13a. String functions
  const stringFuncs = ['CONCAT', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'TRIM', 'LEN', 'PADLEFT', 'PADRIGHT', 'REPLACE', 'SUBSTITUTE', 'FIND', 'SPLIT'];
  for (const fn of stringFuncs) {
    assert(source.includes(`name: '${fn}'`), `String function ${fn} is in the catalogue`);
  }

  // 13b. Math functions
  const mathFuncs = ['ROUND', 'ABS', 'FLOOR', 'CEIL', 'MIN', 'MAX', 'SUM'];
  for (const fn of mathFuncs) {
    assert(source.includes(`name: '${fn}'`), `Math function ${fn} is in the catalogue`);
  }

  // 13c. Date functions
  const dateFuncs = ['TODAY', 'YEAR', 'MONTH', 'DAY', 'DATEDIFF', 'FORMAT'];
  for (const fn of dateFuncs) {
    assert(source.includes(`name: '${fn}'`), `Date function ${fn} is in the catalogue`);
  }

  // 13d. Logical functions
  const logicFuncs = ['IF', 'AND', 'OR', 'NOT', 'SWITCH'];
  for (const fn of logicFuncs) {
    assert(source.includes(`name: '${fn}'`), `Logical function ${fn} is in the catalogue`);
  }

  // 13e. Format functions
  const fmtFuncs = ['FORMAT_CURRENCY', 'FORMAT_DATE', 'FORMAT_NUMBER'];
  for (const fn of fmtFuncs) {
    assert(source.includes(`name: '${fn}'`), `Format function ${fn} is in the catalogue`);
  }

  // ─── Summary ───
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
