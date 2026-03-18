/**
 * Tests for Feature #168: User-friendly error messages, not stack traces
 *
 * Verifies:
 * 1. Trigger various errors
 * 2. Verify no stack traces in response body
 * 3. Verify no internal file paths exposed
 * 4. Verify messages are actionable
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const AUTH = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdJZCI6Im9yZy0xIiwicm9sZXMiOlsiYWRtaW4iXSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9.FqVQ5e2jMECKPYMWmI5TSxOYdOH46sswNQLMqlZeHaU';

async function getErr(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, data: await res.json(), raw: await Promise.resolve('') };
}

async function getErrAuth(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: AUTH } });
  return { status: res.status, data: await res.json() };
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL ${msg}`);
    failed++;
  }
}

function assertNoInternalInfo(responseData, label) {
  const json = JSON.stringify(responseData);

  // No stack traces
  assert(!json.includes('at ') || !json.match(/at\s+\S+\s+\(/), `${label}: No stack trace frames`);
  assert(!json.includes('.ts:'), `${label}: No .ts file references`);
  assert(!json.includes('.js:') || !json.match(/\.js:\d+:\d+/), `${label}: No .js source refs`);

  // No internal paths
  assert(!json.includes('/home/'), `${label}: No /home/ paths`);
  assert(!json.includes('node_modules/'), `${label}: No node_modules paths`);
  assert(!json.includes('/usr/'), `${label}: No /usr/ system paths`);
  assert(!json.includes('nest-module/src/'), `${label}: No project source paths`);

  // No stack field
  assert(!responseData.stack, `${label}: No 'stack' property`);
  assert(!responseData.trace, `${label}: No 'trace' property`);

  // Has required structure
  assert(typeof responseData.statusCode === 'number', `${label}: Has statusCode`);
  assert(typeof responseData.message === 'string', `${label}: Has message string`);
  assert(responseData.message.length > 0, `${label}: Message is not empty`);
  assert(typeof responseData.timestamp === 'string', `${label}: Has timestamp`);
  assert(typeof responseData.path === 'string', `${label}: Has path`);
}

async function testUnhandledError() {
  console.log('\n--- Test: Unhandled error sanitization ---');
  const { status, data } = await getErr('/health/test-error?type=unhandled');

  assert(status === 500, 'Returns 500 status');
  assert(data.error === 'Internal Server Error', 'Error name is generic');
  assert(data.message === 'Something went wrong in the render pipeline', 'Message is the clean part only');
  assertNoInternalInfo(data, 'Unhandled');
}

async function testInternalPathError() {
  console.log('\n--- Test: Internal file path sanitization ---');
  const { status, data } = await getErr('/health/test-error?type=internal-path');

  assert(status === 500, 'Returns 500 status');
  assert(!data.message.includes('/home/'), 'No home directory path in message');
  assert(!data.message.includes('render.service.ts'), 'No TypeScript filename in message');
  assert(!data.message.includes(':142:15'), 'No line/column numbers in message');
  assertNoInternalInfo(data, 'InternalPath');
}

async function testStackTraceInMessage() {
  console.log('\n--- Test: Stack trace text in error message ---');
  const { status, data } = await getErr('/health/test-error?type=stack-in-message');

  assert(status === 500, 'Returns 500 status');
  assert(!data.message.includes('at RenderService'), 'No function location in message');
  assert(!data.message.includes('processTicksAndRejections'), 'No Node.js internals');
  assert(!data.message.includes('nest-module'), 'No project paths');
  assertNoInternalInfo(data, 'StackInMessage');
}

async function testDatabaseConnectionError() {
  console.log('\n--- Test: Database connection error ---');
  const { status, data } = await getErr('/health/test-error?type=db-error');

  assert(status === 500, 'Returns 500 status');
  assert(!data.message.includes('127.0.0.1'), 'No IP address exposed');
  assert(!data.message.includes('5432'), 'No port number exposed');
  assert(!data.message.includes('TCPConnectWrap'), 'No Node.js internal class names');
  assert(data.message.includes('try again'), 'Message suggests retry');
  assertNoInternalInfo(data, 'DbError');
}

async function testNodeModulesError() {
  console.log('\n--- Test: node_modules path sanitization ---');
  const { status, data } = await getErr('/health/test-error?type=node-modules');

  assert(status === 500, 'Returns 500 status');
  assert(!data.message.includes('node_modules'), 'No node_modules path');
  assert(!data.message.includes('@pdfme/generator'), 'No package name exposed');
  assertNoInternalInfo(data, 'NodeModules');
}

async function testDuplicateKeyError() {
  console.log('\n--- Test: Duplicate key error is user-friendly ---');
  const { status, data } = await getErr('/health/test-error?type=duplicate-key');

  assert(status === 500, 'Returns 500 status');
  assert(!data.message.includes('templates_pkey'), 'No constraint name exposed');
  assert(data.message.includes('already exists'), 'Message explains the issue');
  assertNoInternalInfo(data, 'DuplicateKey');
}

async function testHttpExceptionPreserved() {
  console.log('\n--- Test: HTTP exceptions preserve details ---');
  const { status, data } = await getErr('/health/test-error?type=http-400');

  assert(status === 400, 'Returns 400 status');
  assert(data.message === 'Template name is required', 'Message preserved');
  assert(data.details && data.details.length === 1, 'Details array preserved');
  assert(data.details[0].field === 'name', 'Field detail preserved');
  assertNoInternalInfo(data, 'Http400');
}

async function testExisting404Endpoint() {
  console.log('\n--- Test: Existing 404 responses still work ---');
  const { status, data } = await getErrAuth('/templates/nonexistent-id-test');

  assert(status === 404, 'Returns 404 status');
  assert(data.message.includes('not found'), 'Message says not found');
  assert(data.error === 'Not Found', 'Error name is correct');
  assertNoInternalInfo(data, 'Existing404');
}

async function testUnknownRoute() {
  console.log('\n--- Test: Unknown route 404 ---');
  const { status, data } = await getErr('/nonexistent-route-xyz');

  assert(status === 404, 'Returns 404 status');
  assert(data.statusCode === 404, 'Body statusCode is 404');
  assertNoInternalInfo(data, 'UnknownRoute');
}

async function testUnauthorized() {
  console.log('\n--- Test: Unauthorized 401 ---');
  const res = await fetch(`${BASE}/templates`);
  const data = await res.json();

  assert(res.status === 401, 'Returns 401 status');
  assert(data.message && typeof data.message === 'string', 'Has actionable message');
  assertNoInternalInfo(data, 'Unauthorized');
}

async function testAllResponsesHaveConsistentStructure() {
  console.log('\n--- Test: All error responses have consistent structure ---');

  const endpoints = [
    '/health/test-error?type=unhandled',
    '/health/test-error?type=internal-path',
    '/health/test-error?type=db-error',
    '/health/test-error?type=http-400',
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${BASE}${ep}`);
    const data = await res.json();

    assert(typeof data.statusCode === 'number', `${ep}: statusCode is number`);
    assert(typeof data.error === 'string', `${ep}: error is string`);
    assert(typeof data.message === 'string', `${ep}: message is string`);
    assert(typeof data.timestamp === 'string', `${ep}: timestamp is string`);
    assert(typeof data.path === 'string', `${ep}: path is string`);
  }
}

async function main() {
  console.log('=== Feature #168: User-friendly error messages, not stack traces ===');

  await testUnhandledError();
  await testInternalPathError();
  await testStackTraceInMessage();
  await testDatabaseConnectionError();
  await testNodeModulesError();
  await testDuplicateKeyError();
  await testHttpExceptionPreserved();
  await testExisting404Endpoint();
  await testUnknownRoute();
  await testUnauthorized();
  await testAllResponsesHaveConsistentStructure();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
