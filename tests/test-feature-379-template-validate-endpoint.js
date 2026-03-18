/**
 * Test Feature #379: Template validation endpoint works without publishing
 *
 * Verifies:
 * - POST /api/pdfme/templates/:id/validate returns validation results
 * - Template status remains unchanged (still draft) after validation
 * - All validation rules are applied (name, type, schema, pages, elements, bindings)
 */

const crypto = require('crypto');
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-validate-379';
const USER_ID = 'user-validate-379';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);
const templateIds = [];

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let bodyData;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(body);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function createTemplate(name, schema, type) {
  const res = await request('POST', '/api/pdfme/templates', {
    name,
    type: type || 'invoice',
    schema,
  }, TOKEN);
  if (res.body && res.body.id) templateIds.push(res.body.id);
  return res;
}

async function run() {
  console.log('\n=== Feature #379: Template validation endpoint works without publishing ===\n');

  // --- Test 1: Validate a valid draft template ---
  console.log('Test 1: Validate a valid draft template with correct invoice bindings');
  const validRes = await createTemplate('Valid Invoice 379', {
    pages: [{
      elements: [
        { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Invoice' },
        { type: 'text', name: 'custName', position: { x: 10, y: 40 }, width: 100, height: 20, content: '{{customer.name}}' },
        { type: 'text', name: 'total', position: { x: 10, y: 70 }, width: 100, height: 20, content: '{{totals.total}}' },
      ],
    }],
  });
  assert(validRes.status === 201 || validRes.status === 200, 'Created valid template (status ' + validRes.status + ')');
  const validId = validRes.body.id;

  // Check it's a draft
  const getRes = await request('GET', '/api/pdfme/templates/' + validId, null, TOKEN);
  assert(getRes.status === 200, 'Can fetch template');
  assert(getRes.body.status === 'draft', 'Template is in draft status (got: ' + getRes.body.status + ')');

  // Validate
  const valRes = await request('POST', '/api/pdfme/templates/' + validId + '/validate', null, TOKEN);
  assert(valRes.status === 200, 'Validate returns 200 (got: ' + valRes.status + ')');
  assert(valRes.body.valid === true, 'Valid template passes validation (valid=' + valRes.body.valid + ')');
  assert(Array.isArray(valRes.body.errors), 'Errors is an array');
  assert(valRes.body.errors.length === 0, 'No validation errors (got ' + (valRes.body.errors ? valRes.body.errors.length : 'N/A') + ')');
  assert(valRes.body.templateId === validId, 'Response includes correct templateId');
  assert(valRes.body.templateName === 'Valid Invoice 379', 'Response includes correct templateName');

  // Status unchanged
  const getAfter = await request('GET', '/api/pdfme/templates/' + validId, null, TOKEN);
  assert(getAfter.body.status === 'draft', 'Template still draft after validation (got: ' + getAfter.body.status + ')');

  // --- Test 2: Validate template with empty page (no elements) ---
  console.log('\nTest 2: Validate template with empty page');
  const emptyPageRes = await createTemplate('Empty Page 379', {
    pages: [{ elements: [] }],
  });
  const emptyPageId = emptyPageRes.body.id;

  const valEmpty = await request('POST', '/api/pdfme/templates/' + emptyPageId + '/validate', null, TOKEN);
  assert(valEmpty.status === 200, 'Validate returns 200 for invalid template');
  assert(valEmpty.body.valid === false, 'Empty-page template fails validation');
  assert(valEmpty.body.errors.length > 0, 'Has validation errors (count: ' + valEmpty.body.errors.length + ')');
  const hasPageError = valEmpty.body.errors.some(function(e) { return e.message && e.message.includes('no elements'); });
  assert(hasPageError, 'Reports empty page error');

  // Status still draft
  const getEmpty = await request('GET', '/api/pdfme/templates/' + emptyPageId, null, TOKEN);
  assert(getEmpty.body.status === 'draft', 'Empty-page template still draft after validation');

  // --- Test 3: Validate template with empty binding expression {{}} ---
  console.log('\nTest 3: Validate template with empty binding expression');
  const emptyBindRes = await createTemplate('Empty Binding 379', {
    pages: [{
      elements: [
        { type: 'text', name: 'f1', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{}}' },
      ],
    }],
  });
  const emptyBindId = emptyBindRes.body.id;

  const valEmptyBind = await request('POST', '/api/pdfme/templates/' + emptyBindId + '/validate', null, TOKEN);
  assert(valEmptyBind.status === 200, 'Validate returns 200 for empty binding');
  assert(valEmptyBind.body.valid === false, 'Empty binding fails validation');
  const hasEmptyBindError = valEmptyBind.body.errors.some(function(e) { return e.message && e.message.toLowerCase().includes('empty binding'); });
  assert(hasEmptyBindError, 'Reports empty binding error');
  const getEmptyBind = await request('GET', '/api/pdfme/templates/' + emptyBindId, null, TOKEN);
  assert(getEmptyBind.body.status === 'draft', 'Template still draft after empty binding validation');

  // --- Test 4: Validate template with unresolvable binding ---
  console.log('\nTest 4: Validate template with unresolvable binding (unknown invoice field)');
  const unresolvedRes = await createTemplate('Unresolved Binding 379', {
    pages: [{
      elements: [
        { type: 'text', name: 'f1', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{nonExistentField}}' },
      ],
    }],
  });
  const unresolvedId = unresolvedRes.body.id;

  const valUnresolved = await request('POST', '/api/pdfme/templates/' + unresolvedId + '/validate', null, TOKEN);
  assert(valUnresolved.status === 200, 'Validate returns 200 for unresolvable binding');
  assert(valUnresolved.body.valid === false, 'Unresolvable binding fails validation');
  const hasUnresolvedError = valUnresolved.body.errors.some(function(e) { return e.message && e.message.toLowerCase().includes('unresolvable'); });
  assert(hasUnresolvedError, 'Reports unresolvable binding error');
  const getUnresolved = await request('GET', '/api/pdfme/templates/' + unresolvedId, null, TOKEN);
  assert(getUnresolved.body.status === 'draft', 'Template still draft after unresolvable binding validation');

  // --- Test 5: Validate non-existent template returns 404 ---
  console.log('\nTest 5: Validate non-existent template');
  const val404 = await request('POST', '/api/pdfme/templates/nonexistent-id-379/validate', null, TOKEN);
  assert(val404.status === 404, 'Non-existent template returns 404 (got: ' + val404.status + ')');

  // --- Test 6: Multiple validations do not change status ---
  console.log('\nTest 6: Multiple validations do not change status');
  await request('POST', '/api/pdfme/templates/' + validId + '/validate', null, TOKEN);
  await request('POST', '/api/pdfme/templates/' + validId + '/validate', null, TOKEN);
  await request('POST', '/api/pdfme/templates/' + validId + '/validate', null, TOKEN);
  const getMulti = await request('GET', '/api/pdfme/templates/' + validId, null, TOKEN);
  assert(getMulti.body.status === 'draft', 'Template still draft after 3 validations (got: ' + getMulti.body.status + ')');

  // --- Test 7: Validate template with no pages ---
  console.log('\nTest 7: All validation rules - no pages');
  const noPagesRes = await createTemplate('No Pages 379', { randomField: true });
  const noPagesId = noPagesRes.body.id;
  const valNoPages = await request('POST', '/api/pdfme/templates/' + noPagesId + '/validate', null, TOKEN);
  assert(valNoPages.body.valid === false, 'No-pages template fails validation');
  const hasSchemaError = valNoPages.body.errors.some(function(e) { return e.field && e.field.includes('schema'); });
  assert(hasSchemaError, 'Reports schema/pages error for missing pages');

  // --- Test 8: Validate custom type template (no field schema) ---
  console.log('\nTest 8: Validate custom type template (no field schema registered)');
  const customRes = await createTemplate('Custom Type 379', {
    pages: [{
      elements: [
        { type: 'text', name: 'val', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{anyField}}' },
      ],
    }],
  }, 'custom');
  const customId = customRes.body.id;

  const valCustom = await request('POST', '/api/pdfme/templates/' + customId + '/validate', null, TOKEN);
  assert(valCustom.status === 200, 'Validate returns 200 for custom type');
  assert(valCustom.body.valid === true, 'Custom type with any binding passes (no field schema to check against)');
  const getCustom = await request('GET', '/api/pdfme/templates/' + customId, null, TOKEN);
  assert(getCustom.body.status === 'draft', 'Custom type template still draft after validation');

  // --- Test 9: Validate published template ---
  console.log('\nTest 9: Validate a published template (status stays published)');
  const pubRes = await request('POST', '/api/pdfme/templates/' + validId + '/publish', null, TOKEN);
  const getPub = await request('GET', '/api/pdfme/templates/' + validId, null, TOKEN);
  if (getPub.body.status === 'published') {
    const valPub = await request('POST', '/api/pdfme/templates/' + validId + '/validate', null, TOKEN);
    assert(valPub.status === 200, 'Can validate published template');
    assert(valPub.body.valid === true, 'Published template passes validation');
    const getAfterPub = await request('GET', '/api/pdfme/templates/' + validId, null, TOKEN);
    assert(getAfterPub.body.status === 'published', 'Published template stays published after validation (got: ' + getAfterPub.body.status + ')');
  } else {
    console.log('  (skipped - publish returned: ' + JSON.stringify(pubRes.body).substring(0, 200) + ')');
  }

  // --- Test 10: Validation response structure ---
  console.log('\nTest 10: Validation response structure is correct');
  const structRes = await request('POST', '/api/pdfme/templates/' + emptyPageId + '/validate', null, TOKEN);
  assert(typeof structRes.body.valid === 'boolean', 'valid field is boolean');
  assert(Array.isArray(structRes.body.errors), 'errors field is array');
  assert(typeof structRes.body.templateId === 'string', 'templateId field is string');
  assert(typeof structRes.body.templateName === 'string', 'templateName field is string');
  // Each error has field and message
  if (structRes.body.errors.length > 0) {
    assert(typeof structRes.body.errors[0].field === 'string', 'Error has field property');
    assert(typeof structRes.body.errors[0].message === 'string', 'Error has message property');
  }

  // --- Cleanup ---
  console.log('\nCleaning up...');
  for (const tid of templateIds) {
    if (tid) await request('DELETE', '/api/pdfme/templates/' + tid, null, TOKEN);
  }

  // --- Summary ---
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
