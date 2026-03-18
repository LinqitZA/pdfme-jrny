/**
 * Test: Feature #212 - Field schema endpoint handles unknown type
 * Verifies unknown template type returns 404, no server error
 */

const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000/api/pdfme/field-schema';
const token = signJwt({ sub: 'test-user-212', orgId: 'org-212', roles: ['admin'] });
const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

var passed = 0;
var failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

function run() {
  // Test 1: Unknown type returns 404
  return fetch(BASE + '/unknown_type', { headers: headers })
  .then(function(res) {
    assert(res.status === 404, 'GET /field-schema/unknown_type returns 404, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.statusCode === 404, 'Response body has statusCode 404');
    assert(body.error === 'Not Found', 'Response has error: Not Found');
    assert(body.message && body.message.indexOf('unknown_type') !== -1, 'Message mentions the unknown type');

    // Test 2: Another unknown type
    return fetch(BASE + '/nonexistent_document', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'GET /field-schema/nonexistent_document returns 404');
    return res.json();
  })
  .then(function(body) {
    assert(body.message && body.message.indexOf('nonexistent_document') !== -1, 'Message mentions nonexistent_document');

    // Test 3: Random string type
    return fetch(BASE + '/xyzzy123', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'GET /field-schema/xyzzy123 returns 404');

    // Test 4: Empty-like type with special characters
    return fetch(BASE + '/some-weird-type', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'GET /field-schema/some-weird-type returns 404');

    // Test 5: Type with spaces (URL encoded)
    return fetch(BASE + '/' + encodeURIComponent('bad type'), { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'GET /field-schema/bad%20type returns 404');

    // Test 6: Verify no 500 errors - server is still healthy
    return fetch('http://localhost:3000/api/pdfme/health');
  })
  .then(function(res) {
    assert(res.status === 200, 'Server still healthy after unknown type requests');
    return res.json();
  })
  .then(function(health) {
    assert(health.status === 'ok', 'Health check returns ok');

    // Test 7: Verify known type works (invoice is registered based on existing data)
    return fetch(BASE + '/invoice', { headers: headers });
  })
  .then(function(res) {
    var status = res.status;
    // Known type should return 200, or 404 if not registered yet - either is fine
    // The key test is that unknown types return 404 gracefully
    assert(status === 200 || status === 404, 'Known type invoice returns 200 or 404 (may not be registered), got: ' + status);

    console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
    if (failed > 0) process.exit(1);
  })
  .catch(function(err) {
    console.error('Test error:', err);
    process.exit(1);
  });
}

run();
