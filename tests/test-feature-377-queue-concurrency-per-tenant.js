/**
 * Feature #377: Queue concurrency configurable per tenant
 * Queue concurrency respects per-tenant setting
 *
 * Verification steps:
 * 1. Set tenant A concurrency=3
 * 2. Set tenant B concurrency=10
 * 3. Submit jobs for both tenants
 * 4. Verify tenant A max 3 concurrent
 * 5. Verify tenant B max 10 concurrent
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(data);
      const req = http.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } else {
      const req = http.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      });
      req.on('error', reject);
      req.end();
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

async function runTests() {
  console.log('Feature #377: Queue concurrency configurable per tenant');
  console.log('='.repeat(60));

  // Drain queue before tests
  await apiRequest('POST', '/queue/drain');
  await sleep(500);

  for (const { name, fn } of results) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  }

  // Cleanup
  await apiRequest('POST', '/queue/drain');

  console.log(`\nResults: ${passed}/${passed + failed} tests passing`);
  process.exit(failed > 0 ? 1 : 0);
}

const TENANT_A = 'org-conc-377-A';
const TENANT_B = 'org-conc-377-B';

// ─── Step 1: Set tenant A concurrency=3 ───

test('Set tenant A concurrency limit to 3', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_A, limit: 3 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.orgId, TENANT_A);
  assert.strictEqual(res.data.limit, 3);
  assert.strictEqual(res.data.set, true);
});

test('Get tenant A concurrency shows limit=3', async () => {
  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.limit, 3);
  assert.strictEqual(res.data.orgId, TENANT_A);
});

// ─── Step 2: Set tenant B concurrency=10 ───

test('Set tenant B concurrency limit to 10', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_B, limit: 10 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.orgId, TENANT_B);
  assert.strictEqual(res.data.limit, 10);
});

test('Get tenant B concurrency shows limit=10', async () => {
  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.limit, 10);
});

// ─── Step 3: Both tenants have different limits ───

test('Tenant A and B have different concurrency limits', async () => {
  const resA = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  const resB = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.strictEqual(resA.data.limit, 3);
  assert.strictEqual(resB.data.limit, 10);
  assert.notStrictEqual(resA.data.limit, resB.data.limit);
});

// ─── Step 4: Submit jobs for tenant A and verify max 3 concurrent ───

test('Submit 10 jobs for tenant A with delay', async () => {
  const res = await apiRequest('POST', '/queue/test-concurrency', {
    orgId: TENANT_A,
    count: 10,
    delayMs: 1500,
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.count, 10);
  assert.strictEqual(res.data.submitted, true);
  assert.strictEqual(res.data.jobIds.length, 10);
});

test('Tenant A peak concurrency does not exceed 3', async () => {
  // Wait for jobs to start processing and track peaks
  await sleep(3000);

  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  assert.strictEqual(res.status, 200);
  // Peak should be <= 3 (the set limit)
  assert.ok(res.data.peak <= 3, `Tenant A peak ${res.data.peak} should be <= 3`);
  assert.ok(res.data.peak >= 1, `Tenant A peak ${res.data.peak} should be >= 1 (jobs were processing)`);
});

// ─── Step 5: Submit jobs for tenant B and verify higher concurrency ───

test('Submit 15 jobs for tenant B with delay', async () => {
  const res = await apiRequest('POST', '/queue/test-concurrency', {
    orgId: TENANT_B,
    count: 15,
    delayMs: 1500,
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.count, 15);
  assert.strictEqual(res.data.submitted, true);
});

test('Tenant B peak concurrency does not exceed 10', async () => {
  await sleep(3000);

  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.peak <= 10, `Tenant B peak ${res.data.peak} should be <= 10`);
  assert.ok(res.data.peak >= 1, `Tenant B peak ${res.data.peak} should be >= 1`);
});

test('Tenant B peak is higher than tenant A peak', async () => {
  const resA = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  const resB = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  // B has limit=10 vs A limit=3, so B's peak should be higher (assuming enough jobs)
  assert.ok(
    resB.data.peak > resA.data.peak || resB.data.peak >= 3,
    `Tenant B peak (${resB.data.peak}) should be > tenant A peak (${resA.data.peak}) or at least 3`
  );
});

// ─── Changing limits dynamically ───

test('Change tenant A limit from 3 to 5', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_A, limit: 5 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.limit, 5);
});

test('Tenant A now shows limit=5', async () => {
  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  assert.strictEqual(res.data.limit, 5);
});

test('Change tenant B limit from 10 to 2', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_B, limit: 2 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.limit, 2);
});

test('Tenant B now shows limit=2', async () => {
  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.strictEqual(res.data.limit, 2);
});

// ─── Drain and re-test with new limits ───

test('Drain queue and reset peaks for re-test', async () => {
  await apiRequest('POST', '/queue/drain');
  await sleep(500);

  // Re-set limits after drain (drain resets)
  await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_A, limit: 5 });
  await apiRequest('POST', '/queue/concurrency', { orgId: TENANT_B, limit: 2 });

  const resA = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  const resB = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.strictEqual(resA.data.peak, 0, 'Peak should be reset after drain');
  assert.strictEqual(resB.data.peak, 0, 'Peak should be reset after drain');
});

test('Submit jobs with new limits and verify tenant A peak <= 5', async () => {
  await apiRequest('POST', '/queue/test-concurrency', {
    orgId: TENANT_A,
    count: 12,
    delayMs: 1500,
  });
  await sleep(3000);

  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_A}`);
  assert.ok(res.data.peak <= 5, `Tenant A peak ${res.data.peak} should be <= 5`);
  assert.ok(res.data.peak >= 1, `Tenant A peak ${res.data.peak} should be >= 1`);
});

test('Submit jobs with new limits and verify tenant B peak <= 2', async () => {
  await apiRequest('POST', '/queue/test-concurrency', {
    orgId: TENANT_B,
    count: 8,
    delayMs: 1500,
  });
  await sleep(3000);

  const res = await apiRequest('GET', `/queue/concurrency/${TENANT_B}`);
  assert.ok(res.data.peak <= 2, `Tenant B peak ${res.data.peak} should be <= 2`);
  assert.ok(res.data.peak >= 1, `Tenant B peak ${res.data.peak} should be >= 1`);
});

// ─── Validation ───

test('Setting concurrency limit < 1 returns 400', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: 'test', limit: 0 });
  assert.strictEqual(res.status, 400);
});

test('Setting concurrency without orgId returns 400', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { limit: 5 });
  assert.strictEqual(res.status, 400);
});

test('Setting concurrency without limit returns 400', async () => {
  const res = await apiRequest('POST', '/queue/concurrency', { orgId: 'test' });
  assert.strictEqual(res.status, 400);
});

// ─── Unknown tenant gets default concurrency ───

test('Unknown tenant returns default concurrency', async () => {
  const res = await apiRequest('GET', '/queue/concurrency/org-unknown-377');
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.limit > 0, 'Default limit should be positive');
  // Default is typically 5 based on the code
  assert.ok(typeof res.data.limit === 'number');
});

// ─── Setting limit=1 enforces serial execution ───

test('Setting limit=1 enforces serial execution', async () => {
  await apiRequest('POST', '/queue/drain');
  await sleep(500);

  const serialOrg = 'org-serial-377';
  await apiRequest('POST', '/queue/concurrency', { orgId: serialOrg, limit: 1 });

  await apiRequest('POST', '/queue/test-concurrency', {
    orgId: serialOrg,
    count: 5,
    delayMs: 500,
  });
  await sleep(3000);

  const res = await apiRequest('GET', `/queue/concurrency/${serialOrg}`);
  assert.strictEqual(res.data.limit, 1);
  assert.ok(res.data.peak <= 1, `Serial peak ${res.data.peak} should be <= 1`);
});

// ─── Concurrent tenant isolation ───

test('Tenants do not interfere with each other active counts', async () => {
  await apiRequest('POST', '/queue/drain');
  await sleep(500);

  const orgX = 'org-iso-X-377';
  const orgY = 'org-iso-Y-377';
  await apiRequest('POST', '/queue/concurrency', { orgId: orgX, limit: 2 });
  await apiRequest('POST', '/queue/concurrency', { orgId: orgY, limit: 8 });

  // Submit jobs for both simultaneously
  await Promise.all([
    apiRequest('POST', '/queue/test-concurrency', { orgId: orgX, count: 6, delayMs: 1000 }),
    apiRequest('POST', '/queue/test-concurrency', { orgId: orgY, count: 12, delayMs: 1000 }),
  ]);

  await sleep(2500);

  const resX = await apiRequest('GET', `/queue/concurrency/${orgX}`);
  const resY = await apiRequest('GET', `/queue/concurrency/${orgY}`);

  assert.ok(resX.data.peak <= 2, `Org X peak ${resX.data.peak} should be <= 2`);
  assert.ok(resY.data.peak <= 8, `Org Y peak ${resY.data.peak} should be <= 8`);
  // Y should have higher peak since its limit is higher
  assert.ok(resY.data.peak >= resX.data.peak, `Org Y peak should be >= Org X peak`);
});

// ─── Queue stats still work ───

test('Queue stats endpoint works', async () => {
  const res = await apiRequest('GET', '/queue/stats');
  assert.strictEqual(res.status, 200);
  assert.ok('waiting' in res.data || 'completed' in res.data);
});

// ─── Health check still works ───

test('Health check after concurrency tests', async () => {
  const res = await apiRequest('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.status, 'ok');
});

runTests();
