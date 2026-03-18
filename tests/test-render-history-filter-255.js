/**
 * Test: Feature #255 - Render history filter by status
 * Document history filterable by generation status
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const token = signJwt({ sub: 'user-255', orgId: 'org-255', roles: ['template:edit', 'template:publish', 'render:trigger'] });

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
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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
  console.log('--- Setup: Create template and generate documents ---');

  // Create a template
  const tpl = await request('POST', `${BASE}/api/pdfme/templates`, {
    name: 'Filter Test 255',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Test' }]],
    },
  });
  templateId = tpl.body.id;
  console.log(`  Template created: ${templateId}`);

  // Publish the template
  await request('POST', `${BASE}/api/pdfme/templates/${templateId}/publish`, {});
  console.log('  Template published');

  // Generate several documents (these should complete as "done")
  for (let i = 0; i < 3; i++) {
    const r = await request('POST', `${BASE}/api/pdfme/render/now`, {
      templateId,
      entityId: `entity-done-255-${i}`,
      channel: 'email',
    });
    if (r.status !== 200) {
      console.log(`  Render ${i} failed:`, JSON.stringify(r.body).substring(0, 200));
    }
  }
  console.log('  Generated 3 documents');
}

async function testFilterByDone() {
  console.log('\n--- Test: Filter by status=done ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=done`, null);
  assert('Returns 200', r.status === 200);
  assert('Response has data array', Array.isArray(r.body.data));
  assert('All documents have status=done', r.body.data.length > 0 && r.body.data.every(d => d.status === 'done'));
  assert('Contains our generated documents', r.body.data.length >= 3);
  assert('Filter info present', r.body.filter && r.body.filter.status === 'done');
  assert('Pagination total matches data length', r.body.pagination.total === r.body.data.length);
}

async function testFilterByFailed() {
  console.log('\n--- Test: Filter by status=failed ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=failed`, null);
  assert('Returns 200', r.status === 200);
  assert('Response has data array', Array.isArray(r.body.data));
  assert('All have status=failed or empty list', r.body.data.every(d => d.status === 'failed'));
  // We haven't created any failed docs, so should be empty
  assert('No failed documents (none generated)', r.body.data.length === 0);
  assert('Filter info present', r.body.filter && r.body.filter.status === 'failed');
}

async function testFilterByQueued() {
  console.log('\n--- Test: Filter by status=queued ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=queued`, null);
  assert('Returns 200', r.status === 200);
  assert('Response has data array', Array.isArray(r.body.data));
  assert('All have status=queued or empty list', r.body.data.every(d => d.status === 'queued'));
  assert('Filter info present for queued', r.body.filter && r.body.filter.status === 'queued');
}

async function testFilterByGenerating() {
  console.log('\n--- Test: Filter by status=generating ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=generating`, null);
  assert('Returns 200', r.status === 200);
  assert('Response has data array', Array.isArray(r.body.data));
  assert('All have status=generating or empty list', r.body.data.every(d => d.status === 'generating'));
}

async function testNoFilter() {
  console.log('\n--- Test: No filter returns all documents ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}`, null);
  assert('Returns 200', r.status === 200);
  assert('Response has data array', Array.isArray(r.body.data));
  assert('Contains all generated documents', r.body.data.length >= 3);
  assert('No filter info in response', !r.body.filter);
}

async function testInvalidStatus() {
  console.log('\n--- Test: Invalid status filter ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=invalid`, null);
  assert('Returns 400 for invalid status', r.status === 400);
  assert('Error message mentions invalid status', typeof r.body.message === 'string' && r.body.message.includes('Invalid status'));

  const r2 = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=`, null);
  assert('Empty status treated as no filter (200)', r2.status === 200);
}

async function testDoneVsTotal() {
  console.log('\n--- Test: Done count vs total count ---');
  const allR = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}`, null);
  const doneR = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=done`, null);
  const failedR = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=failed`, null);
  const queuedR = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=queued`, null);
  const generatingR = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=generating`, null);

  const sumFiltered = doneR.body.data.length + failedR.body.data.length + queuedR.body.data.length + generatingR.body.data.length;
  assert('Sum of filtered results equals total', sumFiltered === allR.body.data.length);
  assert('Done documents exist', doneR.body.data.length >= 3);
}

async function testDocumentFields() {
  console.log('\n--- Test: Document fields in filtered response ---');
  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${templateId}?status=done`, null);
  if (r.body.data && r.body.data.length > 0) {
    const doc = r.body.data[0];
    assert('Document has id', !!doc.id);
    assert('Document has templateId', doc.templateId === templateId);
    assert('Document has templateVer', typeof doc.templateVer === 'number');
    assert('Document has entityId', !!doc.entityId);
    assert('Document has status=done', doc.status === 'done');
    assert('Document has outputChannel', !!doc.outputChannel);
    assert('Document has createdAt', !!doc.createdAt);
    assert('Document has pdfHash', !!doc.pdfHash);
  } else {
    assert('Has documents to inspect', false);
  }
}

async function testEmptyTemplate() {
  console.log('\n--- Test: Filter on template with no documents ---');
  // Create a fresh template with no renders
  const tpl = await request('POST', `${BASE}/api/pdfme/templates`, {
    name: 'Empty Filter Test 255',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'X' }]],
    },
  });
  const emptyTplId = tpl.body.id;

  const r = await request('GET', `${BASE}/api/pdfme/render/documents/${emptyTplId}?status=done`, null);
  assert('Returns 200 for empty template', r.status === 200);
  assert('Empty data array', Array.isArray(r.body.data) && r.body.data.length === 0);
  assert('Pagination total is 0', r.body.pagination.total === 0);
}

async function run() {
  try {
    await setup();
    await testFilterByDone();
    await testFilterByFailed();
    await testFilterByQueued();
    await testFilterByGenerating();
    await testNoFilter();
    await testInvalidStatus();
    await testDoneVsTotal();
    await testDocumentFields();
    await testEmptyTemplate();
  } catch (err) {
    console.error('Test error:', err);
  }

  console.log(`\n=============================`);
  console.log(`Results: ${passed}/${passed + failed} passing`);
  console.log(`=============================`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
