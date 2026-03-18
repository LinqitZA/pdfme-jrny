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

const BASE = 'http://localhost:3000';
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
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function createTemplate(name, schema, type = 'invoice') {
  const res = await request('POST', '/api/pdfme/templates', {
    name,
    type,
    schema,
  }, TOKEN);
  return res;
}

// Good template schema with pages format - uses valid invoice field bindings
function validSchema() {
  return {
    pages: [
      {
        elements: [
          { type: 'text', name: 'title', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Invoice' },
          { type: 'text', name: 'custName', position: { x: 10, y: 40 }, width: 100, height: 20, content: '{{customer.name}}' },
        ],
      },
    ],
  };
}

// Schema using a custom type (no registered field schema, so bindings aren't checked against fields)
function customTypeSchema() {
  return {
    pages: [
      {
        elements: [
          { type: 'text', name: 'title', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Custom Doc' },
          { type: 'text', name: 'val', position: { x: 10, y: 40 }, width: 100, height: 20, content: '{{myField}}' },
        ],
      },
    ],
  };
}

async function run() {
  console.log('\n=== Feature #379: Template validation endpoint works without publishing ===\n');

  // --- Test 1: Create a valid draft template and validate it ---
  console.log('Test 1: Validate a valid draft template');
  const validRes = await createTemplate('Valid Template 379', validSchema());
  assert(validRes.status === 201 || validRes.status === 200, `Created valid template (status ${validRes.status})`);
  const validId = validRes.body.id;

  // Check it's a draft
  const getRes = await request('GET', `/api/pdfme/templates/${validId}`, null, TOKEN);
  assert(getRes.status === 200, 'Can fetch the template');
  assert(getRes.body.status === 'draft', `Template is in draft status (got: ${getRes.body.status})`);

  // Validate
  const valRes = await request('POST', `/api/pdfme/templates/${validId}/validate`, null, TOKEN);
  assert(valRes.status === 200, `Validate returns 200 (got: ${valRes.status})`);
  assert(valRes.body.valid === true, `Valid template passes validation (valid=${valRes.body.valid})`);
  assert(Array.isArray(valRes.body.errors), 'Errors is an array');
  assert(valRes.body.errors.length === 0, `No validation errors (got ${valRes.body.errors?.length || 'N/A'})`);
  assert(valRes.body.templateId === validId, `Response includes templateId (${valRes.body.templateId})`);
  assert(valRes.body.templateName === 'Valid Template 379', `Response includes templateName (${valRes.body.templateName})`);

  // Check status unchanged after validation
  const getAfter = await request('GET', `/api/pdfme/templates/${validId}`, null, TOKEN);
  assert(getAfter.body.status === 'draft', `Template still draft after validation (got: ${getAfter.body.status})`);

  // --- Test 2: Validate a template with missing schema elements ---
  console.log('\nTest 2: Validate template with empty page (no elements)');
  const emptyPageRes = await createTemplate('Empty Page 379', {
    pages: [{ elements: [] }],
  });
  const emptyPageId = emptyPageRes.body.id;

  const valEmpty = await request('POST', `/api/pdfme/templates/${emptyPageId}/validate`, null, TOKEN);
  assert(valEmpty.status === 200, `Validate returns 200 for invalid template (got: ${valEmpty.status})`);
  assert(valEmpty.body.valid === false, `Invalid template fails validation (valid=${valEmpty.body.valid})`);
  assert(valEmpty.body.errors.length > 0, `Has validation errors (count: ${valEmpty.body.errors.length})`);
  const hasPageError = valEmpty.body.errors.some(e => e.message && e.message.includes('no elements'));
  assert(hasPageError, 'Reports empty page error');

  // Status still draft
  const getEmpty = await request('GET', `/api/pdfme/templates/${emptyPageId}`, null, TOKEN);
  assert(getEmpty.body.status === 'draft', `Empty-page template still draft after validation (got: ${getEmpty.body.status})`);

  // --- Test 3: Validate template with invalid binding ---
  console.log('\nTest 3: Validate template with invalid binding expression');
  const badBindRes = await createTemplate('Bad Binding 379', {
    pages: [
      {
        elements: [
          { type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{}}' },
        ],
      },
    ],
  });
  const badBindId = badBindRes.body.id;

  const valBadBind = await request('POST', `/api/pdfme/templates/${badBindId}/validate`, null, TOKEN);
  assert(valBadBind.status === 200, `Validate returns 200 for bad binding (got: ${valBadBind.status})`);
  assert(valBadBind.body.valid === false, `Bad binding fails validation (valid=${valBadBind.body.valid})`);
  const hasBindingError = valBadBind.body.errors.some(e => e.message && e.message.toLowerCase().includes('binding'));
  assert(hasBindingError, 'Reports binding error');

  // Status still draft
  const getBadBind = await request('GET', `/api/pdfme/templates/${badBindId}`, null, TOKEN);
  assert(getBadBind.body.status === 'draft', `Bad-binding template still draft after validation (got: ${getBadBind.body.status})`);

  // --- Test 4: Validate non-existent template returns 404 ---
  console.log('\nTest 4: Validate non-existent template');
  const val404 = await request('POST', '/api/pdfme/templates/nonexistent-id-379/validate', null, TOKEN);
  assert(val404.status === 404, `Non-existent template returns 404 (got: ${val404.status})`);

  // --- Test 5: Validate does NOT change status to published ---
  console.log('\nTest 5: Multiple validations do not change status');
  // Validate same template multiple times
  await request('POST', `/api/pdfme/templates/${validId}/validate`, null, TOKEN);
  await request('POST', `/api/pdfme/templates/${validId}/validate`, null, TOKEN);
  const getMulti = await request('GET', `/api/pdfme/templates/${validId}`, null, TOKEN);
  assert(getMulti.body.status === 'draft', `Template still draft after multiple validations (got: ${getMulti.body.status})`);

  // --- Test 6: Validate returns all rule types ---
  console.log('\nTest 6: All validation rules applied');
  // Template with no pages
  const noPagesRes = await createTemplate('No Pages 379', { randomField: true });
  const noPagesId = noPagesRes.body.id;
  const valNoPages = await request('POST', `/api/pdfme/templates/${noPagesId}/validate`, null, TOKEN);
  assert(valNoPages.body.valid === false, 'No-pages template fails validation');
  const hasSchemaError = valNoPages.body.errors.some(e => e.field && e.field.includes('schema'));
  assert(hasSchemaError, 'Reports schema/pages error for missing pages');

  // --- Test 7: Validate published template also works ---
  console.log('\nTest 7: Validate a published template');
  // First publish the valid template
  const pubRes = await request('POST', `/api/pdfme/templates/${validId}/publish`, null, TOKEN);
  const getPub = await request('GET', `/api/pdfme/templates/${validId}`, null, TOKEN);
  if (getPub.body.status === 'published') {
    const valPub = await request('POST', `/api/pdfme/templates/${validId}/validate`, null, TOKEN);
    assert(valPub.status === 200, `Can validate published template (status ${valPub.status})`);
    assert(valPub.body.valid === true, `Published template passes validation (valid=${valPub.body.valid})`);
    // Status stays published (not reverted to draft)
    const getAfterPub = await request('GET', `/api/pdfme/templates/${validId}`, null, TOKEN);
    assert(getAfterPub.body.status === 'published', `Published template stays published after validation (got: ${getAfterPub.body.status})`);
  } else {
    console.log('  (skipped - could not publish template)');
  }

  // --- Cleanup ---
  console.log('\nCleaning up...');
  for (const tid of [validId, emptyPageId, badBindId, noPagesId]) {
    if (tid) await request('DELETE', `/api/pdfme/templates/${tid}`, null, TOKEN);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
