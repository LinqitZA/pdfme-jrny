/**
 * Test: Feature #213 - Health endpoint accessible without any auth
 * Verifies health check works with no auth, expired JWT, invalid JWT
 */

const { signJwt } = require('./create-signed-token');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme/health';

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

function createExpiredToken() {
  // Create a token with exp in the past
  var payload = {
    sub: 'expired-user',
    orgId: 'org-expired',
    roles: ['admin'],
    exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    iat: Math.floor(Date.now() / 1000) - 7200
  };
  return signJwt(payload);
}

function createInvalidToken() {
  // Completely invalid JWT string
  return 'invalid.token.string';
}

function createTamperedToken() {
  // Valid structure but tampered signature
  var token = signJwt({ sub: 'user', orgId: 'org1', roles: [] });
  return token.slice(0, -5) + 'XXXXX';
}

function run() {
  // Test 1: No auth headers at all
  return fetch(BASE)
  .then(function(res) {
    assert(res.status === 200, 'No auth headers returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Response has status: ok');
    assert(body.database !== undefined, 'Response has database info');
    assert(body.timestamp !== undefined, 'Response has timestamp');

    // Test 2: Empty Authorization header
    return fetch(BASE, { headers: { 'Authorization': '' } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Empty Authorization header returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Empty auth - status ok');

    // Test 3: Expired JWT
    var expiredToken = createExpiredToken();
    return fetch(BASE, { headers: { 'Authorization': 'Bearer ' + expiredToken } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Expired JWT returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Expired JWT - status ok');

    // Test 4: Invalid JWT (not a real token)
    return fetch(BASE, { headers: { 'Authorization': 'Bearer ' + createInvalidToken() } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Invalid JWT returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Invalid JWT - status ok');

    // Test 5: Tampered JWT
    return fetch(BASE, { headers: { 'Authorization': 'Bearer ' + createTamperedToken() } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Tampered JWT returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Tampered JWT - status ok');

    // Test 6: Garbage Authorization header (not Bearer format)
    return fetch(BASE, { headers: { 'Authorization': 'Basic dXNlcjpwYXNz' } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Basic auth header returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Basic auth - status ok');

    // Test 7: Valid JWT should also work
    var validToken = signJwt({ sub: 'valid-user', orgId: 'org-valid', roles: ['admin'] });
    return fetch(BASE, { headers: { 'Authorization': 'Bearer ' + validToken } });
  })
  .then(function(res) {
    assert(res.status === 200, 'Valid JWT returns 200, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.status === 'ok', 'Valid JWT - status ok');
    assert(body.database && body.database.status === 'connected', 'Database connected');

    console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
    if (failed > 0) process.exit(1);
  })
  .catch(function(err) {
    console.error('Test error:', err);
    process.exit(1);
  });
}

run();
