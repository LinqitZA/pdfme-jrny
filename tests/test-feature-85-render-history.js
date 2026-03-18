/**
 * Test Feature #85: Render history paginated documents
 * GET /api/pdfme/render/history lists generated documents with cursor pagination, scoped to org
 */

const http = require('http');
const jwt = require('jsonwebtoken');

const BASE = process.env.API_BASE || 'http://localhost:3000';
const SECRET = 'pdfme-dev-secret';

let passed = 0;
let failed = 0;

function makeToken(claims = {}) {
  return jwt.sign(
    {
      sub: claims.sub || 'user-hist-85',
      orgId: claims.orgId || 'org-hist-85',
      roles: claims.roles || [
        'template:read',
        'template:write',
        'template:publish',
        'document:read',
        'document:write',
        'render:trigger',
      ],
      ...claims,
    },
    SECRET,
    { expiresIn: '1h' },
  );
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    // console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${name}`);
  }
}

async function createTemplate(token, name) {
  const res = await request(
    'POST',
    '/api/pdfme/templates',
    {
      name,
      type: 'invoice',
      schema: {
        pages: [{ elements: [{ name: 'field1', type: 'text', position: { x: 0, y: 0 }, width: 100, height: 20 }] }],
        basePdf: { width: 595, height: 842, padding: [0, 0, 0, 0] },
      },
    },
    token,
  );
  return res.body;
}

