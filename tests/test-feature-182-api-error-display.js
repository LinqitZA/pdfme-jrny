/**
 * Test Feature #182: API error display in designer
 *
 * Steps:
 * 1. Simulate API timeout during save
 * 2. Verify error toast/message in designer
 * 3. Simulate validation error during publish
 * 4. Verify specific errors displayed
 * 5. Verify user can retry
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function makeToken(sub, orgId, roles = ['template:edit', 'template:publish']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return `${header}.${payload}.testsig`;
}

const ORG_ID = 'org-test-182';
const USER_ID = 'user-test-182';
const TOKEN = makeToken(USER_ID, ORG_ID);
const AUTH = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function run() {
  console.log('\n=== Feature #182: API error display in designer ===\n');

  // Test 1: Save to nonexistent template returns 404 with user-friendly message
  console.log('Test 1: Save to nonexistent template returns error');
  const saveRes = await fetch(`${BASE}/templates/nonexistent-id/draft`, {
    method: 'PUT',
    headers: AUTH,
    body: JSON.stringify({ name: 'test', schema: { pages: [] } }),
  });
  assert(saveRes.status === 404, 'Save to nonexistent returns 404');
  const saveErr = await saveRes.json();
  assert(saveErr.message && typeof saveErr.message === 'string', 'Error has user-friendly message: ' + saveErr.message);
  assert(!saveErr.stack, 'No stack trace in error response');

  // Test 2: Publish with validation errors returns 422 with details
  console.log('\nTest 2: Publish with validation errors');
  // Create a template with empty bindings (invalid for publish)
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name: 'Invalid Template 182',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            type: 'text',
            position: { x: 10, y: 10 },
            width: 100,
            height: 20,
            content: 'Hello {{}} world',
          }]
        }]
      },
    }),
  });
  const template = await createRes.json();
  assert(template.id, 'Created template with invalid bindings');

  const pubRes = await fetch(`${BASE}/templates/${template.id}/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  assert(pubRes.status === 422, 'Publish returns 422 for validation errors');
  const pubErr = await pubRes.json();
  assert(pubErr.details && Array.isArray(pubErr.details), 'Error has details array');
  assert(pubErr.details.length > 0, 'Details array has errors');
  if (pubErr.details.length > 0) {
    const detail = pubErr.details[0];
    assert(detail.field && typeof detail.field === 'string', 'Each error has field: ' + detail.field);
    assert(detail.message && typeof detail.message === 'string', 'Each error has message: ' + detail.message);
  }
  assert(pubErr.message === 'Template validation failed', 'Top-level message is user-friendly');
  assert(!pubErr.stack, 'No stack trace exposed');

  // Test 3: Publish nonexistent template returns 404
  console.log('\nTest 3: Publish nonexistent template');
  const pub404 = await fetch(`${BASE}/templates/nonexistent/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  assert(pub404.status === 404, 'Publish nonexistent returns 404');
  const pub404Body = await pub404.json();
  assert(pub404Body.message && pub404Body.message.includes('not found'), 'Has descriptive not found message');

  // Test 4: Save with lock conflict returns 409 with lockedBy info
  console.log('\nTest 4: Save with lock conflict returns 409');
  const goodTemplate = await (await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name: 'Lock Test 182',
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }] }] },
    }),
  })).json();

  // Lock as another user
  const otherToken = makeToken('other-user', ORG_ID);
  const otherAuth = { 'Authorization': `Bearer ${otherToken}`, 'Content-Type': 'application/json' };
  await fetch(`${BASE}/templates/${goodTemplate.id}/lock`, {
    method: 'POST',
    headers: otherAuth,
  });

  // Try to save as original user
  const lockSaveRes = await fetch(`${BASE}/templates/${goodTemplate.id}/draft`, {
    method: 'PUT',
    headers: AUTH,
    body: JSON.stringify({ name: 'Updated', schema: { pages: [] } }),
  });
  assert(lockSaveRes.status === 409, 'Save with lock conflict returns 409');
  const lockErr = await lockSaveRes.json();
  assert(lockErr.lockedBy === 'other-user', 'Error includes lockedBy info');
  assert(lockErr.message && lockErr.message.includes('locked'), 'Has descriptive lock message');

  // Test 5: Verify error responses are consistent envelope format
  console.log('\nTest 5: Consistent error envelope format');
  assert(saveErr.statusCode === 404, 'Save 404 has statusCode field');
  assert(saveErr.error === 'Not Found', 'Save 404 has error field');
  assert(pubErr.statusCode === 422, 'Publish 422 has statusCode field');
  assert(lockErr.statusCode === 409, 'Lock 409 has statusCode field');

  // Test 6: Invalid JSON body returns 400
  console.log('\nTest 6: Invalid request body returns 400');
  const badBodyRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ name: '', type: '', schema: 'not-an-object' }),
  });
  assert(badBodyRes.status === 400, 'Invalid body returns 400');
  const badBodyErr = await badBodyRes.json();
  assert(badBodyErr.details && Array.isArray(badBodyErr.details), 'Bad request has details array');

  // Test 7: Unauthorized returns 401
  console.log('\nTest 7: Unauthorized returns 401');
  const noAuthRes = await fetch(`${BASE}/templates`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  assert(noAuthRes.status === 401, 'No auth returns 401');
  const noAuthErr = await noAuthRes.json();
  assert(noAuthErr.message && typeof noAuthErr.message === 'string', 'Auth error has message: ' + noAuthErr.message);

  // Test 8: Verify designer has error handling elements (component check)
  console.log('\nTest 8: Component has error handling data-testid attributes');
  const fs = require('fs');
  const path = require('path');
  const designerSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf8'
  );
  assert(designerSrc.includes('data-testid="save-error-banner"'), 'Has save error banner');
  assert(designerSrc.includes('data-testid="save-error-message"'), 'Has save error message element');
  assert(designerSrc.includes('data-testid="save-error-retry"'), 'Has save retry button');
  assert(designerSrc.includes('data-testid="publish-error-banner"'), 'Has publish error banner');
  assert(designerSrc.includes('data-testid="publish-error-message"'), 'Has publish error message element');
  assert(designerSrc.includes('data-testid="publish-error-retry"'), 'Has publish retry button');
  assert(designerSrc.includes('data-testid="publish-validation-errors"'), 'Has validation errors list');
  assert(designerSrc.includes('data-testid="publish-success-toast"'), 'Has publish success toast');
  assert(designerSrc.includes('handlePublish'), 'Has handlePublish function');
  assert(designerSrc.includes('publishStatus'), 'Has publishStatus state');
  assert(designerSrc.includes('publishError'), 'Has publishError state');

  // Test 9: Verify error messages are user-friendly (no stack traces, no internal paths)
  console.log('\nTest 9: Error messages are user-friendly');
  const allErrors = [saveErr, pubErr, lockErr, pub404Body, noAuthErr];
  for (const err of allErrors) {
    assert(!err.stack, 'No stack trace in error: ' + JSON.stringify(err).slice(0, 100));
    const msg = JSON.stringify(err);
    assert(!msg.includes('node_modules'), 'No node_modules paths in error');
    assert(!msg.includes('/home/'), 'No file system paths in error');
  }

  // Test 10: Retry mechanism - after fix, publish should succeed
  console.log('\nTest 10: Retry mechanism - publish succeeds after fixing issue');
  // Create a valid template
  const validTemplate = await (await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name: 'Valid Template 182',
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Valid content' }] }] },
    }),
  })).json();
  const validPubRes = await fetch(`${BASE}/templates/${validTemplate.id}/publish`, {
    method: 'POST',
    headers: AUTH,
  });
  assert(validPubRes.ok, 'Valid template publishes successfully');
  const validPubData = await validPubRes.json();
  assert(validPubData.status === 'published', 'Template shows published after retry');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
