/**
 * Feature #38: Expression engine is sandboxed - no Node.js globals
 *
 * Expression evaluation cannot access require, eval, process, etc.
 * Only whitelisted functions (string, date, numeric, conditional, locale) are accessible.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('sandbox-test', 'sandbox-org', [
  'template:view', 'template:edit', 'template:publish', 'render:trigger',
]);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}`);
  }
}

async function evalExpr(expression, context) {
  return request('POST', '/api/pdfme/expressions/evaluate', { expression, context });
}

async function run() {
  console.log('Feature #38: Expression engine is sandboxed - no Node.js globals\n');

  // === 1. require('fs') is rejected ===
  console.log('Test 1: require() is rejected');
  const r1 = await evalExpr("require('fs')");
  assert(r1.status === 400, 'require(fs): returns 400');
  assert(r1.body.message && r1.body.message.includes('Sandbox violation'), 'require(fs): sandbox violation message');
  assert(r1.body.message && r1.body.message.includes('require'), 'require(fs): mentions "require"');

  // === 2. eval() is rejected ===
  console.log('Test 2: eval() is rejected');
  const r2 = await evalExpr("eval('1+1')");
  assert(r2.status === 400, 'eval(): returns 400');
  assert(r2.body.message && r2.body.message.includes('Sandbox violation'), 'eval(): sandbox violation message');
  assert(r2.body.message && r2.body.message.includes('eval'), 'eval(): mentions "eval"');

  // === 3. process.env is rejected ===
  console.log('Test 3: process.env is rejected');
  const r3 = await evalExpr('process.env');
  assert(r3.status === 400, 'process.env: returns 400');
  assert(r3.body.message && r3.body.message.includes('Sandbox violation'), 'process.env: sandbox violation message');
  assert(r3.body.message && r3.body.message.includes('process'), 'process.env: mentions "process"');

  // === 4. global is rejected ===
  console.log('Test 4: global is rejected');
  const r4 = await evalExpr('global');
  assert(r4.status === 400, 'global: returns 400');
  assert(r4.body.message && r4.body.message.includes('Sandbox violation'), 'global: sandbox violation message');
  assert(r4.body.message && r4.body.message.includes('global'), 'global: mentions "global"');

  // === 5. globalThis is rejected ===
  console.log('Test 5: globalThis is rejected');
  const r5 = await evalExpr('globalThis');
  assert(r5.status === 400, 'globalThis: returns 400');
  assert(r5.body.message && r5.body.message.includes('Sandbox violation'), 'globalThis: sandbox violation message');

  // === 6. Function constructor is rejected ===
  console.log('Test 6: Function constructor is rejected');
  const r6 = await evalExpr('Function("return 1")');
  assert(r6.status === 400, 'Function(): returns 400');
  assert(r6.body.message && r6.body.message.includes('Sandbox violation'), 'Function(): sandbox violation message');

  // === 7. module is rejected ===
  console.log('Test 7: module is rejected');
  const r7 = await evalExpr('module.exports');
  assert(r7.status === 400, 'module: returns 400');
  assert(r7.body.message && r7.body.message.includes('Sandbox violation'), 'module: sandbox violation message');

  // === 8. constructor is rejected ===
  console.log('Test 8: constructor is rejected');
  const r8 = await evalExpr('constructor');
  assert(r8.status === 400, 'constructor: returns 400');
  assert(r8.body.message && r8.body.message.includes('Sandbox violation'), 'constructor: sandbox violation message');

  // === 9. __proto__ is rejected ===
  console.log('Test 9: __proto__ is rejected');
  const r9 = await evalExpr('__proto__');
  assert(r9.status === 400, '__proto__: returns 400');
  assert(r9.body.message && r9.body.message.includes('Sandbox violation'), '__proto__: sandbox violation message');

  // === 10. setTimeout is rejected ===
  console.log('Test 10: setTimeout is rejected');
  const r10 = await evalExpr('setTimeout(1, 1000)');
  assert(r10.status === 400, 'setTimeout: returns 400');
  assert(r10.body.message && r10.body.message.includes('Sandbox violation'), 'setTimeout: sandbox violation message');

  // === 11. import is rejected ===
  console.log('Test 11: import is rejected');
  const r11 = await evalExpr('import("fs")');
  assert(r11.status === 400, 'import: returns 400');
  assert(r11.body.message && r11.body.message.includes('Sandbox violation'), 'import: sandbox violation message');

  // === 12. Buffer is rejected ===
  console.log('Test 12: Buffer is rejected');
  const r12 = await evalExpr('Buffer.from("test")');
  assert(r12.status === 400, 'Buffer: returns 400');
  assert(r12.body.message && r12.body.message.includes('Sandbox violation'), 'Buffer: sandbox violation message');

  // ============================================
  // Verify whitelisted functions WORK correctly
  // ============================================

  // === 13. Arithmetic works ===
  console.log('Test 13: Arithmetic expressions work');
  const r13 = await evalExpr('2 + 3 * 4');
assert(r13.status >= 200 && r13.status < 300, 'arithmetic: returns 200');
  assert(r13.body.result === 14, 'arithmetic: 2+3*4 = 14');

  // === 14. String functions work ===
  console.log('Test 14: String functions work');
  const r14 = await evalExpr('UPPER("hello")');
  assert(r14.status < 300, 'UPPER: returns 200');
  assert(r14.body.result === 'HELLO', 'UPPER("hello") = "HELLO"');

  const r14b = await evalExpr('LOWER("WORLD")');
  assert(r14b.status < 300, 'LOWER: returns 200');
  assert(r14b.body.result === 'world', 'LOWER("WORLD") = "world"');

  const r14c = await evalExpr('LEFT("abcdef", 3)');
  assert(r14c.status < 300, 'LEFT: returns 200');
  assert(r14c.body.result === 'abc', 'LEFT("abcdef",3) = "abc"');

  const r14d = await evalExpr('LEN("hello")');
  assert(r14d.status < 300, 'LEN: returns 200');
  assert(r14d.body.result === 5, 'LEN("hello") = 5');

  const r14e = await evalExpr('TRIM("  hi  ")');
  assert(r14e.status < 300, 'TRIM: returns 200');
  assert(r14e.body.result === 'hi', 'TRIM("  hi  ") = "hi"');

  // === 15. Conditional functions work ===
  console.log('Test 15: Conditional functions work');
  const r15 = await evalExpr('IF(1 > 0, "yes", "no")');
  assert(r15.status < 300, 'IF: returns 200');
  assert(r15.body.result === 'yes', 'IF(1>0, "yes","no") = "yes"');

  const r15b = await evalExpr('AND(1, 1, 1)');
  assert(r15b.status < 300, 'AND: returns 200');
  assert(r15b.body.result === true, 'AND(1,1,1) = true');

  const r15c = await evalExpr('OR(0, 0, 1)');
  assert(r15c.status < 300, 'OR: returns 200');
  assert(r15c.body.result === true, 'OR(0,0,1) = true');

  const r15d = await evalExpr('NOT(0)');
  assert(r15d.status < 300, 'NOT: returns 200');
  assert(r15d.body.result === true, 'NOT(0) = true');

  // === 16. Numeric functions work ===
  console.log('Test 16: Numeric functions work');
  const r16 = await evalExpr('ROUND(3.14159, 2)');
  assert(r16.status < 300, 'ROUND: returns 200');
  assert(r16.body.result === 3.14, 'ROUND(3.14159, 2) = 3.14');

  const r16b = await evalExpr('ABS(-42)');
  assert(r16b.status < 300, 'ABS: returns 200');
  assert(r16b.body.result === 42, 'ABS(-42) = 42');

  // === 17. Field references work ===
  console.log('Test 17: Field references with context work');
  const r17 = await evalExpr('price * quantity', { price: 10, quantity: 5 });
  assert(r17.status < 300, 'field ref: returns 200');
  assert(r17.body.result === 50, 'price * quantity = 50');

  // === 18. FORMAT_CURRENCY works ===
  console.log('Test 18: Locale-aware functions work');
  const r18 = await evalExpr('FORMAT_CURRENCY(1234.56)');
  assert(r18.status < 300, 'FORMAT_CURRENCY: returns 200');
  assert(typeof r18.body.result === 'string', 'FORMAT_CURRENCY returns string');

  // === 19. Legitimate use of "processing" (contains "process" but is not a blocked keyword) ===
  console.log('Test 19: Word boundary check - "processing" allowed');
  const r19 = await evalExpr('processing + 1', { processing: 5 });
  assert(r19.status < 300, 'processing: returns 200 (not blocked)');
  assert(r19.body.result === 6, 'processing + 1 = 6');

  // === 20. Legitimate field name "evaluate" (contains "eval" but not blocked) ===
  console.log('Test 20: Word boundary check - "evaluate" allowed');
  const r20 = await evalExpr('evaluate + 1', { evaluate: 10 });
  // "evaluate" contains "eval" as word boundary match? Let's see.
  // Actually "eval" is exactly 4 chars, "evaluate" starts with "eval" but the \b check:
  // \beval\b won't match "evaluate" because there's no word boundary after "eval" in "evaluate"
  assert(r20.status < 300, 'evaluate field: returns 200 (not blocked)');
  assert(r20.body.result === 11, 'evaluate + 1 = 11');

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed!');
  }
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
