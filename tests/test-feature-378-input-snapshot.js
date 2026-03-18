/**
 * Feature #378: InputSnapshot stored on GeneratedDocument
 * Optional input snapshot for audit reproduction
 *
 * Steps:
 * 1. Configure inputSnapshot=true
 * 2. Render document
 * 3. Query GeneratedDocument
 * 4. Verify inputSnapshot JSON populated
 * 5. Verify contains all input data for reproduction
 */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function generateToken(orgId = 'org-snapshot-378', userId = 'user-378') {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {},
    };

    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
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

let passed = 0;
let failed = 0;
const results = [];
let templateId = null;
let docIdWithSnapshot = null;
let docIdWithoutSnapshot = null;

function test(name, fn) {
  results.push({ name, fn });
}

async function runTests() {
  const token = generateToken();

  console.log('Feature #378: InputSnapshot stored on GeneratedDocument');
  console.log('='.repeat(60));

  for (const { name, fn } of results) {
    try {
      await fn(token);
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  }

  console.log(`\nResults: ${passed}/${passed + failed} tests passing`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Setup: create and publish a template ───

test('Create template for snapshot testing', async (token) => {
  const res = await apiRequest('POST', '/templates', {
    name: 'Snapshot Test Invoice 378',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'companyName', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'Company Name' },
          { name: 'totalAmount', type: 'text', position: { x: 20, y: 40 }, width: 80, height: 10, content: 'Total Amount' },
          { name: 'invoiceDate', type: 'text', position: { x: 20, y: 60 }, width: 80, height: 10, content: 'Invoice Date' },
        ],
      }],
    },
  }, token);
  assert.strictEqual(res.status, 201);
  templateId = res.data.id;
  assert.ok(templateId);
});

test('Publish template', async (token) => {
  const res = await apiRequest('POST', `/templates/${templateId}/publish`, {}, token);
  assert.ok(res.status === 200 || res.status === 201, `Publish failed: ${res.status} ${JSON.stringify(res.data).substring(0, 200)}`);
});

// ─── Step 1 & 2: Render with storeInputSnapshot=true ───

test('Render document with storeInputSnapshot=true', async (token) => {
  const res = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-SNAP-001',
    entityType: 'invoice',
    channel: 'email',
    storeInputSnapshot: true,
    inputs: [{ 'company.name': 'Acme Corp', 'invoice.total': '1500.00', 'invoice.date': '2026-03-18' }],
  }, token);

  assert.ok(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
  assert.ok(res.data.document || res.data.id, 'Should return document');
  docIdWithSnapshot = res.data.document?.id || res.data.id;
  assert.ok(docIdWithSnapshot, 'Should have document ID');
});

// ─── Step 3: Query GeneratedDocument snapshot ───

test('Query document snapshot endpoint returns snapshot data', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.documentId, docIdWithSnapshot);
  assert.strictEqual(res.data.hasSnapshot, true);
  assert.ok(res.data.inputSnapshot, 'inputSnapshot should be populated');
});

// ─── Step 4: Verify inputSnapshot JSON populated ───

test('InputSnapshot contains the input data as JSON array', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  const snapshot = res.data.inputSnapshot;
  assert.ok(Array.isArray(snapshot), 'Snapshot should be an array');
  assert.ok(snapshot.length >= 1, 'Should have at least one input record');
});

// ─── Step 5: Verify contains all input data for reproduction ───

test('InputSnapshot contains company.name field', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  const snapshot = res.data.inputSnapshot;
  assert.strictEqual(snapshot[0]['company.name'], 'Acme Corp');
});

test('InputSnapshot contains invoice.total field', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  const snapshot = res.data.inputSnapshot;
  assert.strictEqual(snapshot[0]['invoice.total'], '1500.00');
});

test('InputSnapshot contains invoice.date field', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  const snapshot = res.data.inputSnapshot;
  assert.strictEqual(snapshot[0]['invoice.date'], '2026-03-18');
});

// ─── Render WITHOUT storeInputSnapshot (default) ───

