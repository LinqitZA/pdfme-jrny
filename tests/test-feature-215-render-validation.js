/**
 * Feature #215: Render endpoint rejects missing required fields
 *
 * Verifies that POST /render/now fails with 400 when required fields
 * (templateId, entityId, channel) are missing.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user1', 'org1', ['admin']);
const AUTH = { 'Authorization': `Bearer ${TOKEN}` };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };

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
  try { body = await res.json(); } catch (e) {}
  return { status: res.status, body };
}

async function runTests() {
  console.log('\n=== Feature #215: Render endpoint rejects missing required fields ===\n');

  // --- POST render/now without templateId ---
  console.log('POST render/now without templateId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ entityId: 'ent-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.error === 'Bad Request', `Error is "Bad Request"`);
    assert(body && body.details && body.details.some(d => d.field === 'templateId'), `Details include templateId field`);
    assert(body && body.message && body.message.includes('templateId'), `Message mentions templateId`);
  }

  // --- POST render/now without entityId ---
  console.log('\nPOST render/now without entityId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.some(d => d.field === 'entityId'), `Details include entityId field`);
  }

  // --- POST render/now without channel ---
  console.log('\nPOST render/now without channel');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityId: 'ent-1' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.some(d => d.field === 'channel'), `Details include channel field`);
  }

  // --- POST render/now with empty body ---
  console.log('\nPOST render/now with empty body');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.length === 3, `Details lists all 3 missing fields (got ${body && body.details ? body.details.length : 0})`);
    const fieldNames = body && body.details ? body.details.map(d => d.field).sort() : [];
    assert(fieldNames.includes('channel'), `Missing fields include channel`);
    assert(fieldNames.includes('entityId'), `Missing fields include entityId`);
    assert(fieldNames.includes('templateId'), `Missing fields include templateId`);
  }

  // --- POST render/now with all required fields (valid request) ---
  console.log('\nPOST render/now with all required fields (should not get 400)');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'sys-invoice-standard', entityId: 'test-ent-1', channel: 'email' }),
    });
    // May get 404 (template not found for org) or 200, but NOT 400
    assert(status !== 400, `Does not return 400 (got ${status})`);
  }

  // --- POST render/now with null templateId ---
  console.log('\nPOST render/now with null templateId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: null, entityId: 'ent-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for null templateId (got ${status})`);
  }

  // --- POST render/now with empty string templateId ---
  console.log('\nPOST render/now with empty string templateId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: '', entityId: 'ent-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for empty string templateId (got ${status})`);
  }

  // --- POST render/now with whitespace-only templateId ---
  console.log('\nPOST render/now with whitespace templateId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: '   ', entityId: 'ent-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for whitespace templateId (got ${status})`);
  }

  // --- Error response structure ---
  console.log('\nError response structure validation');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    assert(body && body.statusCode === 400, `Has statusCode 400`);
    assert(body && typeof body.error === 'string', `Has error field`);
    assert(body && typeof body.message === 'string', `Has message field`);
    assert(body && Array.isArray(body.details), `Has details array`);
    assert(body && body.details.every(d => d.field && d.reason), `Each detail has field and reason`);
  }

  // --- POST render/bulk without templateId ---
  console.log('\nPOST render/bulk without templateId');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ entityIds: ['ent-1'], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.some(d => d.field === 'templateId'), `Details include templateId`);
  }

  // --- POST render/bulk without entityIds ---
  console.log('\nPOST render/bulk without entityIds');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.some(d => d.field === 'entityIds'), `Details include entityIds`);
  }

  // --- POST render/bulk with empty entityIds array ---
  console.log('\nPOST render/bulk with empty entityIds array');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for empty entityIds (got ${status})`);
  }

  // --- POST render/bulk without channel ---
  console.log('\nPOST render/bulk without channel');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: ['ent-1'] }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.some(d => d.field === 'channel'), `Details include channel`);
  }

  // --- POST render/async without required fields ---
  console.log('\nPOST render/async without required fields');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/async`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.details && body.details.length === 3, `Details lists all 3 missing fields`);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
