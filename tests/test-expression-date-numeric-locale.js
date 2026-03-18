/**
 * Test script for ExpressionEngine - Features #112, #113, #114
 * - #112: Date functions (TODAY, YEAR, MONTH, DAY, DATEDIFF, FORMAT)
 * - #113: Numeric functions (ROUND, ABS, FORMAT with number patterns)
 * - #114: Locale-aware functions (FORMAT_CURRENCY, FORMAT_DATE, FORMAT_NUMBER)
 */

require('@swc/register');
const { ExpressionEngine } = require('../packages/erp-schemas/src/expression-engine/index.ts');

let passed = 0;
let failed = 0;

function assert(testName, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log('FAIL:', testName, '- expected:', JSON.stringify(expected), 'got:', JSON.stringify(actual));
  }
}

function assertApprox(testName, actual, expected, tolerance) {
  if (Math.abs(actual - expected) <= (tolerance || 0.001)) {
    passed++;
  } else {
    failed++;
    console.log('FAIL:', testName, '- expected ~', expected, 'got:', actual);
  }
}

// ====== Feature #112: Date Functions ======
console.log('=== Feature #112: Date Functions ===');

const engine = new ExpressionEngine();

// TODAY() returns current date as epoch ms
const todayResult = engine.evaluate('TODAY()');
const now = new Date();
const todayExpected = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
assert('TODAY() returns current date timestamp', todayResult, todayExpected);

// YEAR(date) extracts year
const testDate = new Date('2024-06-15T12:00:00Z').getTime();
assert('YEAR extracts year', engine.evaluate('YEAR(d)', { d: testDate }), 2024);

// MONTH(date) extracts month (1-12)
assert('MONTH extracts month', engine.evaluate('MONTH(d)', { d: testDate }), 6);

// DAY(date) extracts day
assert('DAY extracts day', engine.evaluate('DAY(d)', { d: testDate }), 15);

// Test with Date object in context (converted to timestamp by resolveFieldReferences)
assert('YEAR with Date object', engine.evaluate('YEAR(d)', { d: new Date('2023-12-25T00:00:00Z') }), 2023);
assert('MONTH with Date object', engine.evaluate('MONTH(d)', { d: new Date('2023-12-25T00:00:00Z') }), 12);
assert('DAY with Date object', engine.evaluate('DAY(d)', { d: new Date('2023-12-25T00:00:00Z') }), 25);

// DATEDIFF(d1, d2) returns difference in days
const d1 = new Date('2024-03-15').getTime();
const d2 = new Date('2024-03-10').getTime();
assert('DATEDIFF 5 days', engine.evaluate('DATEDIFF(d1, d2)', { d1, d2 }), 5);
assert('DATEDIFF negative', engine.evaluate('DATEDIFF(d2, d1)', { d1, d2 }), -5);
assert('DATEDIFF same day', engine.evaluate('DATEDIFF(d1, d1)', { d1, d2 }), 0);

// Larger date difference
const jan1 = new Date('2024-01-01').getTime();
const dec31 = new Date('2024-12-31').getTime();
assert('DATEDIFF year span', engine.evaluate('DATEDIFF(d1, d2)', { d1: dec31, d2: jan1 }), 365);

// FORMAT(date, pattern) formats dates
const fmtDate = new Date('2024-06-15T14:30:45Z').getTime();
assert('FORMAT date yyyy-MM-dd', engine.evaluate("FORMAT(d, 'yyyy-MM-dd')", { d: fmtDate }), '2024-06-15');
assert('FORMAT date dd/MM/yyyy', engine.evaluate("FORMAT(d, 'dd/MM/yyyy')", { d: fmtDate }), '15/06/2024');

// Test month names
assert('FORMAT date MMMM', engine.evaluate("FORMAT(d, 'dd MMMM yyyy')", { d: fmtDate }), '15 June 2024');
assert('FORMAT date MMM', engine.evaluate("FORMAT(d, 'dd MMM yyyy')", { d: fmtDate }), '15 Jun 2024');

console.log('Feature #112 done');

// ====== Feature #113: Numeric Functions ======
console.log('\n=== Feature #113: Numeric Functions ===');

// ROUND(value, decimals)
assert('ROUND(3.456, 2) = 3.46', engine.evaluate('ROUND(3.456, 2)'), 3.46);
assert('ROUND(3.454, 2) = 3.45', engine.evaluate('ROUND(3.454, 2)'), 3.45);
assert('ROUND(3.5, 0) = 4', engine.evaluate('ROUND(3.5, 0)'), 4);
assert('ROUND(3.4, 0) = 3', engine.evaluate('ROUND(3.4, 0)'), 3);
assert('ROUND(-2.5, 0) = -2', engine.evaluate('ROUND(-2.5, 0)'), -2); // JS Math.round behavior
assert('ROUND(1.005, 2)', engine.evaluate('ROUND(1.005, 2)'), 1); // JS floating point
assert('ROUND(100, 0) = 100', engine.evaluate('ROUND(100, 0)'), 100);

