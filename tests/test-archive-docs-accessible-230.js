/**
 * Feature #230: Template archive - rendered docs still accessible
 *
 * Tests:
 * 1. Generate documents from template
 * 2. Archive template
 * 3. Verify generated docs still downloadable
 * 4. Verify render history still shows docs
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-230', 'org-230', ['template:edit', 'template:publish', 'template:delete', 'render:trigger']);
const AUTH = `Bearer ${TOKEN}`;

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

function request(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, process.env.API_BASE || 'http://localhost:3001');
    const headers = {
      authorization: AUTH,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    };
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let parsed;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode, body: parsed, rawBody: raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=== Feature #230: Template archive - rendered docs still accessible ===\n');

  // Step 1: Create a template
  console.log('--- Create and publish template ---');
  const createRes = await request('POST', '/api/pdfme/templates', {
    orgId: 'org-230',
    type: 'invoice',
    name: 'Archive Test Invoice 230',
    schema: {
      pages: [{
        elements: [{
          type: 'text',
          name: 'title',
          content: 'Invoice Title',
          position: { x: 10, y: 10 },
          width: 100,
          height: 20,
        }],
      }],
    },
    createdBy: 'user-230',
  });
  assert(createRes.status === 201, `Template created (status ${createRes.status})`);
  const templateId = createRes.body.id;
  assert(templateId, `Template ID: ${templateId}`);

  // Step 2: Publish the template
  const publishRes = await request('POST', `/api/pdfme/templates/${templateId}/publish`);
  assert(publishRes.status === 200 || publishRes.status === 201, `Template published (status ${publishRes.status})`);
  assert(publishRes.body.status === 'published', 'Template status is published');

  // Step 3: Render a document from the published template
  console.log('\n--- Render documents from template ---');
  const render1Res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-230-1',
    channel: 'email',
  });
  assert(render1Res.status === 200 || render1Res.status === 201, `First render succeeded (status ${render1Res.status})`);
  const doc1Id = render1Res.body?.document?.id || render1Res.body?.id;
  assert(doc1Id, `Document 1 ID: ${doc1Id}`);

  // Render a second document
  const render2Res = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-230-2',
    channel: 'print',
  });
  assert(render2Res.status === 200 || render2Res.status === 201, `Second render succeeded (status ${render2Res.status})`);
  const doc2Id = render2Res.body?.document?.id || render2Res.body?.id;
  assert(doc2Id, `Document 2 ID: ${doc2Id}`);

  // Step 4: Verify documents are downloadable before archive
  console.log('\n--- Verify documents downloadable before archive ---');
  const download1Before = await request('GET', `/api/pdfme/render/document/${doc1Id}`);
  assert(download1Before.status === 200, `Doc 1 downloadable before archive (status ${download1Before.status})`);
  assert(download1Before.headers['content-type']?.includes('application/pdf'), 'Doc 1 is PDF');

  const download2Before = await request('GET', `/api/pdfme/render/document/${doc2Id}`);
  assert(download2Before.status === 200, `Doc 2 downloadable before archive (status ${download2Before.status})`);

  // Step 5: Verify render history shows docs before archive
  console.log('\n--- Verify render history before archive ---');
  const historyBefore = await request('GET', `/api/pdfme/render/documents/${templateId}`);
  assert(historyBefore.status === 200, `Render history accessible (status ${historyBefore.status})`);
  assert(Array.isArray(historyBefore.body.data), 'History data is array');
  assert(historyBefore.body.data.length >= 2, `At least 2 documents in history (found ${historyBefore.body.data.length})`);

  const docIds = historyBefore.body.data.map(d => d.id);
  assert(docIds.includes(doc1Id), 'History includes document 1');
  assert(docIds.includes(doc2Id), 'History includes document 2');

  // Step 6: Archive the template
  console.log('\n--- Archive the template ---');
  const archiveRes = await request('DELETE', `/api/pdfme/templates/${templateId}`);
  assert(archiveRes.status === 200, `Template archived (status ${archiveRes.status})`);
  assert(archiveRes.body.status === 'archived', 'Template status is archived');

  // Step 7: Verify template is archived (not in list)
  const listRes = await request('GET', '/api/pdfme/templates?orgId=org-230');
  const templateInList = listRes.body.data?.some(t => t.id === templateId);
  assert(!templateInList, 'Archived template not in template list');

  // Step 8: Verify generated docs STILL downloadable after archive
  console.log('\n--- Verify documents STILL downloadable after archive ---');
  const download1After = await request('GET', `/api/pdfme/render/document/${doc1Id}`);
  assert(download1After.status === 200, `Doc 1 still downloadable after archive (status ${download1After.status})`);
  assert(download1After.headers['content-type']?.includes('application/pdf'), 'Doc 1 still returns PDF');
  assert(download1After.headers['etag'], 'Doc 1 still has ETag');

  const download2After = await request('GET', `/api/pdfme/render/document/${doc2Id}`);
  assert(download2After.status === 200, `Doc 2 still downloadable after archive (status ${download2After.status})`);
  assert(download2After.headers['content-type']?.includes('application/pdf'), 'Doc 2 still returns PDF');

  // Step 9: Verify PDF content is identical before and after archive
  console.log('\n--- Verify PDF content unchanged ---');
  // Compare ETags
  assert(
    download1Before.headers['etag'] === download1After.headers['etag'],
    `Doc 1 ETag unchanged: ${download1Before.headers['etag']}`,
  );
  assert(
    download2Before.headers['etag'] === download2After.headers['etag'],
    `Doc 2 ETag unchanged`,
  );

  // Step 10: Verify render history STILL shows docs after archive
  console.log('\n--- Verify render history STILL shows docs after archive ---');
  const historyAfter = await request('GET', `/api/pdfme/render/documents/${templateId}`);
  assert(historyAfter.status === 200, `Render history still accessible after archive (status ${historyAfter.status})`);
  assert(historyAfter.body.data.length >= 2, `History still has docs after archive (${historyAfter.body.data.length})`);

  const docIdsAfter = historyAfter.body.data.map(d => d.id);
  assert(docIdsAfter.includes(doc1Id), 'History still includes document 1 after archive');
  assert(docIdsAfter.includes(doc2Id), 'History still includes document 2 after archive');

  // Step 11: Verify document metadata is preserved
  console.log('\n--- Verify document metadata preserved ---');
  const doc1Meta = historyAfter.body.data.find(d => d.id === doc1Id);
  assert(doc1Meta.templateId === templateId, 'Document still references archived template');
  assert(doc1Meta.entityId === 'entity-230-1', 'Document entityId preserved');
  assert(doc1Meta.status === 'done', 'Document status still done');
  assert(doc1Meta.outputChannel === 'email', 'Document output channel preserved');

  const doc2Meta = historyAfter.body.data.find(d => d.id === doc2Id);
  assert(doc2Meta.entityId === 'entity-230-2', 'Document 2 entityId preserved');
  assert(doc2Meta.outputChannel === 'print', 'Document 2 output channel preserved');

  // Step 12: Verify document count/pagination
  assert(historyAfter.body.pagination.total >= 2, 'Pagination total reflects document count');

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
