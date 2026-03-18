/**
 * Feature #247: Template search handles special characters
 * Special chars in search don't cause errors or data leaks.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-search-247', 'org-search-247', ['admin']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function createTemplate(name) {
  const { status, data } = await api('POST', '/templates', {
    name, type: 'custom', schema: { fields: [] }, createdBy: 'user-search-247', orgId: 'org-search-247'
  });
  if (status === 201 && data.id) createdIds.push(data.id);
  return data;
}

async function cleanup() {
  for (const id of createdIds) {
    await api('DELETE', `/templates/${id}`);
  }
}

async function searchTemplates(query) {
  const params = new URLSearchParams({ orgId: 'org-search-247', search: query });
  return api('GET', `/templates?${params.toString()}`);
}

async function run() {
  console.log('Feature #247: Template search handles special characters\n');

  // Setup
  const t1 = await createTemplate('Normal Template');
  const t2 = await createTemplate("Template with 'quotes'");
  const t3 = await createTemplate('Template <angle> brackets');
  assert(t1.id && t2.id && t3.id, 'Created 3 test templates');

  // Test 1: Search with single quotes
  console.log('\n--- Single quotes ---');
  const { status: s1, data: d1 } = await searchTemplates("'quotes'");
  assert(s1 === 200, `Single quotes search returns 200 (got ${s1})`);
  assert(Array.isArray(d1.data), 'Returns valid data array with quotes search');
  assert(d1.data.some(t => t.name.includes("'quotes'")), 'Finds template with quotes in name');

  // Test 2: Search with double quotes
  console.log('\n--- Double quotes ---');
  const { status: s2, data: d2 } = await searchTemplates('"test"');
  assert(s2 === 200, `Double quotes search returns 200 (got ${s2})`);
  assert(Array.isArray(d2.data), 'Returns valid data array with double quotes');

  // Test 3: Search with angle brackets (XSS-like)
  console.log('\n--- Angle brackets (<script>) ---');
  const { status: s3, data: d3 } = await searchTemplates('<script>alert(1)</script>');
  assert(s3 === 200, `Angle brackets search returns 200 (got ${s3})`);
  assert(Array.isArray(d3.data), 'Returns valid data array with angle brackets');

  // Test 4: Search finds template with angle brackets in name
  const { status: s3b, data: d3b } = await searchTemplates('<angle>');
  assert(s3b === 200, 'Angle bracket search succeeds');
  assert(d3b.data.some(t => t.name.includes('<angle>')), 'Finds template with angle brackets in name');

  // Test 5: SQL injection attempt - ' OR 1=1 --
  console.log('\n--- SQL injection: OR 1=1 -- ---');
  const { status: s4, data: d4 } = await searchTemplates("' OR 1=1 --");
  assert(s4 === 200, `SQL injection attempt returns 200 (got ${s4})`);
  assert(Array.isArray(d4.data), 'Returns valid data array');
  assert(d4.data.length === 0, `SQL injection does not leak all data (got ${d4.data.length} results)`);

  // Test 6: SQL injection - '; DROP TABLE templates; --
  console.log('\n--- SQL injection: DROP TABLE ---');
  const { status: s5, data: d5 } = await searchTemplates("'; DROP TABLE templates; --");
  assert(s5 === 200, `DROP TABLE injection returns 200 (got ${s5})`);
  assert(Array.isArray(d5.data), 'Returns valid data array after DROP TABLE attempt');

  // Test 7: Verify tables still exist after injection attempt
  const { status: s6, data: d6 } = await api('GET', '/templates?orgId=org-search-247');
  assert(s6 === 200, 'Templates endpoint still works after injection attempts');
  assert(d6.data.length >= 3, `Templates still exist (got ${d6.data.length})`);

  // Test 8: Search with backslash
  console.log('\n--- Backslash ---');
  const { status: s7 } = await searchTemplates('test\\path');
  assert(s7 === 200, `Backslash search returns 200 (got ${s7})`);

  // Test 9: Search with percent sign (LIKE wildcard)
  console.log('\n--- Percent sign ---');
  const { status: s8, data: d8 } = await searchTemplates('%');
  assert(s8 === 200, `Percent sign search returns 200 (got ${s8})`);
  // Percent is a LIKE wildcard - may match all or none depending on escaping
  assert(Array.isArray(d8.data), 'Returns valid data array with percent sign');

  // Test 10: Search with underscore (LIKE wildcard)
  console.log('\n--- Underscore ---');
  const { status: s9 } = await searchTemplates('_');
  assert(s9 === 200, `Underscore search returns 200 (got ${s9})`);

  // Test 11: Search with null bytes
  console.log('\n--- Null-like characters ---');
  const { status: s10 } = await searchTemplates('\x00');
  assert(s10 === 200 || s10 === 400, `Null byte search returns valid HTTP status (got ${s10})`);

  // Test 12: Search with very long string
  console.log('\n--- Very long search string ---');
  const longStr = 'a'.repeat(1000);
  const { status: s11 } = await searchTemplates(longStr);
  assert(s11 === 200, `Very long search returns 200 (got ${s11})`);

  // Test 13: Search with Unicode characters
  console.log('\n--- Unicode characters ---');
  const { status: s12 } = await searchTemplates('日本語テスト');
  assert(s12 === 200, `Unicode search returns 200 (got ${s12})`);

  // Test 14: Search with emoji
  const { status: s13 } = await searchTemplates('🎉🚀');
  assert(s13 === 200, `Emoji search returns 200 (got ${s13})`);

  // Test 15: Search with semicolons
  console.log('\n--- Semicolons ---');
  const { status: s14 } = await searchTemplates('test; SELECT * FROM templates');
  assert(s14 === 200, `Semicolon injection returns 200 (got ${s14})`);

  // Test 16: Search with newlines
  console.log('\n--- Newlines ---');
  const { status: s15 } = await searchTemplates('test\ninjection');
  assert(s15 === 200, `Newline search returns 200 (got ${s15})`);

  // Test 17: Search with parentheses and brackets
  console.log('\n--- Parentheses and brackets ---');
  const { status: s16 } = await searchTemplates('test(1)[2]{3}');
  assert(s16 === 200, `Special brackets search returns 200 (got ${s16})`);

  // Test 18: Server health after all special char searches
  console.log('\n--- Server health check ---');
  const health = await fetch(`${API_BASE}/health`);
  assert(health.status === 200, 'Server still healthy after all special char searches');

  // Cleanup
  await cleanup();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${passed + failed} ---`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
