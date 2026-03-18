/**
 * Feature #108: Template validation runs at publish time
 * Publish validates bindings, expressions, fonts
 */

const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const BASE = 'http://localhost:3000/api/pdfme';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-val-108';
const USER_ID = 'user-val-108';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger']
});

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

let passed = 0;
let failed = 0;
const templateIds = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function createTemplate(name, schema) {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, type: 'invoice', schema })
  });
  const data = await res.json();
  if (data.id) templateIds.push(data.id);
  return { res, data };
}

async function publishTemplate(id) {
  const res = await fetch(`${BASE}/templates/${id}/publish`, {
    method: 'POST',
    headers
  });
  const data = await res.json();
  return { res, data };
}

async function saveDraft(id, schema) {
  const res = await fetch(`${BASE}/templates/${id}/draft`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ schema })
  });
  const data = await res.json();
  return { res, data };
}

async function test1_invalidEmptyBinding() {
  console.log('\n--- Test 1: Template with empty binding {{}} fails publish ---');
  const { data: tmpl } = await createTemplate('Validation Test - Empty Binding', {
    pages: [{
      elements: [{
        name: 'field1',
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: 'Value: {{}}'
      }]
    }]
  });
  assert(tmpl.id, `Created template with empty binding`);

  const { res, data } = await publishTemplate(tmpl.id);
  assert(res.status === 422, `Publish returns 422 (got ${res.status})`);
  assert(data.message && data.message.includes('validation'), `Error message mentions validation`);
  assert(data.details && Array.isArray(data.details), `Response has details array`);
  assert(data.details.length > 0, `Details array has validation errors`);

  // Check that at least one error mentions empty binding
  const hasEmptyBindingError = data.details.some(d =>
    d.message && (d.message.includes('Empty binding') || d.message.includes('{{}}'))
  );
  assert(hasEmptyBindingError, `Details mention empty binding error`);
  return tmpl.id;
}

async function test2_invalidBindingSyntax() {
  console.log('\n--- Test 2: Template with invalid binding syntax fails publish ---');
  const { data: tmpl } = await createTemplate('Validation Test - Invalid Binding', {
    pages: [{
      elements: [{
        name: 'field1',
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: 'Value: {{123invalid}}'
      }]
    }]
  });
  assert(tmpl.id, `Created template with invalid binding syntax`);

  const { res, data } = await publishTemplate(tmpl.id);
  assert(res.status === 422, `Publish returns 422 (got ${res.status})`);
  assert(data.details && data.details.length > 0, `Has validation error details`);

  const hasInvalidBindingError = data.details.some(d =>
    d.message && (d.message.includes('Invalid binding') || d.message.includes('123invalid'))
  );
  assert(hasInvalidBindingError, `Details mention invalid binding syntax`);
  return tmpl.id;
}

async function test3_noElements() {
  console.log('\n--- Test 3: Template with empty page fails publish ---');
  const { data: tmpl } = await createTemplate('Validation Test - No Elements', {
    pages: [{
      elements: []
    }]
  });
  assert(tmpl.id, `Created template with empty page`);

  const { res, data } = await publishTemplate(tmpl.id);
  assert(res.status === 422, `Publish returns 422 (got ${res.status})`);
  assert(data.details && data.details.length > 0, `Has validation errors for empty page`);

  const hasEmptyPageError = data.details.some(d =>
    d.message && (d.message.includes('no elements') || d.message.includes('at least one'))
  );
  assert(hasEmptyPageError, `Details mention empty page`);
  return tmpl.id;
}

async function test4_invalidExpression() {
  console.log('\n--- Test 4: Template with invalid calculated field expression fails publish ---');
  const { data: tmpl } = await createTemplate('Validation Test - Bad Expression', {
    pages: [{
      elements: [{
        name: 'calc1',
        type: 'calculated-field',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: 'INVALID_FUNC(a, b, %%%)'
      }]
    }]
  });
  assert(tmpl.id, `Created template with invalid expression`);

  const { res, data } = await publishTemplate(tmpl.id);
  assert(res.status === 422, `Publish returns 422 (got ${res.status})`);
  assert(data.details && data.details.length > 0, `Has validation errors for bad expression`);

  const hasExprError = data.details.some(d =>
    d.message && (d.message.toLowerCase().includes('expression') || d.message.toLowerCase().includes('invalid'))
  );
  assert(hasExprError, `Details mention invalid expression`);
  return tmpl.id;
}

async function test5_fixAndPublish() {
  console.log('\n--- Test 5: Fix binding then publish successfully ---');
  // Create template with invalid binding
  const { data: tmpl } = await createTemplate('Validation Test - Fix And Publish', {
    pages: [{
      elements: [{
        name: 'field1',
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: 'Bad: {{}}'
      }]
    }]
  });
  assert(tmpl.id, `Created template with invalid binding`);

  // Verify it fails
  const { res: failRes, data: failData } = await publishTemplate(tmpl.id);
  assert(failRes.status === 422, `Publish correctly rejects invalid template (${failRes.status})`);

  // Fix the binding by saving a new draft
  const fixedSchema = {
    pages: [{
      elements: [{
        name: 'field1',
        type: 'text',
        position: { x: 10, y: 10 },
        width: 200,
        height: 30,
        content: 'Fixed content - no bindings'
      }]
    }]
  };
  const { res: draftRes } = await saveDraft(tmpl.id, fixedSchema);
  assert(draftRes.status === 200, `Draft save succeeds after fixing`);

  // Publish again - should succeed now
  const { res: pubRes, data: pubData } = await publishTemplate(tmpl.id);
  assert(pubRes.status === 200 || pubRes.status === 201, `Publish succeeds after fix (${pubRes.status})`);
  assert(pubData.status === 'published', `Template is now published`);
  assert(pubData.version >= 1, `Template has version number`);
  return tmpl.id;
}

async function test6_422ResponseFormat() {
  console.log('\n--- Test 6: 422 response has correct error envelope format ---');
  const { data: tmpl } = await createTemplate('Validation Test - Envelope Format', {
    pages: [{
      elements: [{
        name: 'bad',
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{}}'
      }]
    }]
  });

  const { res, data } = await publishTemplate(tmpl.id);
  assert(res.status === 422, `Returns 422`);
  assert(data.statusCode === 422, `Body has statusCode 422`);
  assert(data.error === 'Unprocessable Entity', `Body has error field "Unprocessable Entity"`);
  assert(typeof data.message === 'string', `Body has message string`);
  assert(Array.isArray(data.details), `Body has details array`);

  // Each detail should have field and message
  if (data.details && data.details.length > 0) {
    const firstDetail = data.details[0];
    assert(typeof firstDetail.field === 'string', `Detail has field property`);
    assert(typeof firstDetail.message === 'string', `Detail has message property`);
  }
  return tmpl.id;
}

async function cleanup() {
  console.log('\n--- Cleanup ---');
  for (const id of templateIds) {
    try {
      await fetch(`${BASE}/templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
  }
  console.log(`  Cleaned up ${templateIds.length} templates`);
}

async function main() {
  console.log('=== Feature #108: Template validation runs at publish time ===');

  try {
    await test1_invalidEmptyBinding();
    await test2_invalidBindingSyntax();
    await test3_noElements();
    await test4_invalidExpression();
    await test5_fixAndPublish();
    await test6_422ResponseFormat();
  } catch (err) {
    console.error('\n💥 Fatal error:', err.message);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
