/**
 * Test: Feature #208 - API handles unknown endpoints with 404
 * Verifies that nonexistent routes return 404 (not 500) with proper error envelope
 */

const BASE = process.env.API_URL || process.env.API_BASE || 'http://localhost:3001';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function testUnknownEndpoints() {
  console.log('\n=== Feature #208: API handles unknown endpoints with 404 ===\n');

  // Test 1: GET nonexistent route under /api/pdfme
  console.log('Test 1: GET /api/pdfme/nonexistent');
  {
    const { status, json } = await fetchJSON(`${BASE}/api/pdfme/nonexistent`);
    assert(status === 404, `Returns 404 (got ${status})`);
    assert(json !== null, 'Response is valid JSON');
    assert(json?.statusCode === 404, `statusCode field is 404`);
    assert(json?.error === 'Not Found', `error field is "Not Found"`);
    assert(typeof json?.message === 'string' && json.message.length > 0, 'Has message string');
    assert(typeof json?.timestamp === 'string', 'Has timestamp');
    assert(typeof json?.path === 'string', 'Has path');
  }

  // Test 2: POST to nonexistent action on templates
  console.log('\nTest 2: POST /api/pdfme/templates/nonexistent/action');
  {
    const { status, json } = await fetchJSON(`${BASE}/api/pdfme/templates/nonexistent/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    assert(status === 404, `Returns 404 (got ${status})`);
    assert(json?.statusCode === 404, 'statusCode field is 404');
    assert(json?.error === 'Not Found', 'error is "Not Found"');
  }

  // Test 3: PUT to completely bogus deep route
  console.log('\nTest 3: PUT /api/pdfme/completely/bogus/deep/route');
  {
    const { status, json } = await fetchJSON(`${BASE}/api/pdfme/completely/bogus/deep/route`, {
      method: 'PUT',
    });
    assert(status === 404, `Returns 404 (got ${status})`);
    assert(json?.statusCode === 404, 'statusCode field is 404');
  }

  // Test 4: DELETE on nonexistent resource
  console.log('\nTest 4: DELETE /api/pdfme/fake-resource');
  {
    const { status, json } = await fetchJSON(`${BASE}/api/pdfme/fake-resource`, {
      method: 'DELETE',
    });
    assert(status === 404, `Returns 404 (got ${status})`);
    assert(json?.statusCode === 404, 'statusCode field is 404');
  }

  // Test 5: PATCH on nonexistent resource
  console.log('\nTest 5: PATCH /api/pdfme/unknown');
  {
    const { status, json } = await fetchJSON(`${BASE}/api/pdfme/unknown`, {
      method: 'PATCH',
    });
    assert(status === 404, `Returns 404 (got ${status})`);
    assert(json?.statusCode === 404, 'statusCode field is 404');
  }

  // Test 6: No stack trace exposed in 404 responses
  console.log('\nTest 6: No stack trace in error response');
  {
    const { json } = await fetchJSON(`${BASE}/api/pdfme/nonexistent`);
    const responseStr = JSON.stringify(json);
    assert(!responseStr.includes('at '), 'No stack trace in response');
    assert(!responseStr.includes('node_modules'), 'No node_modules paths in response');
    assert(!responseStr.includes('.ts:'), 'No TypeScript file references in response');
  }

  // Test 7: Valid routes still work (sanity check)
  console.log('\nTest 7: Valid routes still return 200');
  {
    const { status } = await fetchJSON(`${BASE}/api/pdfme/health`);
    assert(status === 200, `Health endpoint returns 200 (got ${status})`);
  }

  // Test 8: Root API path nonexistent
  console.log('\nTest 8: GET /api/nonexistent (outside pdfme prefix)');
  {
    const { status } = await fetchJSON(`${BASE}/api/nonexistent`);
    assert(status === 404, `Returns 404 (got ${status})`);
  }

  // Test 9: Response Content-Type is JSON
  console.log('\nTest 9: Content-Type is application/json');
  {
    const res = await fetch(`${BASE}/api/pdfme/nonexistent`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('application/json'), `Content-Type includes application/json (got ${ct})`);
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`FAILED: ${failed} test(s)`);
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
  }
}

testUnknownEndpoints().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
