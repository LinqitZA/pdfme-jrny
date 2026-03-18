/**
 * Feature #216: Batch endpoint validates entityIds array
 *
 * Verifies that POST /render/bulk rejects empty or invalid entityIds arrays.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user1', 'org1', ['admin']);
const JSON_HEADERS = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

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
  console.log('\n=== Feature #216: Batch endpoint validates entityIds array ===\n');

  // --- Empty entityIds array ---
  console.log('POST render/bulk with empty entityIds=[]');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.error === 'Bad Request', `Error is "Bad Request"`);
    assert(body && body.details && body.details.some(d => d.field === 'entityIds'), `Details mention entityIds`);
  }

  // --- entityIds containing null values ---
  console.log('\nPOST render/bulk with entityIds containing null');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [null, 'ent-1'], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
    assert(body && body.message && body.message.includes('non-empty strings'), `Message mentions non-empty strings`);
    assert(body && body.details && body.details.some(d => d.field === 'entityIds'), `Details mention entityIds`);
  }

  // --- entityIds containing undefined (sent as null in JSON) ---
  console.log('\nPOST render/bulk with entityIds containing undefined/null entries');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [null, null], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
  }

  // --- entityIds containing empty strings ---
  console.log('\nPOST render/bulk with entityIds containing empty strings');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: ['', 'ent-1'], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for empty string entry (got ${status})`);
  }

  // --- entityIds containing whitespace-only strings ---
  console.log('\nPOST render/bulk with entityIds containing whitespace strings');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: ['  ', 'ent-1'], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for whitespace entry (got ${status})`);
  }

  // --- entityIds containing number values ---
  console.log('\nPOST render/bulk with entityIds containing numbers');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [123, 'ent-1'], channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for number entries (got ${status})`);
  }

  // --- entityIds as string (not array) ---
  console.log('\nPOST render/bulk with entityIds as string');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: 'not-an-array', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
  }

  // --- entityIds missing entirely ---
  console.log('\nPOST render/bulk without entityIds field');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
  }

  // --- entityIds as null ---
  console.log('\nPOST render/bulk with entityIds: null');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: null, channel: 'email' }),
    });
    assert(status === 400, `Returns 400 (got ${status})`);
  }

  // --- Valid entityIds succeeds (not 400) ---
  console.log('\nPOST render/bulk with valid entityIds array');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'sys-invoice-standard', entityIds: ['ent-1', 'ent-2'], channel: 'email' }),
    });
    // Should get 202 (accepted) not 400
    assert(status !== 400, `Does not return 400 (got ${status})`);
    if (status === 202) {
      assert(body && body.batchId, `Response has batchId`);
      assert(body && body.totalJobs === 2, `totalJobs is 2`);
    }
  }

  // --- Error response structure ---
  console.log('\nError response structure validation');
  {
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: [null], channel: 'email' }),
    });
    assert(body && body.statusCode === 400, `Has statusCode 400`);
    assert(body && typeof body.error === 'string', `Has error string`);
    assert(body && typeof body.message === 'string', `Has message string`);
    assert(body && Array.isArray(body.details), `Has details array`);
    assert(body && body.details[0] && body.details[0].field === 'entityIds', `First detail field is entityIds`);
    assert(body && body.details[0] && typeof body.details[0].reason === 'string', `Detail has reason`);
  }

  // --- entityIds exceeding max 2000 ---
  console.log('\nPOST render/bulk with >2000 entityIds');
  {
    const largeArray = Array.from({ length: 2001 }, (_, i) => `ent-${i}`);
    const { status, body } = await fetchJson(`${API_BASE}/render/bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ templateId: 'tpl-1', entityIds: largeArray, channel: 'email' }),
    });
    assert(status === 400, `Returns 400 for >2000 entityIds (got ${status})`);
    assert(body && body.message && body.message.includes('2000'), `Message mentions 2000 limit`);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
