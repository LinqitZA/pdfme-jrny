/**
 * Feature #204: Direct API access validates JWT on every route
 *
 * Verifies all protected routes return 401 when accessed without JWT.
 * Health endpoint (marked @Public) should remain accessible.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + message);
  } else {
    failed++;
    console.log('  FAIL: ' + message);
  }
}

async function testEndpoint(method, path, body, expectedStatus, description) {
  const opts = {
    method: method,
    headers: {},
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(function() { return {}; });
  assert(
    res.status === expectedStatus,
    description + ' -> ' + method + ' ' + path + ' returns ' + res.status + ' (expected ' + expectedStatus + ')'
  );
  if (expectedStatus === 401) {
    assert(
      data.statusCode === 401 || data.error === 'Unauthorized',
      '  Error body indicates Unauthorized'
    );
  }
  return res.status;
}

async function test_health_is_public() {
  console.log('\nTest: Health endpoint is accessible without JWT (@Public)');
  const res = await fetch(API_BASE + '/health');
  const data = await res.json();
  assert(res.status === 200, 'GET /health returns 200 without JWT');
  assert(data.status === 'ok', 'Health status is ok');
}

async function test_templates_require_jwt() {
  console.log('\nTest: Template endpoints require JWT');
  await testEndpoint('GET', '/templates', null, 401, 'List templates');
  await testEndpoint('GET', '/templates/some-id', null, 401, 'Get template by ID');
  await testEndpoint('POST', '/templates', { name: 'test', type: 'invoice', schema: {} }, 401, 'Create template');
  await testEndpoint('PUT', '/templates/some-id', { name: 'updated' }, 401, 'Update template');
  await testEndpoint('DELETE', '/templates/some-id', null, 401, 'Delete template');
}

async function test_template_sub_routes_require_jwt() {
  console.log('\nTest: Template sub-routes require JWT');
  await testEndpoint('PUT', '/templates/some-id/draft', { schema: {} }, 401, 'Save draft');
  await testEndpoint('POST', '/templates/some-id/publish', null, 401, 'Publish template');
  await testEndpoint('POST', '/templates/some-id/preview', { sampleRowCount: 5 }, 401, 'Preview template');
  await testEndpoint('POST', '/templates/some-id/lock', null, 401, 'Acquire lock');
  await testEndpoint('DELETE', '/templates/some-id/lock', null, 401, 'Release lock');
  await testEndpoint('GET', '/templates/some-id/lock', null, 401, 'Get lock status');
  await testEndpoint('GET', '/templates/some-id/versions', null, 401, 'Get version history');
  await testEndpoint('GET', '/templates/some-id/export', null, 401, 'Export template');
  await testEndpoint('POST', '/templates/import', { version: 1, template: {} }, 401, 'Import template');
  await testEndpoint('GET', '/templates/types', null, 401, 'Get distinct types');
}

async function test_render_endpoints_require_jwt() {
  console.log('\nTest: Render endpoints require JWT');
  await testEndpoint('POST', '/render/now', { templateId: 'x', entityId: 'y', channel: 'email' }, 401, 'Render now');
  await testEndpoint('POST', '/render/bulk', { templateId: 'x', entityIds: ['y'], channel: 'email' }, 401, 'Render bulk');
  await testEndpoint('GET', '/render/batch/some-id', null, 401, 'Batch status');
  await testEndpoint('GET', '/render/document/some-id', null, 401, 'Download document');
  await testEndpoint('GET', '/render/download/some-id', null, 401, 'Download preview');
  await testEndpoint('GET', '/render/verify/some-id', null, 401, 'Verify document');
  await testEndpoint('POST', '/render/async', { templateId: 'x', entityId: 'y', channel: 'email' }, 401, 'Async render');
}

async function test_other_endpoints_require_jwt() {
  console.log('\nTest: Other protected endpoints require JWT');
  await testEndpoint('GET', '/audit', null, 401, 'Audit log');
  await testEndpoint('POST', '/expressions/evaluate', { expression: '1+1' }, 401, 'Expression evaluate');
  await testEndpoint('GET', '/config', null, 401, 'Config');
  await testEndpoint('GET', '/field-schema/invoice', null, 401, 'Field schemas');
}

async function test_invalid_jwt_rejected() {
  console.log('\nTest: Invalid/malformed JWT is rejected');

  const endpoints = [
    ['GET', '/templates'],
    ['POST', '/render/now'],
    ['DELETE', '/templates/fake-id'],
  ];

  for (const ep of endpoints) {
    const method = ep[0];
    const path = ep[1];
    const opts = {
      method: method,
      headers: { 'Authorization': 'Bearer invalid.token.here' },
    };
    if (method === 'POST') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify({ templateId: 'x', entityId: 'y', channel: 'email' });
    }
    const res = await fetch(API_BASE + path, opts);
    assert(res.status === 401, method + ' ' + path + ' with invalid JWT returns 401 (got ' + res.status + ')');
  }
}

async function test_missing_bearer_prefix_rejected() {
  console.log('\nTest: Authorization header without Bearer prefix is rejected');
  const res = await fetch(API_BASE + '/templates', {
    headers: { 'Authorization': 'Basic some-credentials' },
  });
  assert(res.status === 401, 'Non-Bearer auth returns 401 (got ' + res.status + ')');
}

async function run() {
  console.log('=== Feature #204: Direct API access validates JWT on every route ===');

  await test_health_is_public();
  await test_templates_require_jwt();
  await test_template_sub_routes_require_jwt();
  await test_render_endpoints_require_jwt();
  await test_other_endpoints_require_jwt();
  await test_invalid_jwt_rejected();
  await test_missing_bearer_prefix_rejected();

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===');
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