// ABS(value)
assert('ABS(-5) = 5', engine.evaluate('ABS(-5)'), 5);
assert('ABS(5) = 5', engine.evaluate('ABS(5)'), 5);
assert('ABS(0) = 0', engine.evaluate('ABS(0)'), 0);
assert('ABS(-3.14)', assertApprox('', engine.evaluate('ABS(-3.14)'), 3.14, 0.001) || true, true);

// FORMAT with number pattern
assert("FORMAT number #,##0.00", engine.evaluate("FORMAT(1234.5, '#,##0.00')"), '1,234.50');
assert("FORMAT number 0.00", engine.evaluate("FORMAT(5.1, '0.00')"), '5.10');
assert("FORMAT number #,##0", engine.evaluate("FORMAT(1000000, '#,##0')"), '1,000,000');
assert("FORMAT number no comma", engine.evaluate("FORMAT(1234.5, '0.00')"), '1234.50');
assert("FORMAT number zero", engine.evaluate("FORMAT(0, '#,##0.00')"), '0.00');

console.log('Feature #113 done');

// ====== Feature #114: Locale-Aware Functions ======
console.log('\n=== Feature #114: Locale-Aware Functions ===');

// Test with en-ZA locale and ZAR currency
const zaEngine = new ExpressionEngine({ locale: 'en-ZA', currency: 'ZAR' });

// FORMAT_CURRENCY(value) - should use R symbol for ZAR
const currencyResult = zaEngine.evaluate('FORMAT_CURRENCY(1234.56)');
console.log('  FORMAT_CURRENCY(1234.56) en-ZA/ZAR =', currencyResult);
// en-ZA ZAR formatting: "R 1 234,56" or "R1,234.56" depending on Node.js ICU
// Just verify it contains R and the digits
assert('FORMAT_CURRENCY contains R', currencyResult.includes('R'), true);
assert('FORMAT_CURRENCY contains 1234', currencyResult.includes('1') && currencyResult.includes('234'), true);

// FORMAT_DATE(date) uses locale format
const localeDate = new Date('2024-06-15T12:00:00Z').getTime();
const dateResult = zaEngine.evaluate('FORMAT_DATE(d)', { d: localeDate });
console.log('  FORMAT_DATE en-ZA =', dateResult);
// en-ZA format is typically yyyy/MM/dd or dd/MM/yyyy
assert('FORMAT_DATE returns string', typeof dateResult, 'string');
assert('FORMAT_DATE contains 2024', dateResult.includes('2024'), true);
assert('FORMAT_DATE contains 15', dateResult.includes('15'), true);

// FORMAT_NUMBER(value) uses locale separators
const numResult = zaEngine.evaluate('FORMAT_NUMBER(1234.5)');
console.log('  FORMAT_NUMBER(1234.5) en-ZA =', numResult);
assert('FORMAT_NUMBER returns string', typeof numResult, 'string');
// Should contain the digits
assert('FORMAT_NUMBER contains digits', numResult.includes('1') && numResult.includes('234'), true);

// Test with en-US locale (default)
const usEngine = new ExpressionEngine({ locale: 'en-US', currency: 'USD' });
const usCurrency = usEngine.evaluate('FORMAT_CURRENCY(1234.56)');
console.log('  FORMAT_CURRENCY(1234.56) en-US/USD =', usCurrency);
assert('USD FORMAT_CURRENCY contains $', usCurrency.includes('$'), true);
assert('USD FORMAT_CURRENCY value', usCurrency.includes('1,234.56'), true);

const usNum = usEngine.evaluate('FORMAT_NUMBER(1234.5)');
console.log('  FORMAT_NUMBER(1234.5) en-US =', usNum);
assert('US FORMAT_NUMBER', usNum.includes('1,234.5'), true);

// Default engine (no locale specified) should use en-US defaults
const defCurrency = engine.evaluate('FORMAT_CURRENCY(99.99)');
console.log('  Default FORMAT_CURRENCY(99.99) =', defCurrency);
assert('Default engine uses USD', defCurrency.includes('$'), true);

console.log('Feature #114 done');

// ====== Verify existing functions still work ======
console.log('\n=== Regression: Existing functions ===');
assert("LEFT still works", engine.evaluate("LEFT('Hello', 3)"), 'Hel');
assert("IF still works", engine.evaluate("IF(1, 'yes', 'no')"), 'yes');
assert("Arithmetic still works", engine.evaluate('2+3*4'), 14);
console.log('Regression checks done');

// ====== Summary ======
console.log('\n=== SUMMARY ===');
console.log('Passed:', passed);
console.log('Failed:', failed);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
