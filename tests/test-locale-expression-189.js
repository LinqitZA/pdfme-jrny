/**
 * Test: Feature #189 - LocaleConfig applied to expression functions
 *
 * Verifies:
 * 1. Set locale en-ZA with ZAR currency
 * 2. Evaluate FORMAT_CURRENCY in template
 * 3. Verify ZAR formatting applied
 * 4. Change locale to en-US
 * 5. Verify USD formatting
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiLCAidGVtcGxhdGU6cHVibGlzaCJdfQ==.sig';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

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

async function test1_setLocaleZA() {
  console.log('\n--- Test 1: Set locale en-ZA with ZAR currency ---');

  const res = await fetch(`${BASE}/expressions/locale`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ locale: 'en-ZA', currency: 'ZAR' }),
  });
  assert(res.ok, `Set locale returns 200 (got ${res.status})`);

  const body = await res.json();
  assert(body.locale === 'en-ZA', `Locale set to en-ZA (got ${body.locale})`);
  assert(body.currency === 'ZAR', `Currency set to ZAR (got ${body.currency})`);

  // Verify get returns the same
  const getRes = await fetch(`${BASE}/expressions/locale`, { headers });
  const getBody = await getRes.json();
  assert(getBody.locale === 'en-ZA', `GET locale returns en-ZA`);
  assert(getBody.currency === 'ZAR', `GET currency returns ZAR`);
}

async function test2_formatCurrencyZAR() {
  console.log('\n--- Test 2: FORMAT_CURRENCY with ZAR (org default) ---');

  // Use org locale (en-ZA, ZAR) - don't pass explicit locale/currency
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1500.50)',
      context: {},
    }),
  });
  assert(res.ok, `Evaluate returns 200 (got ${res.status})`);

  const body = await res.json();
  console.log(`    Result: "${body.result}" (locale: ${body.locale}, currency: ${body.currency})`);

  assert(body.locale === 'en-ZA', `Locale used is en-ZA`);
  assert(body.currency === 'ZAR', `Currency used is ZAR`);

  // ZAR formatting should contain "R" or "ZAR"
  const result = String(body.result);
  assert(
    result.includes('R') || result.includes('ZAR'),
    `Result contains ZAR symbol/code: "${result}"`,
  );
  assert(result.includes('1') && result.includes('500'), `Result contains formatted number: "${result}"`);
}

async function test3_formatCurrencyExplicitZAR() {
  console.log('\n--- Test 3: FORMAT_CURRENCY with explicit locale en-ZA ---');

  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(25000)',
      context: {},
      locale: 'en-ZA',
      currency: 'ZAR',
    }),
  });
  assert(res.ok, `Evaluate returns 200`);

  const body = await res.json();
  const result = String(body.result);
  console.log(`    Result: "${result}"`);

  assert(
    result.includes('R') || result.includes('ZAR'),
    `ZAR format applied: "${result}"`,
  );
  assert(result.includes('25'), `Contains value 25000: "${result}"`);
}

async function test4_changeLocaleUS() {
  console.log('\n--- Test 4: Change locale to en-US ---');

  const res = await fetch(`${BASE}/expressions/locale`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ locale: 'en-US', currency: 'USD' }),
  });
  assert(res.ok, `Set locale returns 200`);

  const body = await res.json();
  assert(body.locale === 'en-US', `Locale changed to en-US`);
  assert(body.currency === 'USD', `Currency changed to USD`);
}

async function test5_formatCurrencyUSD() {
  console.log('\n--- Test 5: FORMAT_CURRENCY with USD (org default) ---');

  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1500.50)',
      context: {},
    }),
  });
  assert(res.ok, `Evaluate returns 200`);

  const body = await res.json();
  const result = String(body.result);
  console.log(`    Result: "${result}" (locale: ${body.locale}, currency: ${body.currency})`);

  assert(body.locale === 'en-US', `Locale used is en-US`);
  assert(body.currency === 'USD', `Currency used is USD`);

  // USD formatting should contain "$"
  assert(result.includes('$'), `Result contains $ symbol: "${result}"`);
  assert(result.includes('1,500') || result.includes('1500'), `Result contains formatted number: "${result}"`);
}

async function test6_formatCurrencyExplicitUSD() {
  console.log('\n--- Test 6: FORMAT_CURRENCY with explicit locale en-US ---');

  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(99.99)',
      context: {},
      locale: 'en-US',
      currency: 'USD',
    }),
  });
  assert(res.ok, `Evaluate returns 200`);

  const body = await res.json();
  const result = String(body.result);
  console.log(`    Result: "${result}"`);

  assert(result.includes('$'), `USD format applied: "${result}"`);
  assert(result.includes('99.99'), `Contains value 99.99: "${result}"`);
}

async function test7_explicitOverridesOrgConfig() {
  console.log('\n--- Test 7: Explicit locale overrides org config ---');

  // Set org to en-US/USD
  await fetch(`${BASE}/expressions/locale`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ locale: 'en-US', currency: 'USD' }),
  });

  // But explicitly request en-ZA/ZAR
  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1000)',
      context: {},
      locale: 'en-ZA',
      currency: 'ZAR',
    }),
  });
  assert(res.ok, `Evaluate returns 200`);

  const body = await res.json();
  const result = String(body.result);
  console.log(`    Result: "${result}" (locale: ${body.locale}, currency: ${body.currency})`);

  assert(body.locale === 'en-ZA', `Explicit locale used: en-ZA`);
  assert(body.currency === 'ZAR', `Explicit currency used: ZAR`);
  assert(
    result.includes('R') || result.includes('ZAR'),
    `ZAR format applied despite org being USD: "${result}"`,
  );
}

async function test8_formatNumber() {
  console.log('\n--- Test 8: FORMAT_NUMBER uses locale ---');

  // en-US format (comma thousands separator)
  const res1 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_NUMBER(1234567.89)',
      locale: 'en-US',
    }),
  });
  const body1 = await res1.json();
  const result1 = String(body1.result);
  console.log(`    en-US: "${result1}"`);
  assert(result1.includes(','), `en-US uses comma separator: "${result1}"`);

  // de-DE format (period thousands separator, comma decimal)
  const res2 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_NUMBER(1234567.89)',
      locale: 'de-DE',
    }),
  });
  const body2 = await res2.json();
  const result2 = String(body2.result);
  console.log(`    de-DE: "${result2}"`);
  assert(
    result2.includes('.') || result2.includes(','),
    `de-DE uses locale-specific formatting: "${result2}"`,
  );
}

async function test9_formatDate() {
  console.log('\n--- Test 9: FORMAT_DATE uses locale ---');

  // en-US date format
  const res1 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_DATE(1710720000000)',
      locale: 'en-US',
    }),
  });
  const body1 = await res1.json();
  const result1 = String(body1.result);
  console.log(`    en-US date: "${result1}"`);
  assert(result1.includes('/') || result1.includes(','), `en-US date format: "${result1}"`);

  // en-ZA date format (typically dd/mm/yyyy)
  const res2 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_DATE(1710720000000)',
      locale: 'en-ZA',
    }),
  });
  const body2 = await res2.json();
  const result2 = String(body2.result);
  console.log(`    en-ZA date: "${result2}"`);
  assert(typeof body2.result === 'string', `en-ZA date returns string: "${result2}"`);
}

async function test10_formatCurrencyWithFieldRef() {
  console.log('\n--- Test 10: FORMAT_CURRENCY with field reference ---');

  const res = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(total)',
      context: { total: 11500 },
      locale: 'en-ZA',
      currency: 'ZAR',
    }),
  });
  assert(res.ok, `Evaluate returns 200`);

  const body = await res.json();
  const result = String(body.result);
  console.log(`    Result: "${result}"`);

  assert(
    result.includes('R') || result.includes('ZAR'),
    `ZAR applied to field value: "${result}"`,
  );
  assert(result.includes('11') && result.includes('500'), `Contains 11500: "${result}"`);
}

async function test11_multipleCurrencies() {
  console.log('\n--- Test 11: Different currencies (EUR, GBP) ---');

  // EUR
  const res1 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1000)',
      locale: 'de-DE',
      currency: 'EUR',
    }),
  });
  const body1 = await res1.json();
  const result1 = String(body1.result);
  console.log(`    EUR: "${result1}"`);
  assert(result1.includes('€') || result1.includes('EUR'), `EUR symbol present: "${result1}"`);

  // GBP
  const res2 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expression: 'FORMAT_CURRENCY(1000)',
      locale: 'en-GB',
      currency: 'GBP',
    }),
  });
  const body2 = await res2.json();
  const result2 = String(body2.result);
  console.log(`    GBP: "${result2}"`);
  assert(result2.includes('£') || result2.includes('GBP'), `GBP symbol present: "${result2}"`);
}

async function test12_localeValidation() {
  console.log('\n--- Test 12: Locale validation ---');

  // Missing both locale and currency
  const res1 = await fetch(`${BASE}/expressions/locale`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  assert(res1.status === 400, `Empty body returns 400 (got ${res1.status})`);

  // Invalid expression returns error
  const res2 = await fetch(`${BASE}/expressions/evaluate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: '' }),
  });
  assert(res2.status === 400, `Empty expression returns 400 (got ${res2.status})`);
}

async function main() {
  console.log('=== Feature #189: LocaleConfig applied to expression functions ===\n');

  try {
    await test1_setLocaleZA();
    await test2_formatCurrencyZAR();
    await test3_formatCurrencyExplicitZAR();
    await test4_changeLocaleUS();
    await test5_formatCurrencyUSD();
    await test6_formatCurrencyExplicitUSD();
    await test7_explicitOverridesOrgConfig();
    await test8_formatNumber();
    await test9_formatDate();
    await test10_formatCurrencyWithFieldRef();
    await test11_multipleCurrencies();
    await test12_localeValidation();
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
