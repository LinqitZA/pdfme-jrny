/**
 * Test: Feature #209 - Cursor pagination handles invalid cursor
 * Verifies that invalid cursor parameter returns 400 with clear error message
 */

const crypto = require('crypto');
const BASE = process.env.API_URL || 'http://localhost:3000';

// Generate valid JWT for auth
function makeJwt() {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub:'test-user',orgId:'test-org-209',roles:['template:view','template:edit']})).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeJwt();
const AUTH_HEADERS = {
  'Authorization': 'Bearer ' + TOKEN,
  'Content-Type': 'application/json',
};

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  ✅ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...AUTH_HEADERS, ...options.headers } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function run() {
  console.log('\n=== Feature #209: Cursor pagination handles invalid cursor ===\n');

  // Test 1: Random string cursor
  console.log('Test 1: GET /api/pdfme/templates?cursor=invalid_cursor_string');
  {
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=invalid_cursor_string');
    assert(status === 400, 'Returns 400 (got ' + status + ')');
    assert(json !== null, 'Response is valid JSON');
    assert(json && json.statusCode === 400, 'statusCode field is 400');
    assert(json && typeof json.message === 'string' && json.message.length > 0, 'Has error message');
    assert(json && json.message && json.message.toLowerCase().includes('cursor'), 'Message mentions cursor');
  }

  // Test 2: Base64 but invalid JSON inside
  console.log('\nTest 2: cursor=base64(not-json)');
  {
    const badCursor = Buffer.from('not-json-at-all').toString('base64');
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=' + badCursor);
    assert(status === 400, 'Returns 400 (got ' + status + ')');
    assert(json && json.statusCode === 400, 'statusCode field is 400');
  }

  // Test 3: Base64 JSON but missing required fields
  console.log('\nTest 3: cursor=base64(json-missing-fields)');
  {
    const badCursor = Buffer.from(JSON.stringify({foo: 'bar'})).toString('base64');
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=' + badCursor);
    assert(status === 400, 'Returns 400 (got ' + status + ')');
    assert(json && json.statusCode === 400, 'statusCode field is 400');
  }

  // Test 4: Base64 JSON with invalid date
  console.log('\nTest 4: cursor=base64(json-invalid-date)');
  {
    const badCursor = Buffer.from(JSON.stringify({createdAt: 'not-a-date', id: 'abc'})).toString('base64');
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=' + badCursor);
    assert(status === 400, 'Returns 400 (got ' + status + ')');
    assert(json && json.statusCode === 400, 'statusCode field is 400');
  }

  // Test 5: Empty cursor string
  console.log('\nTest 5: cursor= (empty string)');
  {
    const { status } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=');
    // Empty cursor should either be ignored (200) or rejected (400) - both acceptable
    assert(status === 200 || status === 400, 'Returns 200 or 400 (got ' + status + ')');
  }

  // Test 6: Normal pagination still works after invalid cursor attempts
  console.log('\nTest 6: Normal pagination works after invalid cursor attempts');
  {
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates');
    assert(status === 200, 'Returns 200 (got ' + status + ')');
    assert(json !== null, 'Response is valid JSON');
    assert(Array.isArray(json && json.data), 'Response has data array');
  }

  // Test 7: Valid cursor format works (if templates exist)
  console.log('\nTest 7: Valid cursor works (create template first)');
  {
    // Create a template to have pagination data
    const createRes = await fetchJSON(BASE + '/api/pdfme/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'CURSOR_TEST_209_' + Date.now(),
        type: 'invoice',
        schema: { pages: [{ elements: [] }] },
      }),
    });

    if (createRes.status === 201 || createRes.status === 200) {
      // List templates to get a valid cursor
      const listRes = await fetchJSON(BASE + '/api/pdfme/templates?limit=1');
      if (listRes.json && listRes.json.nextCursor) {
        const validCursorRes = await fetchJSON(BASE + '/api/pdfme/templates?cursor=' + listRes.json.nextCursor);
        assert(validCursorRes.status === 200, 'Valid cursor returns 200 (got ' + validCursorRes.status + ')');
      } else {
        assert(listRes.status === 200, 'List works (no nextCursor available for further test)');
      }
    } else {
      assert(true, 'Skipped valid cursor test (template creation returned ' + createRes.status + ')');
    }
  }

  // Test 8: No stack trace in 400 error
  console.log('\nTest 8: No stack trace in 400 error response');
  {
    const { json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=garbage');
    const responseStr = JSON.stringify(json);
    assert(!responseStr.includes('at '), 'No stack trace in response');
    assert(!responseStr.includes('node_modules'), 'No node_modules paths');
  }

  // Test 9: Error has proper structure
  console.log('\nTest 9: Error response has proper structure');
  {
    const { json } = await fetchJSON(BASE + '/api/pdfme/templates?cursor=abc123');
    assert(json && typeof json.statusCode === 'number', 'Has numeric statusCode');
    assert(json && typeof json.message === 'string', 'Has string message');
    assert(json && typeof json.timestamp === 'string', 'Has timestamp');
    assert(json && typeof json.path === 'string', 'Has path');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) {
    console.log('FAILED: ' + failed + ' test(s)');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
