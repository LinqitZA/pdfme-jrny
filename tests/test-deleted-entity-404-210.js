/**
 * Test: Feature #210 - API endpoint with deleted entity returns 404
 * Verifies that accessing deleted/archived resources returns proper 404
 */

const crypto = require('crypto');
const BASE = process.env.API_URL || 'http://localhost:3000';

function makeJwt(orgId) {
  const secret = 'pdfme-dev-secret';
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({sub:'test-user-210',orgId: orgId || 'test-org-210',roles:['template:view','template:edit','template:publish','template:delete','render:trigger']})).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}

const TOKEN = makeJwt('test-org-210');
const AUTH = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

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
  const res = await fetch(url, { ...options, headers: { ...AUTH, ...options.headers } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function run() {
  console.log('\n=== Feature #210: API endpoint with deleted entity returns 404 ===\n');

  // Step 1: Create a template
  console.log('Setup: Creating test template...');
  const createRes = await fetchJSON(BASE + '/api/pdfme/templates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'DELETE_TEST_210_' + Date.now(),
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', x: 10, y: 10, w: 100, h: 20, content: 'test' }] }] },
    }),
  });
  assert(createRes.status === 201, 'Template created (status ' + createRes.status + ')');
  const templateId = createRes.json && createRes.json.id;
  assert(templateId, 'Got template ID: ' + templateId);

  if (!templateId) {
    console.log('Cannot continue without template ID');
    process.exit(1);
  }

  // Step 2: Verify it's accessible
  console.log('\nTest 1: Template accessible before deletion');
  {
    const { status } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId);
    assert(status === 200, 'GET template returns 200 (got ' + status + ')');
  }

  // Step 3: Delete (archive) the template
  console.log('\nTest 2: Delete (archive) the template');
  {
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId, {
      method: 'DELETE',
    });
    assert(status === 200, 'DELETE returns 200 (got ' + status + ')');
    assert(json && json.status === 'archived', 'Status is "archived"');
  }

  // Step 4: GET deleted template returns 404
  console.log('\nTest 3: GET deleted template returns 404');
  {
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId);
    assert(status === 404, 'GET archived template returns 404 (got ' + status + ')');
    assert(json && json.statusCode === 404, 'statusCode field is 404');
    assert(json && json.error === 'Not Found', 'error is "Not Found"');
    assert(json && json.message && json.message.includes(templateId), 'Message includes template ID');
  }

  // Step 5: Template not in list
  console.log('\nTest 4: Deleted template not in list');
  {
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates');
    assert(status === 200, 'List returns 200');
    const found = json && json.data && json.data.find(t => t.id === templateId);
    assert(!found, 'Archived template not in list results');
  }

  // Step 6: Access versions of deleted template
  console.log('\nTest 5: GET versions of deleted template');
  {
    const { status } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId + '/versions');
    // May return 200 with empty array or 404 - both acceptable
    assert(status === 200 || status === 404, 'Versions returns 200 or 404 (got ' + status + ')');
  }

  // Step 7: Attempt to save draft on deleted template
  console.log('\nTest 6: PUT draft on deleted template');
  {
    const { status } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId + '/draft', {
      method: 'PUT',
      body: JSON.stringify({ schema: { pages: [] } }),
    });
    // Should return 404 or similar error
    assert(status === 404 || status === 409 || status === 400, 'Draft save on archived returns error (got ' + status + ')');
  }

  // Step 8: GET nonexistent template ID returns 404
  console.log('\nTest 7: GET completely nonexistent template ID');
  {
    const fakeId = 'nonexistent-id-' + Date.now();
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/templates/' + fakeId);
    assert(status === 404, 'Returns 404 (got ' + status + ')');
    assert(json && json.statusCode === 404, 'statusCode is 404');
  }

  // Step 9: Download nonexistent rendered document returns 404
  console.log('\nTest 8: Download nonexistent document');
  {
    const fakeDocId = 'fake-doc-' + Date.now();
    const { status } = await fetchJSON(BASE + '/api/pdfme/render/document/' + fakeDocId);
    assert(status === 404 || status === 400, 'Nonexistent document returns 404 or 400 (got ' + status + ')');
  }

  // Step 10: Download nonexistent preview returns 404
  console.log('\nTest 9: Download nonexistent preview');
  {
    const fakePreviewId = 'fake-preview-' + Date.now();
    const { status } = await fetchJSON(BASE + '/api/pdfme/render/download/' + fakePreviewId);
    assert(status === 404 || status === 400 || status === 410, 'Nonexistent preview returns error (got ' + status + ')');
  }

  // Step 11: Access nonexistent asset returns 404
  console.log('\nTest 10: GET nonexistent asset');
  {
    const fakeAssetId = 'fake-asset-' + Date.now();
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/assets/' + fakeAssetId);
    assert(status === 404, 'Nonexistent asset returns 404 (got ' + status + ')');
    assert(json && json.statusCode === 404, 'statusCode is 404');
  }

  // Step 12: Delete nonexistent asset returns 404
  console.log('\nTest 11: DELETE nonexistent asset');
  {
    const fakeAssetId = 'fake-asset-del-' + Date.now();
    const { status, json } = await fetchJSON(BASE + '/api/pdfme/assets/' + fakeAssetId, {
      method: 'DELETE',
    });
    assert(status === 404, 'Delete nonexistent asset returns 404 (got ' + status + ')');
  }

  // Step 13: No stack traces in any 404 response
  console.log('\nTest 12: No stack traces in 404 responses');
  {
    const { json } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId);
    const str = JSON.stringify(json);
    assert(!str.includes('at '), 'No stack trace in response');
    assert(!str.includes('node_modules'), 'No node_modules paths');
  }

  // Step 14: Delete already-deleted template
  console.log('\nTest 13: DELETE already-deleted template');
  {
    const { status } = await fetchJSON(BASE + '/api/pdfme/templates/' + templateId, {
      method: 'DELETE',
    });
    // May return 200 (idempotent archive) or 404
    assert(status === 200 || status === 404, 'Re-delete returns 200 or 404 (got ' + status + ')');
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
