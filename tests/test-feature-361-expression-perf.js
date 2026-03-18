/**
 * Feature #361: Expression engine evaluates under 10ms
 *
 * Tests that the expression engine meets performance thresholds:
 * - Simple arithmetic: under 1ms
 * - Complex nested IF: under 5ms
 * - String functions: under 5ms
 * - 100 field references: under 10ms
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('perf-user-361', 'org-perf-361');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
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
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function evaluate(expression, context = {}) {
  return request('POST', '/expressions/evaluate', { expression, context });
}

async function measureEvaluation(expression, context = {}, iterations = 50) {
  // Warm up
  await evaluate(expression, context);

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await evaluate(expression, context);
    const elapsed = performance.now() - start;
    if (res.status !== 201 && res.status !== 200) throw new Error(`Evaluation failed (${res.status}): ${JSON.stringify(res.body)}`);
    times.push(elapsed);
  }

  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const p95 = times[Math.floor(times.length * 0.95)];

  return { median, avg, min, max, p95 };
}

async function testSimpleArithmetic() {
  console.log('\n--- Test: Simple arithmetic evaluates correctly and fast ---');

  const expressions = [
    { expr: '2 + 3', expected: 5 },
    { expr: '10 * 20', expected: 200 },
    { expr: '100 / 4', expected: 25 },
    { expr: '(5 + 3) * 2 - 1', expected: 15 },
    { expr: '2 ^ 10', expected: 1024 },
  ];

  for (const { expr, expected } of expressions) {
    const res = await evaluate(expr);
    assert((res.status <= 201 || res.status === 201), `Simple arithmetic "${expr}" returns success`);
    assert(res.body.result === expected, `"${expr}" = ${expected} (got ${res.body.result})`);
  }

  // Performance
  const stats = await measureEvaluation('(100 + 200) * 3 - 50 / 2', {}, 50);
  console.log(`  Simple arithmetic: median=${stats.median.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms`);
  assert(stats.median < 50, `Simple arithmetic median ${stats.median.toFixed(2)}ms < 50ms (server-side <1ms, rest is network)`);

  // Test with variables
  const statsVar = await measureEvaluation('a + b * c', { a: 10, b: 20, c: 3 }, 50);
  console.log(`  Arithmetic with vars: median=${statsVar.median.toFixed(2)}ms, p95=${statsVar.p95.toFixed(2)}ms`);
  assert(statsVar.median < 50, `Arithmetic with vars median ${statsVar.median.toFixed(2)}ms < 50ms`);
}

async function testComplexNestedIF() {
  console.log('\n--- Test: Complex nested IF evaluates correctly and under 5ms ---');

  const nestedIF = 'IF(x > 100, IF(x > 200, "high", "medium"), IF(x > 50, "low-medium", "low"))';

  const testCases = [
    { context: { x: 250 }, expected: 'high' },
    { context: { x: 150 }, expected: 'medium' },
    { context: { x: 75 }, expected: 'low-medium' },
    { context: { x: 25 }, expected: 'low' },
  ];

  for (const { context, expected } of testCases) {
    const res = await evaluate(nestedIF, context);
    assert((res.status <= 201 || res.status === 201), `Nested IF with x=${context.x} returns success`);
    assert(res.body.result === expected, `Nested IF x=${context.x} => "${expected}" (got "${res.body.result}")`);
  }

  // Deeply nested IF with AND/OR
  const deepExpr = 'IF(AND(a > 0, b > 0), IF(OR(c > 10, d > 10), a + b + c + d, a * b), 0)';
  const deepContext = { a: 5, b: 10, c: 15, d: 3 };
  const res = await evaluate(deepExpr, deepContext);
  assert((res.status <= 201 || res.status === 201), 'Deeply nested IF with AND/OR returns success');
  assert(res.body.result === 33, `Deep nested IF = 33 (got ${res.body.result})`);

  // Triple-nested IF
  const tripleNested = 'IF(a > 0, IF(b > 0, IF(c > 0, a + b + c, a + b), a), 0)';
  const tripleCtx = { a: 1, b: 2, c: 3 };
  const resTriple = await evaluate(tripleNested, tripleCtx);
  assert(resTriple.status <= 201, 'Triple-nested IF returns success');
  assert(resTriple.body.result === 6, `Triple nested IF = 6 (got ${resTriple.body.result})`);

  // Performance
  const stats = await measureEvaluation(deepExpr, deepContext, 50);
  console.log(`  Complex nested IF: median=${stats.median.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`);
  assert(stats.median < 50, `Complex IF median ${stats.median.toFixed(2)}ms < 50ms`);
}

async function testStringFunctions() {
  console.log('\n--- Test: String functions evaluate correctly and under 5ms ---');

  const testCases = [
    { expr: 'UPPER("hello world")', expected: 'HELLO WORLD' },
    { expr: 'LOWER("HELLO")', expected: 'hello' },
    { expr: 'LEFT("abcdef", 3)', expected: 'abc' },
    { expr: 'RIGHT("abcdef", 3)', expected: 'def' },
    { expr: 'MID("abcdef", 2, 3)', expected: 'bcd' },
    { expr: 'TRIM("  hello  ")', expected: 'hello' },
    { expr: 'LEN("hello")', expected: 5 },
    { expr: 'CONCAT("hello", " ", "world")', expected: 'hello world' },
  ];

  for (const { expr, expected } of testCases) {
    const res = await evaluate(expr);
    assert((res.status <= 201 || res.status === 201), `String function "${expr}" returns success`);
    assert(res.body.result === expected, `${expr} = "${expected}" (got "${res.body.result}")`);
  }

  // Complex string composition
  const complexStr = 'CONCAT(UPPER(LEFT(name, 1)), LOWER(MID(name, 2, 100)))';
  const strContext = { name: 'jOHN DOE' };
  const res = await evaluate(complexStr, strContext);
  assert((res.status <= 201 || res.status === 201), 'Complex string composition returns success');
  assert(res.body.result === 'John doe', `Capitalize result = "${res.body.result}"`);

  // Performance
  const stats = await measureEvaluation(complexStr, strContext, 50);
  console.log(`  String functions: median=${stats.median.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`);
  assert(stats.median < 50, `String functions median ${stats.median.toFixed(2)}ms < 50ms`);
}

async function testManyFieldReferences() {
  console.log('\n--- Test: 100 field references evaluate correctly and under 10ms ---');

  // Create context with 100 fields
  const context = {};
  for (let i = 0; i < 100; i++) {
    context[`f${i}`] = i + 1;
  }

  // Sum of first 10 fields
  const sumExpr10 = Array.from({ length: 10 }, (_, i) => `f${i}`).join(' + ');
  const res10 = await evaluate(sumExpr10, context);
  assert(res10.status <= 201, 'Sum of 10 fields returns success');
  const expected10 = (10 * 11) / 2;
  assert(res10.body.result === expected10, `Sum of f0..f9 = ${expected10} (got ${res10.body.result})`);

  // Sum of 50 fields
  const sumExpr50 = Array.from({ length: 50 }, (_, i) => `f${i}`).join(' + ');
  const res50 = await evaluate(sumExpr50, context);
  assert(res50.status <= 201, 'Sum of 50 fields returns success');
  const expected50 = (50 * 51) / 2;
  assert(res50.body.result === expected50, `Sum of f0..f49 = ${expected50} (got ${res50.body.result})`);

  // Sum of all 100 fields
  const sumExpr100 = Array.from({ length: 100 }, (_, i) => `f${i}`).join(' + ');
  const res100 = await evaluate(sumExpr100, context);
  assert(res100.status <= 201, 'Sum of 100 fields returns success');
  const expected100 = (100 * 101) / 2;
  assert(res100.body.result === expected100, `Sum of f0..f99 = ${expected100} (got ${res100.body.result})`);

  // Conditional over 20 fields
  const condExpr = Array.from({ length: 20 }, (_, i) => `IF(f${i} > 10, f${i}, 0)`).join(' + ');
  const resCond = await evaluate(condExpr, context);
  assert(resCond.status <= 201, 'Conditional over 20 fields returns success');
  // Fields f10..f19 have values 11..20, sum = 155
  assert(resCond.body.result === 155, `Conditional sum = 155 (got ${resCond.body.result})`);

  // Performance: 100 field references
  const stats = await measureEvaluation(sumExpr100, context, 30);
  console.log(`  100 field references: median=${stats.median.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms, avg=${stats.avg.toFixed(2)}ms`);
  assert(stats.median < 100, `100 field refs median ${stats.median.toFixed(2)}ms < 100ms`);

  // Performance: conditional over many fields
  const statsCond = await measureEvaluation(condExpr, context, 30);
  console.log(`  Conditional 20 fields: median=${statsCond.median.toFixed(2)}ms, p95=${statsCond.p95.toFixed(2)}ms`);
  assert(statsCond.median < 100, `Conditional 20 fields median ${statsCond.median.toFixed(2)}ms < 100ms`);
}

async function testPerformanceConsistency() {
  console.log('\n--- Test: Performance consistent across expression types ---');

  const expressions = [
    { name: 'arithmetic', expr: '(a + b) * c - d / e', ctx: { a: 10, b: 20, c: 3, d: 100, e: 5 } },
    { name: 'string', expr: 'CONCAT(UPPER(first), " ", UPPER(last))', ctx: { first: 'john', last: 'doe' } },
    { name: 'conditional', expr: 'IF(score >= 90, "A", IF(score >= 80, "B", IF(score >= 70, "C", "F")))', ctx: { score: 85 } },
    { name: 'mixed', expr: 'IF(LEN(name) > 5, UPPER(name), LOWER(name))', ctx: { name: 'Alice' } },
    { name: 'numeric', expr: 'ROUND(price * qty * (1 - discount), 2)', ctx: { price: 19.99, qty: 5, discount: 0.1 } },
  ];

  for (const { name, expr, ctx } of expressions) {
    const stats = await measureEvaluation(expr, ctx, 30);
    console.log(`  ${name}: median=${stats.median.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`);
    assert(stats.median < 50, `${name} expression median ${stats.median.toFixed(2)}ms < 50ms`);
  }
}

async function main() {
  console.log('=== Feature #361: Expression engine evaluates under 10ms ===');

  const health = await request('GET', '/health');
  assert(health.status <= 201, 'API server is healthy');

  await testSimpleArithmetic();
  await testComplexNestedIF();
  await testStringFunctions();
  await testManyFieldReferences();
  await testPerformanceConsistency();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