test('Render document without storeInputSnapshot (default=false)', async (token) => {
  const res = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-NOSNAP-002',
    entityType: 'invoice',
    channel: 'print',
    inputs: [{ 'company.name': 'Other Corp', 'invoice.total': '999.99' }],
  }, token);

  assert.ok(res.status === 200 || res.status === 201);
  docIdWithoutSnapshot = res.data.document?.id || res.data.id;
  assert.ok(docIdWithoutSnapshot);
});

test('Document without snapshot has hasSnapshot=false', async (token) => {
  const res = await apiRequest('GET', `/render/document/${docIdWithoutSnapshot}/snapshot`, null, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.hasSnapshot, false);
  assert.strictEqual(res.data.inputSnapshot, null);
});

// ─── Render with storeInputSnapshot=false explicitly ───

test('Render with storeInputSnapshot=false stores no snapshot', async (token) => {
  const res = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-NOSNAP-003',
    entityType: 'invoice',
    channel: 'email',
    storeInputSnapshot: false,
    inputs: [{ 'company.name': 'Explicit False Corp' }],
  }, token);

  assert.ok(res.status === 200 || res.status === 201);
  const docId = res.data.document?.id || res.data.id;
  assert.ok(docId);

  const snapRes = await apiRequest('GET', `/render/document/${docId}/snapshot`, null, token);
  assert.strictEqual(snapRes.data.hasSnapshot, false);
  assert.strictEqual(snapRes.data.inputSnapshot, null);
});

// ─── Document list includes hasInputSnapshot flag ───

test('Document history includes hasInputSnapshot for each document', async (token) => {
  const res = await apiRequest('GET', `/render/documents/${templateId}`, null, token);
  assert.strictEqual(res.status, 200);
  const docs = res.data.data || res.data;
  assert.ok(Array.isArray(docs), 'Should return array of documents');
  assert.ok(docs.length >= 2, 'Should have at least 2 rendered docs');

  // Find doc with snapshot
  const withSnap = docs.find((d) => d.id === docIdWithSnapshot);
  assert.ok(withSnap, 'Should find document with snapshot');
  assert.strictEqual(withSnap.hasInputSnapshot, true);

  // Find doc without snapshot
  const withoutSnap = docs.find((d) => d.id === docIdWithoutSnapshot);
  assert.ok(withoutSnap, 'Should find document without snapshot');
  assert.strictEqual(withoutSnap.hasInputSnapshot, false);
});

// ─── Snapshot with complex input data ───

test('Snapshot stores complex multi-field input data', async (token) => {
  const complexInputs = [{
    'company.name': 'Complex Corp Ltd',
    'company.address': '123 Main St, Suite 456',
    'company.phone': '+1-555-0123',
    'invoice.number': 'INV-2026-0042',
    'invoice.date': '2026-03-18',
    'invoice.dueDate': '2026-04-18',
    'invoice.total': '25750.50',
    'invoice.currency': 'USD',
    'customer.name': 'Jane Smith',
    'customer.email': 'jane@example.com',
  }];

  const res = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-COMPLEX-004',
    entityType: 'invoice',
    channel: 'email',
    storeInputSnapshot: true,
    inputs: complexInputs,
  }, token);

  assert.ok(res.status === 200 || res.status === 201);
  const docId = res.data.document?.id || res.data.id;

  const snapRes = await apiRequest('GET', `/render/document/${docId}/snapshot`, null, token);
  assert.strictEqual(snapRes.data.hasSnapshot, true);
  const snapshot = snapRes.data.inputSnapshot;
  assert.ok(Array.isArray(snapshot));
  assert.strictEqual(snapshot[0]['company.name'], 'Complex Corp Ltd');
  assert.strictEqual(snapshot[0]['company.address'], '123 Main St, Suite 456');
  assert.strictEqual(snapshot[0]['invoice.total'], '25750.50');
  assert.strictEqual(snapshot[0]['customer.email'], 'jane@example.com');
});

// ─── Snapshot preserves special characters ───

