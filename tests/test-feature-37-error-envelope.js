/**
 * Feature #37: Error responses use consistent error envelope
 *
 * All errors follow standard format with statusCode, error, message, timestamp, path.
 * 422 errors include a details field with structured validation issues.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const FULL_TOKEN = makeToken('err-test-user', 'err-test-org', [
  'template:view', 'template:edit', 'template:publish', 'template:delete',
  'template:import', 'render:trigger', 'render:bulk', 'system:seed',
]);
const NO_PERMS_TOKEN = makeToken('err-test-noperms', 'err-test-org', []);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    // console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}`);
  }
}

/**
 * Verify the standard error envelope fields exist and are correct types
 */
function verifyEnvelope(resp, expectedStatus, testLabel) {
  const b = resp.body;
  assert(resp.status === expectedStatus, `${testLabel}: HTTP status is ${expectedStatus} (got ${resp.status})`);
  assert(typeof b === 'object' && b !== null, `${testLabel}: response is JSON object`);
  assert(b.statusCode === expectedStatus, `${testLabel}: body.statusCode is ${expectedStatus} (got ${b.statusCode})`);
  assert(typeof b.error === 'string' && b.error.length > 0, `${testLabel}: body.error is non-empty string (got "${b.error}")`);
  assert(typeof b.message === 'string' && b.message.length > 0, `${testLabel}: body.message is non-empty string`);
  assert(typeof b.timestamp === 'string' && b.timestamp.length > 0, `${testLabel}: body.timestamp is present`);
  // Verify timestamp is valid ISO date
  assert(!isNaN(Date.parse(b.timestamp)), `${testLabel}: body.timestamp is valid ISO date`);
  assert(typeof b.path === 'string' && b.path.length > 0, `${testLabel}: body.path is present`);
}

async function run() {
  console.log('Feature #37: Error responses use consistent error envelope\n');

  // === 1. 400 Bad Request - invalid body on render/now ===
  console.log('Test 1: 400 Bad Request (invalid body)');
  const resp400 = await request('POST', '/api/pdfme/render/now', { invalid: 'data' }, FULL_TOKEN);
  verifyEnvelope(resp400, 400, '400');
  assert(resp400.body.error === 'Bad Request', '400: error label is "Bad Request"');

  // === 2. 401 Unauthorized - no auth ===
  console.log('Test 2: 401 Unauthorized (no auth header)');
  const resp401 = await request('GET', '/api/pdfme/templates', null, null);
  verifyEnvelope(resp401, 401, '401-no-auth');
  assert(resp401.body.error === 'Unauthorized', '401: error label is "Unauthorized"');

  // === 3. 401 Unauthorized - invalid token ===
  console.log('Test 3: 401 Unauthorized (invalid token)');
  const resp401bad = await request('GET', '/api/pdfme/templates', null, 'invalid.token.here');
  verifyEnvelope(resp401bad, 401, '401-bad-token');
  assert(resp401bad.body.error === 'Unauthorized', '401-bad: error label is "Unauthorized"');

  // === 4. 403 Forbidden - no permissions ===
  console.log('Test 4: 403 Forbidden (no permissions)');
  const resp403 = await request('GET', '/api/pdfme/templates', null, NO_PERMS_TOKEN);
  verifyEnvelope(resp403, 403, '403');
  assert(resp403.body.error === 'Forbidden', '403: error label is "Forbidden"');

  // === 5. 404 Not Found - nonexistent template ===
  console.log('Test 5: 404 Not Found');
  const resp404 = await request('GET', '/api/pdfme/templates/nonexistent-id-12345', null, FULL_TOKEN);
  verifyEnvelope(resp404, 404, '404');
  assert(resp404.body.error === 'Not Found', '404: error label is "Not Found"');

  // === 6. 422 Validation failure - import with bad structure ===
  console.log('Test 6: 422 Unprocessable Entity (validation failure)');
  const resp422 = await request('POST', '/api/pdfme/templates/import', {
    version: 999,
    template: 'not-an-object',
  }, FULL_TOKEN);
  verifyEnvelope(resp422, 422, '422');
  assert(resp422.body.error === 'Unprocessable Entity', '422: error label is "Unprocessable Entity"');
  assert(Array.isArray(resp422.body.details), '422: body.details is an array');
  if (Array.isArray(resp422.body.details) && resp422.body.details.length > 0) {
    const detail = resp422.body.details[0];
    assert(typeof detail.field === 'string', '422: details[0].field is a string');
    assert(typeof detail.reason === 'string', '422: details[0].reason is a string');
  }

  // === 7. 400 on render/now - verify details array ===
  console.log('Test 7: 400 with details array (render/now validation)');
  const resp400details = await request('POST', '/api/pdfme/render/now', {}, FULL_TOKEN);
  verifyEnvelope(resp400details, 400, '400-details');
  assert(Array.isArray(resp400details.body.details), '400: body.details is an array for validation errors');
  if (Array.isArray(resp400details.body.details) && resp400details.body.details.length > 0) {
    const detail = resp400details.body.details[0];
    assert(typeof detail.field === 'string', '400: details[0].field is a string');
    assert(typeof detail.reason === 'string', '400: details[0].reason is a string');
  }

  // === 8. Cross-check consistency: all envelope fields present across different status codes ===
  console.log('Test 8: Cross-check all envelopes have same base fields');
  const requiredFields = ['statusCode', 'error', 'message', 'timestamp', 'path'];
  const responses = [resp400, resp401, resp401bad, resp403, resp404, resp422];
  const labels = ['400', '401-noauth', '401-badtoken', '403', '404', '422'];
  for (let i = 0; i < responses.length; i++) {
    for (const field of requiredFields) {
      assert(responses[i].body[field] !== undefined, `${labels[i]}: has field "${field}"`);
    }
  }

  // === 9. Verify path matches request URL ===
  console.log('Test 9: path field matches request URL');
  assert(resp401.body.path === '/api/pdfme/templates', '401: path matches /api/pdfme/templates');
  assert(resp404.body.path === '/api/pdfme/templates/nonexistent-id-12345', '404: path matches requested URL');
  assert(resp403.body.path === '/api/pdfme/templates', '403: path matches /api/pdfme/templates');

  // === 10. Verify error names map correctly ===
  console.log('Test 10: error names map to status codes');
  assert(resp400.body.error === 'Bad Request' && resp400.body.statusCode === 400, 'Bad Request maps to 400');
  assert(resp401.body.error === 'Unauthorized' && resp401.body.statusCode === 401, 'Unauthorized maps to 401');
  assert(resp403.body.error === 'Forbidden' && resp403.body.statusCode === 403, 'Forbidden maps to 403');
  assert(resp404.body.error === 'Not Found' && resp404.body.statusCode === 404, 'Not Found maps to 404');
  assert(resp422.body.error === 'Unprocessable Entity' && resp422.body.statusCode === 422, 'Unprocessable Entity maps to 422');

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed!');
  }
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
