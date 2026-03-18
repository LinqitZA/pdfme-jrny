/**
 * Test script for ExpressionEngine
 * Tests features #109, #110, #111
 */

// We need to use the source directly since it's TypeScript
// Use a simple require approach with ts-node register
require('@swc/register');
const { ExpressionEngine } = require('../packages/erp-schemas/src/expression-engine/index.ts');

const engine = new ExpressionEngine();
let passed = 0;
let failed = 0;

function assert(testName, actual, expected) {
  if (actual === expected) {
    passed++;
    // silent on pass
  } else {
    failed++;
    console.log('FAIL:', testName, '- expected:', expected, 'got:', actual);
  }
}

// ====== Feature #109: Arithmetic Operations ======
console.log('=== Feature #109: Arithmetic Operations ===');

// Basic arithmetic
assert('2+3', engine.evaluate('2+3'), 5);
assert('10-4', engine.evaluate('10-4'), 6);
assert('3*7', engine.evaluate('3*7'), 21);
assert('20/4', engine.evaluate('20/4'), 5);

// Field references
assert('field.price * field.qty', engine.evaluate('field.price * field.qty', { field: { price: 10.50, qty: 3 } }), 31.5);
assert('simple vars a*b', engine.evaluate('a*b', { a: 6, b: 7 }), 42);

// Parentheses and precedence
assert('(a+b)/c', engine.evaluate('(a+b)/c', { a: 10, b: 20, c: 5 }), 6);
assert('2+3*4 (precedence)', engine.evaluate('2+3*4'), 14);
assert('(2+3)*4', engine.evaluate('(2+3)*4'), 20);

// Decimal precision
assert('0.1+0.2 approx', Math.abs(engine.evaluate('0.1+0.2') - 0.3) < 1e-10, true);
assert('10.5 * 2', engine.evaluate('10.5 * 2'), 21);
assert('7/3 decimal', typeof engine.evaluate('7/3'), 'number');

// Negative numbers
assert('5 + (-3)', engine.evaluate('5 + (-3)'), 2);

// Modulo
assert('10 % 3', engine.evaluate('10 % 3'), 1);

console.log('Feature #109 done');

// ====== Feature #110: String Functions ======
console.log('\n=== Feature #110: String Functions ===');

assert("LEFT('Hello', 3)", engine.evaluate("LEFT('Hello', 3)"), 'Hel');
assert("RIGHT('Hello', 2)", engine.evaluate("RIGHT('Hello', 2)"), 'lo');
assert("MID('Hello', 2, 3)", engine.evaluate("MID('Hello', 2, 3)"), 'ell');
assert("UPPER('hello')", engine.evaluate("UPPER('hello')"), 'HELLO');
assert("LOWER('HELLO')", engine.evaluate("LOWER('HELLO')"), 'hello');
assert("TRIM('  hi  ')", engine.evaluate("TRIM('  hi  ')"), 'hi');
assert("CONCAT('a','b')", engine.evaluate("CONCAT('a','b')"), 'ab');
assert("CONCAT multiple", engine.evaluate("CONCAT('a','b','c')"), 'abc');
assert("LEN('test')", engine.evaluate("LEN('test')"), 4);
assert("LEN empty", engine.evaluate("LEN('')"), 0);

console.log('Feature #110 done');

// ====== Feature #111: Conditional Functions ======
console.log('\n=== Feature #111: Conditional Functions ===');

assert("IF(true, 'yes', 'no')", engine.evaluate("IF(1, 'yes', 'no')"), 'yes');
assert("IF(false, 'yes', 'no')", engine.evaluate("IF(0, 'yes', 'no')"), 'no');

// Nested IF
assert("Nested IF", engine.evaluate("IF(0, 'a', IF(1, 'b', 'c'))"), 'b');

// AND
assert("AND(true,true)", engine.evaluate("AND(1,1)"), true);
assert("AND(true,false)", engine.evaluate("AND(1,0)"), false);

// OR
assert("OR(false,true)", engine.evaluate("OR(0,1)"), true);
assert("OR(false,false)", engine.evaluate("OR(0,0)"), false);

// NOT
assert("NOT(true)", engine.evaluate("NOT(1)"), false);
assert("NOT(false)", engine.evaluate("NOT(0)"), true);

console.log('Feature #111 done');

// ====== Summary ======
console.log('\n=== SUMMARY ===');
console.log('Passed:', passed);
console.log('Failed:', failed);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