test('Snapshot preserves special characters in input values', async (token) => {
  const specialInputs = [{
    'company.name': 'Smith & Jones <Pty> "Ltd"',
    'notes': "Line 1\nLine 2\tTabbed",
    'currency.symbol': '€',
  }];

  const res = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-SPECIAL-005',
    entityType: 'invoice',
    channel: 'print',
    storeInputSnapshot: true,
    inputs: specialInputs,
  }, token);

  assert.ok(res.status === 200 || res.status === 201);
  const docId = res.data.document?.id || res.data.id;

  const snapRes = await apiRequest('GET', `/render/document/${docId}/snapshot`, null, token);
  const snapshot = snapRes.data.inputSnapshot;
  assert.strictEqual(snapshot[0]['company.name'], 'Smith & Jones <Pty> "Ltd"');
  assert.strictEqual(snapshot[0]['currency.symbol'], '€');
});

// ─── Snapshot endpoint for non-existent document ───

test('Snapshot endpoint returns 404 for non-existent document', async (token) => {
  const res = await apiRequest('GET', '/render/document/non-existent-doc-id/snapshot', null, token);
  assert.strictEqual(res.status, 404);
});

// ─── Snapshot endpoint requires auth ───

test('Snapshot endpoint requires authorization', async () => {
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`);
  assert.ok(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
});

// ─── Tenant isolation ───

test('Snapshot from different org returns 404', async () => {
  const otherToken = generateToken('org-other-378', 'user-other');
  const res = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, otherToken);
  assert.strictEqual(res.status, 404);
});

// ─── Multiple renders, each can independently have snapshot ───

test('Multiple renders independently store/skip snapshots', async (token) => {
  // Render 1: with snapshot
  const r1 = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-MULTI-A',
    entityType: 'invoice',
    channel: 'email',
    storeInputSnapshot: true,
    inputs: [{ 'company.name': 'Multi A' }],
  }, token);
  const id1 = r1.data.document?.id || r1.data.id;

  // Render 2: without snapshot
  const r2 = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-MULTI-B',
    entityType: 'invoice',
    channel: 'print',
    storeInputSnapshot: false,
    inputs: [{ 'company.name': 'Multi B' }],
  }, token);
  const id2 = r2.data.document?.id || r2.data.id;

  // Render 3: with snapshot
  const r3 = await apiRequest('POST', '/render/now', {
    templateId,
    entityId: 'INV-MULTI-C',
    entityType: 'invoice',
    channel: 'email',
    storeInputSnapshot: true,
    inputs: [{ 'company.name': 'Multi C' }],
  }, token);
  const id3 = r3.data.document?.id || r3.data.id;

  const s1 = await apiRequest('GET', `/render/document/${id1}/snapshot`, null, token);
  const s2 = await apiRequest('GET', `/render/document/${id2}/snapshot`, null, token);
  const s3 = await apiRequest('GET', `/render/document/${id3}/snapshot`, null, token);

  assert.strictEqual(s1.data.hasSnapshot, true);
  assert.strictEqual(s1.data.inputSnapshot[0]['company.name'], 'Multi A');

  assert.strictEqual(s2.data.hasSnapshot, false);
  assert.strictEqual(s2.data.inputSnapshot, null);

  assert.strictEqual(s3.data.hasSnapshot, true);
  assert.strictEqual(s3.data.inputSnapshot[0]['company.name'], 'Multi C');
});

// ─── Snapshot data persists (survives re-query) ───

test('Snapshot data persists across multiple queries', async (token) => {
  const res1 = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);
  const res2 = await apiRequest('GET', `/render/document/${docIdWithSnapshot}/snapshot`, null, token);

  assert.deepStrictEqual(res1.data.inputSnapshot, res2.data.inputSnapshot);
  assert.strictEqual(res1.data.inputSnapshot[0]['company.name'], 'Acme Corp');
});

// ─── Health check ───

test('Health check still works', async () => {
  const res = await apiRequest('GET', '/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.status, 'ok');
});

runTests();
