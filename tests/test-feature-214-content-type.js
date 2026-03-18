/**
 * Feature #214: API validates Content-Type header
 *
 * Verifies that POST/PUT endpoints reject requests with incorrect or missing
 * Content-Type headers, returning 415 Unsupported Media Type.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user1', 'org1', ['admin']);
const AUTH = { 'Authorization': `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, body };
}

async function runTests() {
  console.log('\n=== Feature #214: API validates Content-Type header ===\n');

  // --- POST /templates with text/plain ---
  console.log('POST /templates with Content-Type: text/plain');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'test', type: 'invoice', schema: {} }),
    });
    assert(status === 415, `Returns 415 (got ${status})`);
    assert(body && body.error === 'Unsupported Media Type', `Error is "Unsupported Media Type"`);
    assert(body && body.message && body.message.includes('text/plain'), `Message mentions text/plain`);
  }

  // --- POST /templates with application/xml ---
  console.log('\nPOST /templates with Content-Type: application/xml');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/xml' },
      body: '<template><name>test</name></template>',
    });
    assert(status === 415, `Returns 415 (got ${status})`);
    assert(body && body.message && body.message.includes('application/xml'), `Message mentions application/xml`);
  }

  // --- POST /templates with no Content-Type but body present ---
  console.log('\nPOST /templates with no Content-Type header but body present');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH },
      body: JSON.stringify({ name: 'test', type: 'invoice', schema: {} }),
    });
    // fetch() defaults to text/plain when no Content-Type is set and body is string
    assert(status === 415, `Returns 415 (got ${status})`);
    assert(body && body.statusCode === 415, `Body has statusCode 415`);
  }

  // --- PUT /templates/:id/draft with text/plain ---
  console.log('\nPUT /templates/:id/draft with Content-Type: text/plain');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates/nonexistent/draft`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ schema: {} }),
    });
    assert(status === 415, `Returns 415 (got ${status})`);
    assert(body && body.error === 'Unsupported Media Type', `Error is "Unsupported Media Type"`);
  }

  // --- PUT /templates/:id with text/plain ---
  console.log('\nPUT /templates/:id with Content-Type: text/plain');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates/nonexistent`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'updated' }),
    });
    assert(status === 415, `Returns 415 (got ${status})`);
  }

  // --- POST with application/json works fine ---
  console.log('\nPOST /templates with correct Content-Type: application/json');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ct-validation-test', type: 'invoice', schema: { pages: [] } }),
    });
    assert(status === 201, `Returns 201 (got ${status})`);
    assert(body && body.id, `Response has id`);
    assert(body && body.name === 'ct-validation-test', `Name matches`);

    // Clean up - archive the test template
    if (body && body.id) {
      await fetch(`${API_BASE}/templates/${body.id}`, {
        method: 'DELETE',
        headers: AUTH,
      });
    }
  }

  // --- PUT with application/json; charset=utf-8 works ---
  console.log('\nPOST with Content-Type: application/json; charset=utf-8');
  {
    const { status } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: 'ct-charset-test', type: 'invoice', schema: { pages: [] } }),
    });
    assert(status === 201, `Returns 201 with charset parameter (got ${status})`);
  }

  // --- GET requests unaffected (no Content-Type needed) ---
  console.log('\nGET /templates without Content-Type (should work)');
  {
    const { status } = await fetchJson(`${API_BASE}/templates`, {
      method: 'GET',
      headers: AUTH,
    });
    assert(status === 200, `Returns 200 (got ${status})`);
  }

  // --- DELETE requests unaffected ---
  console.log('\nDELETE /templates/:id without Content-Type (should pass through)');
  {
    const { status } = await fetchJson(`${API_BASE}/templates/nonexistent-id`, {
      method: 'DELETE',
      headers: AUTH,
    });
    // Should get 404 (template not found), not 415
    assert(status === 404, `Returns 404 not 415 (got ${status})`);
  }

  // --- POST to render/now with text/plain ---
  console.log('\nPOST /render/now with Content-Type: text/plain');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ templateId: 'test' }),
    });
    assert(status === 415, `Returns 415 (got ${status})`);
  }

  // --- Error response structure ---
  console.log('\nError response structure validation');
  {
    const { status, body } = await fetchJson(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'text/html' },
      body: '<html/>',
    });
    assert(body && body.statusCode === 415, `Has statusCode field`);
    assert(body && body.error === 'Unsupported Media Type', `Has error field`);
    assert(body && typeof body.message === 'string', `Has message field`);
    assert(body && typeof body.timestamp === 'string', `Has timestamp field`);
    assert(body && typeof body.path === 'string', `Has path field`);
    assert(body && body.message.includes('application/json'), `Message suggests application/json`);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
