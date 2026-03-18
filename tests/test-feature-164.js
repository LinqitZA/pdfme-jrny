/**
 * Test Feature #164: Render retry logic with exponential backoff
 * - File storage retries 3x with backoff on transient failures
 */
const http = require('http');

const BASE = 'http://localhost:3000';
const AUTH_HEADER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSIsIm9yZ0lkIjoib3JnMSIsInJvbGVzIjpbInRlbXBsYXRlOmVkaXQiLCJ0ZW1wbGF0ZTpwdWJsaXNoIiwicmVuZGVyOnRyaWdnZXIiXSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjk5OTk5OTk5OTl9.2ZGHiSlXXmMzlGjmwUbN5bN3vZTlVmKZm9lEkQ_YNHY';

let passed = 0;
let failed = 0;
let templateId = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTH_HEADER,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

async function setup() {
  // Create template
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Retry-Test-Template',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{ name: 'company', type: 'text', position: { x: 20, y: 30 }, width: 100, height: 10 }]],
      columns: ['company'],
    },
  });
  templateId = res.body.id;
  console.log(`  Template: ${templateId}`);

  // Set fast retry for testing (10ms base delay)
  await request('POST', '/api/pdfme/render/retry-config', { baseDelayMs: 10, maxDelayMs: 100 });
}

async function test1_getDefaultRetryConfig() {
  console.log('\nTest 1: Get retry config');
  // Reset to defaults first
  await request('POST', '/api/pdfme/render/retry-config', { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
  const res = await request('GET', '/api/pdfme/render/retry-config');
  assert('Returns config object', !!res.body.config);
  assert('maxRetries is 3', res.body.config.maxRetries === 3);
  assert('baseDelayMs is 10', res.body.config.baseDelayMs === 10);
}

async function test2_renderSucceedsNoFailures() {
  console.log('\nTest 2: Render succeeds with no failures (baseline)');
  // Ensure no simulated failures
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 0 });

  // Publish template first
  await request('POST', `/api/pdfme/templates/${templateId}/publish`);

  const res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'retry-test-1',
    channel: 'email',
    inputs: [{ company: 'TestCorp' }],
  });
  assert('Render succeeds', res.status === 200 || res.status === 201);
  assert('Document returned', !!res.body.document);
  assert('Document status is done', res.body.document?.status === 'done');

  // Check retry attempts
  const configRes = await request('GET', '/api/pdfme/render/retry-config');
  assert('Zero retries needed', configRes.body.lastRetryAttempts === 0);
}

async function test3_retryAfterOneFailure() {
  console.log('\nTest 3: Retry succeeds after 1 transient failure');
  // Simulate 1 failure (write will fail once, then succeed)
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 1 });

  const res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'retry-test-2',
    channel: 'email',
    inputs: [{ company: 'RetryOnce Corp' }],
  });
  assert('Render succeeds after 1 retry', res.status === 200 || res.status === 201);
  assert('Document is done', res.body.document?.status === 'done');

  const configRes = await request('GET', '/api/pdfme/render/retry-config');
  assert('1 retry attempt recorded', configRes.body.lastRetryAttempts === 1);
}

async function test4_retryAfterTwoFailures() {
  console.log('\nTest 4: Retry succeeds after 2 transient failures');
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 2 });

  const res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'retry-test-3',
    channel: 'email',
    inputs: [{ company: 'RetryTwice Corp' }],
  });
  assert('Render succeeds after 2 retries', res.status === 200 || res.status === 201);
  assert('Document is done', res.body.document?.status === 'done');

  const configRes = await request('GET', '/api/pdfme/render/retry-config');
  assert('2 retry attempts recorded', configRes.body.lastRetryAttempts === 2);
}

async function test5_retryAfterThreeFailures() {
  console.log('\nTest 5: Retry succeeds after 3 transient failures (max retries)');
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 3 });

  const res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'retry-test-4',
    channel: 'email',
    inputs: [{ company: 'RetryThrice Corp' }],
  });
  assert('Render succeeds after 3 retries', res.status === 200 || res.status === 201);
  assert('Document is done', res.body.document?.status === 'done');

  const configRes = await request('GET', '/api/pdfme/render/retry-config');
  assert('3 retry attempts recorded', configRes.body.lastRetryAttempts === 3);
}

async function test6_failAfterExceedingMaxRetries() {
  console.log('\nTest 6: Fails after exceeding max retries (4 failures > 3 retries)');
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 4 });

  const res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'retry-test-5',
    channel: 'email',
    inputs: [{ company: 'TooManyFailures Corp' }],
  });
  // Should fail with 500 since storage is exhausted
  assert('Render fails with 500', res.status === 500);

  // Clear any remaining failures
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 0 });
}

async function test7_configureRetrySettings() {
  console.log('\nTest 7: Configure retry settings via API');
  const res = await request('POST', '/api/pdfme/render/retry-config', {
    maxRetries: 5,
    baseDelayMs: 50,
    maxDelayMs: 1000,
  });
  assert('Config updated', !!res.body.config);
  assert('maxRetries set to 5', res.body.config.maxRetries === 5);
  assert('baseDelayMs set to 50', res.body.config.baseDelayMs === 50);
  assert('maxDelayMs set to 1000', res.body.config.maxDelayMs === 1000);

  // Reset back
  await request('POST', '/api/pdfme/render/retry-config', { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
}

async function test8_simulateStorageFailureEndpoint() {
  console.log('\nTest 8: Simulate storage failure endpoint');
  const res = await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 2 });
  assert('Returns simulated failure count', res.body.simulatedFailures === 2);
  assert('Returns descriptive message', !!res.body.message);

  // Clear
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 0 });
}

async function main() {
  console.log('=== Feature #164: Render retry logic with exponential backoff ===\n');

  await setup();

  await test1_getDefaultRetryConfig();
  await test2_renderSucceedsNoFailures();
  await test3_retryAfterOneFailure();
  await test4_retryAfterTwoFailures();
  await test5_retryAfterThreeFailures();
  await test6_failAfterExceedingMaxRetries();
  await test7_configureRetrySettings();
  await test8_simulateStorageFailureEndpoint();

  // Cleanup
  await request('POST', '/api/pdfme/render/simulate-storage-failure', { failureCount: 0 });
  await request('POST', '/api/pdfme/render/retry-config', { maxRetries: 3, baseDelayMs: 200, maxDelayMs: 5000 });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
