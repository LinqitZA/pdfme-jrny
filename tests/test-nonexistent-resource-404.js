/**
 * Tests for Feature #159: API returns 404 for nonexistent resources
 *
 * Verifies that missing resources return proper 404 with error envelope.
 */

const http = require('http');

const BASE_URL = process.env.API_BASE || 'http://localhost:3001';
let PASS = 0;
let FAIL = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-404-test', 'org-404-test', [
  'template:edit', 'template:publish', 'render:trigger', 'render:bulk'
]);

function assert(desc, condition) {
  if (condition) {
    PASS++;
    console.log('  PASS:', desc);
  } else {
    FAIL++;
    console.log('  FAIL:', desc);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const data = body !== undefined ? JSON.stringify(body) : '';
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function verifyErrorEnvelope(res, testName) {
  const body = res.body;
  assert(`${testName}: statusCode is 404`, body.statusCode === 404);
  assert(`${testName}: error is 'Not Found'`, body.error === 'Not Found');
  assert(`${testName}: message is a non-empty string`, typeof body.message === 'string' && body.message.length > 0);
}

async function main() {
  console.log('=== Feature #159: API returns 404 for nonexistent resources ===\n');

  // --- Template endpoints ---
  console.log('--- Template Endpoints ---\n');

  // Test 1: GET template with nonexistent ID
  console.log('Test 1: GET template with nonexistent ID');
  {
    const res = await request('GET', '/api/pdfme/templates/nonexistent-id-12345');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
    verifyErrorEnvelope(res, 'Template GET');
  }

  // Test 2: GET template with random UUID-like ID
  console.log('\nTest 2: GET template with random UUID-like ID');
  {
    const res = await request('GET', '/api/pdfme/templates/zzz999-does-not-exist');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
    assert(`Message mentions template not found`, res.body.message.includes('not found'));
  }

  // Test 3: GET template export with nonexistent ID
  console.log('\nTest 3: GET template export with nonexistent ID');
  {
    const res = await request('GET', '/api/pdfme/templates/nonexistent-export-id/export');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // Test 4: GET template lock status with nonexistent ID
  console.log('\nTest 4: GET template lock status with nonexistent ID');
  {
    const res = await request('GET', '/api/pdfme/templates/nonexistent-lock-id/lock');
    // Lock endpoints may return 404 or a lock status with locked:false
    assert(`Returns 404 or valid response (got ${res.status})`, res.status === 404 || res.status === 200);
  }

  // Test 5: POST publish for nonexistent template
  console.log('\nTest 5: POST publish for nonexistent template');
  {
    const res = await request('POST', '/api/pdfme/templates/nonexistent-pub-id/publish', {});
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // Test 6: PUT update for nonexistent template
  console.log('\nTest 6: PUT update for nonexistent template');
  {
    const res = await request('PUT', '/api/pdfme/templates/nonexistent-update-id', {
      name: 'Updated Name',
    });
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- Render endpoints ---
  console.log('\n--- Render Endpoints ---\n');

  // Test 7: GET render verify with nonexistent documentId
  console.log('Test 7: GET render verify with nonexistent documentId');
  {
    const res = await request('GET', '/api/pdfme/render/verify/nonexistent-doc-id');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
    verifyErrorEnvelope(res, 'Verify GET');
  }

  // Test 8: Render now with nonexistent templateId
  console.log('\nTest 8: POST render/now with nonexistent templateId');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      templateId: 'nonexistent-template-id-99999',
      entityId: 'ent-1',
      channel: 'print',
    });
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
    assert(`Message mentions template or not found`, typeof res.body === 'object' &&
           typeof res.body.message === 'string' &&
           (res.body.message.includes('not found') || res.body.message.includes('Not Found')));
  }

  // Test 9: GET batch status with nonexistent batchId
  console.log('\nTest 9: GET batch status with nonexistent batchId');
  {
    const res = await request('GET', '/api/pdfme/render/batch/nonexistent-batch-id');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- System template endpoints ---
  console.log('\n--- System Template Endpoints ---\n');

  // Test 10: GET system template with nonexistent ID
  console.log('Test 10: GET system template with nonexistent ID');
  {
    const res = await request('GET', '/api/pdfme/templates/system/nonexistent-sys-id');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- DataSource endpoints ---
  console.log('\n--- DataSource Endpoints ---\n');

  // Test 11: GET datasource with unregistered type
  console.log('Test 11: GET datasource with unregistered type');
  {
    const res = await request('GET', '/api/pdfme/datasources/nonexistent-type');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- Delete endpoints ---
  console.log('\n--- Delete Endpoints ---\n');

  // Test 12: DELETE template with nonexistent ID
  console.log('Test 12: DELETE template with nonexistent ID');
  {
    const res = await request('DELETE', '/api/pdfme/templates/nonexistent-del-id');
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- Error envelope format verification ---
  console.log('\n--- Error Envelope Format Verification ---\n');

  // Test 13: Verify complete error envelope structure
  console.log('Test 13: Complete error envelope structure');
  {
    const res = await request('GET', '/api/pdfme/templates/envelope-test-id');
    assert(`Returns 404`, res.status === 404);
    assert(`Has statusCode field`, res.body.statusCode === 404);
    assert(`Has error field "Not Found"`, res.body.error === 'Not Found');
    assert(`Has message string`, typeof res.body.message === 'string' && res.body.message.length > 0);
    assert(`Message is descriptive (not generic)`, res.body.message !== 'Not Found' && res.body.message.length > 5);
  }

  // Test 14: Verify 404 for preview of nonexistent template
  console.log('\nTest 14: POST preview for nonexistent template');
  {
    const res = await request('POST', '/api/pdfme/templates/nonexistent-preview/preview', {});
    assert(`Returns 404 (got ${res.status})`, res.status === 404);
  }

  // --- Summary ---
  console.log(`\n========================================`);
  console.log(`Results: ${PASS} passed, ${FAIL} failed out of ${PASS + FAIL} tests`);
  console.log(`========================================\n`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
