/**
 * Feature #402: Add additional string and math functions to expression engine
 *
 * Tests for PADLEFT, PADRIGHT, REPLACE, SUBSTITUTE, SPLIT, FIND,
 * FLOOR, CEIL, MIN, MAX, SUM, SWITCH and NullSentinel handling.
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

const token = signJwt({
  sub: 'user-402',
  orgId: 'org-402',
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger'],
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

async function evalExpr(expression, context) {
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression, context: context || {} }),
  });
  return res.json();
}

// === PADLEFT tests ===
async function testPadLeftBasic() {
  const data = await evalExpr('PADLEFT("123", 8, "0")', {});
  assert(data.result === '00000123', 'PADLEFT("123", 8, "0") → "00000123"');
}

async function testPadLeftDefault() {
  const data = await evalExpr('PADLEFT("hi", 5)', {});
  assert(data.result === '   hi', 'PADLEFT("hi", 5) defaults to space pad');
}

async function testPadLeftNull() {
  const data = await evalExpr('PADLEFT(missing, 4, "0")', {});
  assert(data.result === '0000', 'PADLEFT(null, 4, "0") → "0000"');
}

async function testPadLeftNoExtend() {
  const data = await evalExpr('PADLEFT("abcde", 3, "0")', {});
  assert(data.result === 'abcde', 'PADLEFT does not truncate longer strings');
}

async function testPadLeftWithContext() {
  const data = await evalExpr('PADLEFT(InvoiceNr, 8, "0")', { InvoiceNr: '123' });
  assert(data.result === '00000123', 'PADLEFT with context field → "00000123"');
}

// === PADRIGHT tests ===
async function testPadRightBasic() {
  const data = await evalExpr('PADRIGHT("abc", 6, ".")', {});
  assert(data.result === 'abc...', 'PADRIGHT("abc", 6, ".") → "abc..."');
}

async function testPadRightDefault() {
  const data = await evalExpr('PADRIGHT("hi", 5)', {});
  assert(data.result === 'hi   ', 'PADRIGHT("hi", 5) defaults to space pad');
}

async function testPadRightNull() {
  const data = await evalExpr('PADRIGHT(missing, 3, "x")', {});
  assert(data.result === 'xxx', 'PADRIGHT(null, 3, "x") → "xxx"');
}

// === REPLACE tests ===
async function testReplaceBasic() {
  const data = await evalExpr('REPLACE("hello world", "world", "there")', {});
  assert(data.result === 'hello there', 'REPLACE replaces first occurrence');
}

async function testReplaceOnlyFirst() {
  const data = await evalExpr('REPLACE("aaa", "a", "b")', {});
  assert(data.result === 'baa', 'REPLACE replaces only first occurrence');
}

async function testReplaceNotFound() {
  const data = await evalExpr('REPLACE("hello", "xyz", "abc")', {});
  assert(data.result === 'hello', 'REPLACE returns original if not found');
}

async function testReplaceNull() {
  const data = await evalExpr('REPLACE(missing, "a", "b")', {});
  assert(data.result === '', 'REPLACE(null, ...) → ""');
}

// === SUBSTITUTE tests ===
async function testSubstituteAll() {
  const data = await evalExpr('SUBSTITUTE("aaa", "a", "b")', {});
  assert(data.result === 'bbb', 'SUBSTITUTE replaces all occurrences');
}

async function testSubstituteBasic() {
  const data = await evalExpr('SUBSTITUTE("hello-world-test", "-", " ")', {});
  assert(data.result === 'hello world test', 'SUBSTITUTE replaces all hyphens with spaces');
}

async function testSubstituteNull() {
  const data = await evalExpr('SUBSTITUTE(missing, "a", "b")', {});
  assert(data.result === '', 'SUBSTITUTE(null, ...) → ""');
}

// === SPLIT tests ===
async function testSplitBasic() {
  const data = await evalExpr('SPLIT("a,b,c", ",", 1)', {});
  assert(data.result === 'b', 'SPLIT("a,b,c", ",", 1) → "b"');
}

async function testSplitFirst() {
  const data = await evalExpr('SPLIT("hello world", " ", 0)', {});
  assert(data.result === 'hello', 'SPLIT first element');
}

async function testSplitOutOfRange() {
  const data = await evalExpr('SPLIT("a,b", ",", 5)', {});
  assert(data.result === '', 'SPLIT out of range → ""');
}

async function testSplitNull() {
  const data = await evalExpr('SPLIT(missing, ",", 0)', {});
  assert(data.result === '', 'SPLIT(null, ...) → ""');
}

// === FIND tests ===
async function testFindBasic() {
  const data = await evalExpr('FIND("world", "hello world")', {});
  assert(data.result === 7, 'FIND("world", "hello world") → 7 (1-based)');
}

async function testFindNotFound() {
  const data = await evalExpr('FIND("xyz", "hello")', {});
  assert(data.result === 0, 'FIND returns 0 if not found');
}

async function testFindNull() {
  const data = await evalExpr('FIND("a", missing)', {});
  assert(data.result === 0, 'FIND in null → 0');
}

async function testFindAtStart() {
  const data = await evalExpr('FIND("he", "hello")', {});
  assert(data.result === 1, 'FIND at start → 1');
}

// === FLOOR tests ===
async function testFloorBasic() {
  const data = await evalExpr('FLOOR(3.7)', {});
  assert(data.result === 3, 'FLOOR(3.7) → 3');
}

async function testFloorNegative() {
  const data = await evalExpr('FLOOR(-3.2)', {});
  assert(data.result === -4, 'FLOOR(-3.2) → -4');
}

async function testFloorInteger() {
  const data = await evalExpr('FLOOR(5)', {});
  assert(data.result === 5, 'FLOOR(5) → 5');
}

// === CEIL tests ===
async function testCeilBasic() {
  const data = await evalExpr('CEIL(3.2)', {});
  assert(data.result === 4, 'CEIL(3.2) → 4');
}

async function testCeilNegative() {
  const data = await evalExpr('CEIL(-3.7)', {});
  assert(data.result === -3, 'CEIL(-3.7) → -3');
}

async function testCeilInteger() {
  const data = await evalExpr('CEIL(5)', {});
  assert(data.result === 5, 'CEIL(5) → 5');
}

// === MIN tests ===
async function testMinBasic() {
  const data = await evalExpr('MIN(5, 3, 8, 1)', {});
  assert(data.result === 1, 'MIN(5, 3, 8, 1) → 1');
}

async function testMinTwo() {
  const data = await evalExpr('MIN(10, 20)', {});
  assert(data.result === 10, 'MIN(10, 20) → 10');
}

async function testMinWithNegative() {
  const data = await evalExpr('MIN(5, -3, 0)', {});
  assert(data.result === -3, 'MIN(5, -3, 0) → -3');
}

// === MAX tests ===
async function testMaxBasic() {
  const data = await evalExpr('MAX(5, 3, 8, 1)', {});
  assert(data.result === 8, 'MAX(5, 3, 8, 1) → 8');
}

async function testMaxTwo() {
  const data = await evalExpr('MAX(10, 20)', {});
  assert(data.result === 20, 'MAX(10, 20) → 20');
}

async function testMaxWithNegative() {
  const data = await evalExpr('MAX(-5, -3, -10)', {});
  assert(data.result === -3, 'MAX(-5, -3, -10) → -3');
}

// === SUM tests ===
async function testSumBasic() {
  const data = await evalExpr('SUM(1, 2, 3, 4, 5)', {});
  assert(data.result === 15, 'SUM(1, 2, 3, 4, 5) → 15');
}

async function testSumWithNull() {
  const data = await evalExpr('SUM(10, missing, 20)', {});
  assert(data.result === 30, 'SUM with null skips null → 30');
}

async function testSumTwo() {
  const data = await evalExpr('SUM(100, 200)', {});
  assert(data.result === 300, 'SUM(100, 200) → 300');
}

// === SWITCH tests ===
async function testSwitchMatch() {
  const data = await evalExpr('SWITCH("B", "A", "Apple", "B", "Banana", "C", "Cherry", "Unknown")', {});
  assert(data.result === 'Banana', 'SWITCH matches "B" → "Banana"');
}

async function testSwitchDefault() {
  const data = await evalExpr('SWITCH("D", "A", "Apple", "B", "Banana", "Unknown")', {});
  assert(data.result === 'Unknown', 'SWITCH no match → default "Unknown"');
}

async function testSwitchFirst() {
  const data = await evalExpr('SWITCH("A", "A", "Apple", "B", "Banana")', {});
  assert(data.result === 'Apple', 'SWITCH matches first case');
}

async function testSwitchWithContext() {
  const data = await evalExpr('SWITCH(status, "draft", "Draft", "published", "Live", "Unknown")', { status: 'published' });
  assert(data.result === 'Live', 'SWITCH with context field matches');
}

async function testSwitchNoMatchNoDefault() {
  const data = await evalExpr('SWITCH("Z", "A", "Apple", "B", "Banana")', {});
  assert(data.result === '', 'SWITCH no match no default → ""');
}

async function testSwitchNumeric() {
  const data = await evalExpr('SWITCH(2, 1, "one", 2, "two", 3, "three")', {});
  assert(data.result === 'two', 'SWITCH numeric match → "two"');
}

// === Combined/integration tests ===
async function testPadLeftInConcat() {
  const data = await evalExpr('CONCAT("INV-", PADLEFT("42", 6, "0"))', {});
  assert(data.result === 'INV-000042', 'CONCAT with PADLEFT → "INV-000042"');
}

async function testSumWithContext() {
  const data = await evalExpr('SUM(a, b, c)', { a: 10, b: 20, c: 30 });
  assert(data.result === 60, 'SUM with context fields → 60');
}

async function testMinMaxCombined() {
  const data = await evalExpr('MAX(MIN(10, 20), MIN(5, 15))', {});
  assert(data.result === 10, 'MAX(MIN(10,20), MIN(5,15)) → 10');
}

async function testFloorCeilCombined() {
  const data = await evalExpr('FLOOR(7.9) + CEIL(2.1)', {});
  assert(data.result === 10, 'FLOOR(7.9) + CEIL(2.1) → 10');
}

async function testSplitAndUpper() {
  const data = await evalExpr('UPPER(SPLIT("hello-world", "-", 1))', {});
  assert(data.result === 'WORLD', 'UPPER(SPLIT("hello-world", "-", 1)) → "WORLD"');
}

async function testSubstituteAndTrim() {
  const data = await evalExpr('TRIM(SUBSTITUTE("  hello  world  ", "  ", " "))', {});
  const trimmed = data.result;
  assert(typeof trimmed === 'string' && trimmed.length < 16, 'SUBSTITUTE + TRIM reduces whitespace');
}

async function testFindAndMid() {
  const data = await evalExpr('MID("hello world", FIND("world", "hello world"), 5)', {});
  assert(data.result === 'world', 'MID at FIND position extracts "world"');
}

async function testReplaceWithContext() {
  const data = await evalExpr('REPLACE(template, "DRAFT", "FINAL")', { template: 'This is a DRAFT document' });
  assert(data.result === 'This is a FINAL document', 'REPLACE with context field');
}

async function testSwitchInConcat() {
  const data = await evalExpr('CONCAT("Status: ", SWITCH(code, 1, "Active", 2, "Inactive", "Unknown"))', { code: 1 });
  assert(data.result === 'Status: Active', 'SWITCH inside CONCAT');
}

async function runTests() {
  console.log('Feature #402: Add additional string and math functions to expression engine\n');

  // PADLEFT
  await testPadLeftBasic();
  await testPadLeftDefault();
  await testPadLeftNull();
  await testPadLeftNoExtend();
  await testPadLeftWithContext();

  // PADRIGHT
  await testPadRightBasic();
  await testPadRightDefault();
  await testPadRightNull();

  // REPLACE
  await testReplaceBasic();
  await testReplaceOnlyFirst();
  await testReplaceNotFound();
  await testReplaceNull();

  // SUBSTITUTE
  await testSubstituteAll();
  await testSubstituteBasic();
  await testSubstituteNull();

  // SPLIT
  await testSplitBasic();
  await testSplitFirst();
  await testSplitOutOfRange();
  await testSplitNull();

  // FIND
  await testFindBasic();
  await testFindNotFound();
  await testFindNull();
  await testFindAtStart();

  // FLOOR
  await testFloorBasic();
  await testFloorNegative();
  await testFloorInteger();

  // CEIL
  await testCeilBasic();
  await testCeilNegative();
  await testCeilInteger();

  // MIN
  await testMinBasic();
  await testMinTwo();
  await testMinWithNegative();

  // MAX
  await testMaxBasic();
  await testMaxTwo();
  await testMaxWithNegative();

  // SUM
  await testSumBasic();
  await testSumWithNull();
  await testSumTwo();

  // SWITCH
  await testSwitchMatch();
  await testSwitchDefault();
  await testSwitchFirst();
  await testSwitchWithContext();
  await testSwitchNoMatchNoDefault();
  await testSwitchNumeric();

  // Combined/integration
  await testPadLeftInConcat();
  await testSumWithContext();
  await testMinMaxCombined();
  await testFloorCeilCombined();
  await testSplitAndUpper();
  await testSubstituteAndTrim();
  await testFindAndMid();
  await testReplaceWithContext();
  await testSwitchInConcat();

  console.log(results.join('\n'));
  console.log(`\nResults: ${passed}/${passed + failed} passed`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