async function renderDocument(token, templateId) {
  const res = await request(
    'POST',
    '/api/pdfme/render/now',
    {
      templateId,
      inputs: [{ field1: 'Test Value' }],
      entityType: 'invoice',
      entityId: `entity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel: 'print',
    },
    token,
  );
  return res;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cleanup(token, templateId) {
  await request('DELETE', `/api/pdfme/templates/${templateId}`, null, token);
}

async function runTests() {
  const token = makeToken();
  const tokenOrg2 = makeToken({ sub: 'user-hist-85-b', orgId: 'org-hist-85-other' });

  console.log('Feature #85: Render history paginated documents\n');

  // --- Setup: Create a template, publish it, and generate multiple documents ---
  console.log('Setting up test data...');
  const tmpl = await createTemplate(token, 'HIST85_Template');
  const templateId = tmpl.id;
  assert('Template created', !!templateId);

  // Publish the template so it can be rendered
  const pubRes = await request('POST', `/api/pdfme/templates/${templateId}/publish`, {}, token);
  if (pubRes.status !== 200 && pubRes.status !== 201) {
    const fs = require('fs');
    fs.writeFileSync('/tmp/debug-85-pub.txt', JSON.stringify(pubRes, null, 2));
  }
  assert('Template published', pubRes.status === 200 || pubRes.status === 201);

  // Generate 15 documents with small delays to ensure ordering
  const docIds = [];
  for (let i = 0; i < 15; i++) {
    const renderRes = await renderDocument(token, templateId);
    const docId = renderRes.body?.documentId || renderRes.body?.document?.id;
    if (docId) {
      docIds.push(docId);
    } else if (i === 0) {
      const fs = require('fs');
      fs.writeFileSync('/tmp/debug-85-render.txt', JSON.stringify(renderRes, null, 2));
    }
    await sleep(50); // Small delay for ordering
  }
  assert('Generated 15 documents', docIds.length === 15);

  // --- Test 1: Basic history endpoint works ---
  console.log('\n1. Basic history endpoint');
  const res1 = await request('GET', '/api/pdfme/render/history', null, token);
  assert('GET /history returns 200', res1.status === 200);
  assert('Response has data array', Array.isArray(res1.body.data));
  assert('Response has pagination object', !!res1.body.pagination);
  assert('Pagination has limit', typeof res1.body.pagination.limit === 'number');
  assert('Pagination has hasMore', typeof res1.body.pagination.hasMore === 'boolean');
  assert('Pagination has nextCursor', 'nextCursor' in res1.body.pagination);

  // --- Test 2: Default limit is 10 ---
  console.log('\n2. Default limit');
  assert('Default returns 10 results', res1.body.data.length === 10);
  assert('Default limit is 10', res1.body.pagination.limit === 10);
  assert('hasMore is true with 15 docs', res1.body.pagination.hasMore === true);
  assert('nextCursor is present', !!res1.body.pagination.nextCursor);

  // --- Test 3: Custom limit ---
  console.log('\n3. Custom limit');
  const res3 = await request('GET', '/api/pdfme/render/history?limit=5', null, token);
  assert('limit=5 returns 5 results', res3.body.data.length === 5);
  assert('limit=5 pagination limit is 5', res3.body.pagination.limit === 5);
  assert('limit=5 hasMore is true', res3.body.pagination.hasMore === true);

  // --- Test 4: Cursor pagination ---
  console.log('\n4. Cursor pagination');
  const cursor = res3.body.pagination.nextCursor;
  assert('First page has nextCursor', !!cursor);

  const res4 = await request('GET', `/api/pdfme/render/history?limit=5&cursor=${cursor}`, null, token);
  assert('Second page returns results', res4.body.data.length === 5);
  assert('Second page hasMore is true', res4.body.pagination.hasMore === true);

  // Check no overlap between pages
  const page1Ids = res3.body.data.map((d) => d.id);
  const page2Ids = res4.body.data.map((d) => d.id);
  const overlap = page1Ids.filter((id) => page2Ids.includes(id));
  assert('No overlap between pages', overlap.length === 0);

  // Third page
  const cursor2 = res4.body.pagination.nextCursor;
  const res4b = await request('GET', `/api/pdfme/render/history?limit=5&cursor=${cursor2}`, null, token);
  assert('Third page returns remaining docs', res4b.body.data.length === 5);
  assert('Third page hasMore is false', res4b.body.pagination.hasMore === false);
  assert('Third page nextCursor is null', res4b.body.pagination.nextCursor === null);

  // --- Test 5: Results ordered by createdAt desc ---
  console.log('\n5. Ordering');
  const allRes = await request('GET', '/api/pdfme/render/history?limit=100', null, token);
  const dates = allRes.body.data.map((d) => new Date(d.createdAt).getTime());
  let isDescending = true;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      isDescending = false;
      break;
    }
  }
  assert('Results ordered by createdAt descending', isDescending);

  // --- Test 6: Each document has required fields ---
  console.log('\n6. Document fields');
  const doc = allRes.body.data[0];
  assert('Document has id', !!doc.id);
  assert('Document has templateId', !!doc.templateId);
  assert('Document has templateVer', typeof doc.templateVer === 'number');
  assert('Document has entityType', !!doc.entityType);
  assert('Document has entityId', !!doc.entityId);
  assert('Document has status', !!doc.status);
  assert('Document has outputChannel', !!doc.outputChannel);
  assert('Document has createdAt', !!doc.createdAt);
  assert('Document has pdfHash', typeof doc.pdfHash === 'string');

  // --- Test 7: Org scoping ---
  console.log('\n7. Org scoping');
  const resOrg2 = await request('GET', '/api/pdfme/render/history', null, tokenOrg2);
  assert('Other org returns 200', resOrg2.status === 200);
  assert('Other org has no documents', resOrg2.body.data.length === 0);
  assert('Other org hasMore is false', resOrg2.body.pagination.hasMore === false);

  // --- Test 8: No auth returns 401 ---
  console.log('\n8. Auth check');
  const resNoAuth = await request('GET', '/api/pdfme/render/history', null, null);
  assert('No auth returns 401', resNoAuth.status === 401);

  // --- Test 9: Filter by entityType ---
  console.log('\n9. Filter by entityType');
  const resFilter = await request('GET', '/api/pdfme/render/history?entityType=invoice', null, token);
  assert('Filtered by entityType returns results', resFilter.body.data.length > 0);
  const allInvoices = resFilter.body.data.every((d) => d.entityType === 'invoice');
  assert('All results match entityType filter', allInvoices);

  // --- Test 10: Filter by status ---
  console.log('\n10. Filter by status');
  const resStatus = await request('GET', '/api/pdfme/render/history?status=done', null, token);
  assert('Filtered by status returns results', resStatus.body.data.length > 0);
  const allDone = resStatus.body.data.every((d) => d.status === 'done');
  assert('All results match status filter', allDone);

  // --- Test 11: Large limit caps at 500 ---
  console.log('\n11. Limit cap');
  const resCap = await request('GET', '/api/pdfme/render/history?limit=1000', null, token);
  assert('Large limit returns results', resCap.status === 200);
  // The effective limit should be capped at 500
  assert('Effective limit capped', resCap.body.pagination.limit === 500);

  // --- Cleanup ---
  console.log('\nCleaning up...');
  await cleanup(token, templateId);

  // --- Summary ---
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
