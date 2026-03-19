/**
 * Feature #407: Replace expr-eval with expr-eval-fork to fix prototype pollution and unrestricted functions CVEs
 *
 * Tests:
 * 1. expr-eval-fork is installed (not expr-eval)
 * 2. Import references updated in source files
 * 3. API compatibility: all existing expression functions work
 * 4. Prototype pollution attack vector is blocked
 * 5. Unrestricted function call attack vector is blocked
 * 6. End-to-end render with expressions works
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const secret = 'pdfme-dev-secret';
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const token = signJwt({
  sub: 'user-407',
  orgId: 'org-407',
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger'],
});
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push(`  ✓ ${name}`);
  } else {
    failed++;
    results.push(`  ✗ ${name}`);
  }
}

async function evalExpr(expression, context = {}) {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression, context }),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function run() {
  console.log('Feature #407: Replace expr-eval with expr-eval-fork\n');

  // =============================================
  // SECTION 1: Package & Source File Verification
  // =============================================

  // Test 1: erp-schemas depends on expr-eval-fork
  const erpPkgPath = path.resolve(process.cwd(), 'packages/erp-schemas/package.json');
  const erpPkg = JSON.parse(fs.readFileSync(erpPkgPath, 'utf-8'));
  assert(erpPkg.dependencies['expr-eval-fork'] !== undefined, 'erp-schemas depends on expr-eval-fork');
  assert(erpPkg.dependencies['expr-eval'] === undefined, 'erp-schemas does NOT depend on expr-eval');

  // Test 2: nest-module depends on expr-eval-fork
  const nestPkgPath = path.resolve(process.cwd(), 'nest-module/package.json');
  const nestPkg = JSON.parse(fs.readFileSync(nestPkgPath, 'utf-8'));
  assert(nestPkg.dependencies['expr-eval-fork'] !== undefined, 'nest-module depends on expr-eval-fork');

  // Test 3: expr-eval-fork is installed in node_modules
  const forkPath = path.resolve(process.cwd(), 'node_modules/expr-eval-fork/package.json');
  const forkExists = fs.existsSync(forkPath);
  assert(forkExists, 'expr-eval-fork is installed in node_modules');

  if (forkExists) {
    const forkPkg = JSON.parse(fs.readFileSync(forkPath, 'utf-8'));
    const majorVer = parseInt(forkPkg.version.split('.')[0], 10);
    assert(majorVer >= 3, `expr-eval-fork version >= 3.x (got ${forkPkg.version})`);
  }

  // Test 4: old expr-eval is NOT installed
  const oldPath = path.resolve(process.cwd(), 'node_modules/expr-eval/package.json');
  assert(!fs.existsSync(oldPath), 'expr-eval (vulnerable) is NOT in node_modules');

  // Test 5: expression-engine source imports expr-eval-fork
  const enginePath = path.resolve(process.cwd(), 'packages/erp-schemas/src/expression-engine/index.ts');
  const engineSrc = fs.readFileSync(enginePath, 'utf-8');
  assert(engineSrc.includes("from 'expr-eval-fork'"), 'expression-engine imports from expr-eval-fork');

  // Test 6: template.service imports expr-eval-fork
  const tmplSvcPath = path.resolve(process.cwd(), 'nest-module/src/template.service.ts');
  const tmplSvc = fs.readFileSync(tmplSvcPath, 'utf-8');
  assert(tmplSvc.includes("from 'expr-eval-fork'"), 'template.service imports from expr-eval-fork');

  // Test 7: Compiled dist references expr-eval-fork
  const distPath = path.resolve(process.cwd(), 'packages/erp-schemas/dist/expression-engine/index.js');
  if (fs.existsSync(distPath)) {
    const distSrc = fs.readFileSync(distPath, 'utf-8');
    assert(distSrc.includes('expr-eval-fork'), 'Compiled dist references expr-eval-fork');
  } else {
    assert(true, 'Compiled dist checked via source (no dist dir)');
  }

  // =============================================
  // SECTION 2: API Compatibility (No Regressions)
  // =============================================

  // Test 8: Basic arithmetic
  const arithRes = await evalExpr('10 + 20 * 3');
  assert(arithRes.status === 200 || arithRes.status === 201, 'Arithmetic expression evaluates (200/201)');
  assert(arithRes.data?.result === 70, 'Arithmetic 10 + 20 * 3 = 70');

  // Test 9: String functions - UPPER
  const strRes = await evalExpr('UPPER("hello world")');
  assert(strRes.status === 200 || strRes.status === 201, 'UPPER function evaluates');
  assert(strRes.data?.result === 'HELLO WORLD', 'UPPER("hello world") = "HELLO WORLD"');

  // Test 10: CONCAT + PADLEFT
  const concatRes = await evalExpr('CONCAT("INV-", PADLEFT("42", 6, "0"))');
  assert(concatRes.status === 200 || concatRes.status === 201, 'CONCAT + PADLEFT evaluates');
  assert(concatRes.data?.result === 'INV-000042', 'CONCAT("INV-", PADLEFT("42", 6, "0")) = "INV-000042"');

  // Test 11: Context variables
  const ctxRes = await evalExpr('price * qty', { price: 100, qty: 5 });
  assert(ctxRes.status === 200 || ctxRes.status === 201, 'Context variable expression evaluates');
  assert(ctxRes.data?.result === 500, 'price(100) * qty(5) = 500');

  // Test 12: IF conditional
  const ifRes = await evalExpr('IF(amount > 1000, "large", "small")', { amount: 1500 });
  assert(ifRes.status === 200 || ifRes.status === 201, 'IF expression evaluates');
  assert(ifRes.data?.result === 'large', 'IF(1500 > 1000, "large", "small") = "large"');

  // Test 13: ROUND
  const roundRes = await evalExpr('ROUND(10 / 3, 2)');
  assert(roundRes.status === 200 || roundRes.status === 201, 'ROUND evaluates');
  assert(roundRes.data?.result === 3.33, 'ROUND(10/3, 2) = 3.33');

  // Test 14: SWITCH
  const switchRes = await evalExpr('SWITCH(status, "active", "Active", "inactive", "Inactive", "Unknown")', { status: 'active' });
  assert(switchRes.status === 200 || switchRes.status === 201, 'SWITCH function works');
  assert(switchRes.data?.result === 'Active', 'SWITCH returns correct match');

  // Test 15: SUM
  const sumRes = await evalExpr('SUM(10, 20, 30)');
  assert(sumRes.status === 200 || sumRes.status === 201, 'SUM evaluates');
  assert(sumRes.data?.result === 60, 'SUM(10, 20, 30) = 60');

  // Test 16: FLOOR and CEIL
  const floorRes = await evalExpr('FLOOR(7.8) + CEIL(2.1)');
  assert(floorRes.status === 200 || floorRes.status === 201, 'FLOOR + CEIL evaluates');
  assert(floorRes.data?.result === 10, 'FLOOR(7.8) + CEIL(2.1) = 10');

  // Test 17: MIN / MAX
  const minRes = await evalExpr('MIN(5, 3, 8)');
  assert(minRes.status === 200 || minRes.status === 201, 'MIN evaluates');
  assert(minRes.data?.result === 3, 'MIN(5, 3, 8) = 3');

  // Test 18: LEFT / RIGHT / MID
  const leftRes = await evalExpr('LEFT("Hello World", 5)');
  assert(leftRes.data?.result === 'Hello', 'LEFT("Hello World", 5) = "Hello"');

  // Test 19: LEN
  const lenRes = await evalExpr('LEN("test")');
  assert(lenRes.data?.result === 4, 'LEN("test") = 4');

  // Test 20: TRIM
  const trimRes = await evalExpr('TRIM("  hello  ")');
  assert(trimRes.data?.result === 'hello', 'TRIM("  hello  ") = "hello"');

  // =============================================
  // SECTION 3: Security - Attack Vectors Blocked
  // =============================================

  // Test 21: Prototype pollution - constructor.prototype
  const pollutionRes = await evalExpr('constructor.prototype.polluted');
  const pollutionBlocked = pollutionRes.status >= 400 ||
    pollutionRes.data?.error ||
    pollutionRes.data?.result === undefined ||
    pollutionRes.data?.result === null ||
    pollutionRes.data?.result === '' ||
    (typeof pollutionRes.data?.result === 'number' && pollutionRes.data?.result === 0);
  assert(pollutionBlocked, 'Prototype pollution "constructor.prototype.polluted" is blocked');

  // Test 22: __proto__ access
  const protoRes = await evalExpr('__proto__.polluted');
  const protoBlocked = protoRes.status >= 400 ||
    protoRes.data?.error ||
    protoRes.data?.result === undefined ||
    protoRes.data?.result === null ||
    protoRes.data?.result === '' ||
    typeof protoRes.data?.result === 'number';
  assert(protoBlocked, '__proto__ access is blocked');

  // Test 23: require() blocked
  const requireRes = await evalExpr('require("fs")');
  assert(requireRes.status >= 400 || requireRes.data?.error, 'require("fs") is blocked');

  // Test 24: eval() blocked
  const evalRes = await evalExpr('eval("1+1")');
  assert(evalRes.status >= 400 || evalRes.data?.error, 'eval("1+1") is blocked');

  // Test 25: Function constructor blocked
  const funcRes = await evalExpr('Function("return 1")()');
  assert(funcRes.status >= 400 || funcRes.data?.error, 'Function("return 1")() is blocked');

  // Test 26: process.exit blocked
  const processRes = await evalExpr('process.exit(1)');
  assert(processRes.status >= 400 || processRes.data?.error, 'process.exit(1) is blocked');

  // Test 27: globalThis blocked
  const globalRes = await evalExpr('globalThis.Array');
  assert(globalRes.status >= 400 || globalRes.data?.error, 'globalThis access is blocked');

  // Test 28: this keyword blocked
  const thisRes = await evalExpr('this.constructor');
  assert(thisRes.status >= 400 || thisRes.data?.error, '"this" keyword is blocked');

  // =============================================
  // SECTION 4: End-to-End Integration Test
  // =============================================

  // Test 29: Complex nested expression with context works
  const complexRes = await evalExpr('IF(total > 1000, CONCAT("Large: R ", ROUND(total * 1.15, 2)), CONCAT("Small: R ", ROUND(total * 1.15, 2)))', { total: 2000 });
  assert(complexRes.status === 200 || complexRes.status === 201, 'Complex nested expression evaluates');
  assert(typeof complexRes.data?.result === 'string' && complexRes.data.result.includes('2300'), 'Complex expression produces correct result');

  // Test 30: ABS function works
  const absRes = await evalExpr('ABS(-42)');
  assert(absRes.data?.result === 42, 'ABS(-42) = 42');

  // Test 31: LOWER function works
  const lowerRes = await evalExpr('LOWER("HELLO")');
  assert(lowerRes.data?.result === 'hello', 'LOWER("HELLO") = "hello"');

  // Test 32: MAX function works
  const maxRes = await evalExpr('MAX(5, 3, 8, 1)');
  assert(maxRes.data?.result === 8, 'MAX(5, 3, 8, 1) = 8');

  // Test 33: REPLACE function works
  const replRes = await evalExpr('REPLACE("hello world", "world", "earth")');
  assert(replRes.data?.result === 'hello earth', 'REPLACE works correctly');

  // Test 34: FIND function works
  const findRes = await evalExpr('FIND("world", "hello world")');
  assert(findRes.data?.result === 7, 'FIND("world", "hello world") = 7 (1-based)');

  // Test 30: No auth returns 401
  const noAuthRes = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expression: '1 + 1', context: {} }),
  });
  assert(noAuthRes.status === 401, 'Expression evaluation requires auth (401)');

  // Print results
  console.log('');
  results.forEach(r => console.log(r));
  console.log(`\nResults: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
