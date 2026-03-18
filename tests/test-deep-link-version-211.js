/**
 * Test: Feature #211 - Deep link to specific template version
 * Verifies version-specific access works correctly via GET /templates/:id/versions/:version
 */

const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000/api/pdfme';
const token = signJwt({ sub: 'test-user-211', orgId: 'org-211', roles: ['admin'] });
const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

var passed = 0;
var failed = 0;
var templateId = null;

var schemaV1 = {
  pages: [{ elements: [{ type: 'text', x: 10, y: 10, w: 100, h: 20, content: 'Version 1 content' }] }]
};
var schemaV2 = {
  pages: [{ elements: [{ type: 'text', x: 20, y: 30, w: 200, h: 40, content: 'Version 2 content' }] }]
};
var schemaV3 = {
  pages: [
    { elements: [{ type: 'text', x: 10, y: 10, w: 100, h: 20, content: 'V3 page 1' }] },
    { elements: [{ type: 'text', x: 10, y: 10, w: 100, h: 20, content: 'V3 page 2' }] }
  ]
};

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
  // Step 1: Create template
  return fetch(BASE + '/templates', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ name: 'DeepLink Version Test 211', type: 'invoice', schema: schemaV1 })
  })
  .then(function(res) { return res.json(); })
  .then(function(created) {
    templateId = created.id;
    assert(!!templateId, 'Template created with id: ' + templateId);

    // Step 2: Publish -> creates version 2 (version incremented from 1)
    return fetch(BASE + '/templates/' + templateId + '/publish', { method: 'POST', headers: headers });
  })
  .then(function(res) { return res.json(); })
  .then(function(pub1) {
    assert(pub1.status === 'published', 'First publish succeeded, status=' + pub1.status);
    assert(pub1.version === 2, 'Version incremented to 2 on publish, got=' + pub1.version);

    // Step 3: Set back to draft, update schema, publish again
    return fetch(BASE + '/templates/' + templateId, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({ schema: schemaV2, status: 'draft' })
    });
  })
  .then(function(res) { return res.json(); })
  .then(function(updated) {
    assert(updated.status === 'draft', 'Status set back to draft');
    return fetch(BASE + '/templates/' + templateId + '/publish', { method: 'POST', headers: headers });
  })
  .then(function(res) { return res.json(); })
  .then(function(pub2) {
    assert(pub2.status === 'published', 'Second publish succeeded');
    assert(pub2.version === 3, 'Version incremented to 3, got=' + pub2.version);

    // Step 4: Set back to draft, update schema, publish for v3
    return fetch(BASE + '/templates/' + templateId, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({ schema: schemaV3, status: 'draft' })
    });
  })
  .then(function(res) { return res.json(); })
  .then(function() {
    return fetch(BASE + '/templates/' + templateId + '/publish', { method: 'POST', headers: headers });
  })
  .then(function(res) { return res.json(); })
  .then(function(pub3) {
    assert(pub3.status === 'published', 'Third publish succeeded');
    assert(pub3.version === 4, 'Version incremented to 4, got=' + pub3.version);

    // Step 5: List all versions
    return fetch(BASE + '/templates/' + templateId + '/versions', { headers: headers });
  })
  .then(function(res) { return res.json(); })
  .then(function(allVersions) {
    assert(allVersions.total >= 3, 'At least 3 version entries exist, got: ' + allVersions.total);

    // Step 6: Deep link to version 2 (first publish)
    return fetch(BASE + '/templates/' + templateId + '/versions/2', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 200, 'Version 2 returns 200');
    return res.json();
  })
  .then(function(v2) {
    assert(v2.version === 2, 'Version 2 data has version=2, got=' + v2.version);
    assert(v2.templateId === templateId, 'Version 2 has correct templateId');
    assert(v2.schema !== undefined && v2.schema !== null, 'Version 2 has schema data');
    assert(v2.status !== undefined, 'Version 2 has status field');
    assert(v2.savedBy !== undefined, 'Version 2 has savedBy field');
    assert(v2.savedAt !== undefined, 'Version 2 has savedAt timestamp');
    assert(v2.id !== undefined, 'Version 2 has id field');

    // Step 7: Deep link to version 3
    return fetch(BASE + '/templates/' + templateId + '/versions/3', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 200, 'Version 3 returns 200');
    return res.json();
  })
  .then(function(v3) {
    assert(v3.version === 3, 'Version 3 data has version=3, got=' + v3.version);
    assert(v3.templateId === templateId, 'Version 3 has correct templateId');
    assert(v3.schema !== undefined, 'Version 3 has schema');

    // Step 8: Deep link to version 4
    return fetch(BASE + '/templates/' + templateId + '/versions/4', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 200, 'Version 4 returns 200');
    return res.json();
  })
  .then(function(v4) {
    assert(v4.version === 4, 'Version 4 data has version=4, got=' + v4.version);

    // Step 9: Verify different versions have different schemas
    return Promise.all([
      fetch(BASE + '/templates/' + templateId + '/versions/2', { headers: headers }).then(function(r) { return r.json(); }),
      fetch(BASE + '/templates/' + templateId + '/versions/3', { headers: headers }).then(function(r) { return r.json(); }),
      fetch(BASE + '/templates/' + templateId + '/versions/4', { headers: headers }).then(function(r) { return r.json(); })
    ]);
  })
  .then(function(versions) {
    var s1 = JSON.stringify(versions[0].schema);
    var s2 = JSON.stringify(versions[1].schema);
    var s3 = JSON.stringify(versions[2].schema);
    assert(s1 !== s2, 'Version 2 and 3 have different schemas');
    assert(s2 !== s3, 'Version 3 and 4 have different schemas');

    // Step 10: Nonexistent version returns 404
    return fetch(BASE + '/templates/' + templateId + '/versions/99', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'Nonexistent version 99 returns 404, got: ' + res.status);
    return res.json();
  })
  .then(function(body) {
    assert(body.error === 'Not Found', '404 response has error field');
    assert(body.message && body.message.indexOf('99') !== -1, '404 message mentions version 99');

    // Step 11: Malformed version "abc" returns 400
    return fetch(BASE + '/templates/' + templateId + '/versions/abc', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 400, 'Malformed version "abc" returns 400, got: ' + res.status);

    // Step 12: Version 0 returns 400
    return fetch(BASE + '/templates/' + templateId + '/versions/0', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 400, 'Version 0 returns 400, got: ' + res.status);

    // Step 13: Negative version returns 400
    return fetch(BASE + '/templates/' + templateId + '/versions/-1', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 400, 'Version -1 returns 400, got: ' + res.status);

    // Step 14: Version of nonexistent template returns 404
    return fetch(BASE + '/templates/nonexistent-id-xyz/versions/1', { headers: headers });
  })
  .then(function(res) {
    assert(res.status === 404, 'Version of nonexistent template returns 404, got: ' + res.status);

    // Step 15: Cleanup
    return fetch(BASE + '/templates/' + templateId, { method: 'DELETE', headers: headers });
  })
  .then(function(res) {
    assert(res.status === 200, 'Template archived for cleanup');

    console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
    if (failed > 0) process.exit(1);
  })
  .catch(function(err) {
    console.error('Test error:', err);
    process.exit(1);
  });
}

run();
