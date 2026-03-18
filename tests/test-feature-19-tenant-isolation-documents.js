/**
 * Feature #19: Tenant isolation - generated documents scoped to orgId
 *
 * Verifies that generated document queries filter by orgId:
 * 1. Render document with org-A JWT
 * 2. Render document with org-B JWT
 * 3. GET /api/pdfme/render/documents with org-A - only org-A documents
 * 4. Attempt to download org-B document with org-A JWT returns 404
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
let passed = 0;
let failed = 0;

function makeToken(orgId, sub) {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'user-' + orgId,
    orgId: orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, path, token, body) {
  return new Promise(function(resolve, reject) {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        let parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
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
    process.stdout.write('  ✅ ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  ❌ ' + name + '\n');
  }
}

async function run() {
  process.stdout.write('=== Feature #19: Tenant isolation - generated documents scoped to orgId ===\n\n');

  const TS = Date.now();
  const ORG_A = 'org-isolation-A-' + TS;
  const ORG_B = 'org-isolation-B-' + TS;
  const TOKEN_A = makeToken(ORG_A, 'user-A-19');
  const TOKEN_B = makeToken(ORG_B, 'user-B-19');

  // Step 1: Create templates for each org
  process.stdout.write('Step 1: Create templates for each org\n');
  const tplA = await request('POST', '/api/pdfme/templates', TOKEN_A, {
    name: 'Isolation Test Template A',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Org A Document' }
        ],
        size: { width: 210, height: 297 }
      }]
    },
  });
  assert('Template A created', tplA.status === 200 || tplA.status === 201);
  const templateIdA = tplA.data.id;

  const tplB = await request('POST', '/api/pdfme/templates', TOKEN_B, {
    name: 'Isolation Test Template B',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Org B Document' }
        ],
        size: { width: 210, height: 297 }
      }]
    },
  });
  assert('Template B created', tplB.status === 200 || tplB.status === 201);
  const templateIdB = tplB.data.id;

  // Step 2: Publish both templates
  process.stdout.write('\nStep 2: Publish templates\n');
  const pubA = await request('POST', '/api/pdfme/templates/' + templateIdA + '/publish', TOKEN_A, {});
  assert('Template A published', pubA.status === 200 || pubA.status === 201);

  const pubB = await request('POST', '/api/pdfme/templates/' + templateIdB + '/publish', TOKEN_B, {});
  assert('Template B published', pubB.status === 200 || pubB.status === 201);

  // Step 3: Render document with org-A JWT
  process.stdout.write('\nStep 3: Render document with org-A JWT\n');
  const renderA = await request('POST', '/api/pdfme/render/now', TOKEN_A, {
    templateId: templateIdA,
    entityId: 'entity-iso-A-' + TS,
    entityType: 'invoice',
    channel: 'email',
    inputs: { title: 'Org A Invoice' },
  });
  assert('Org-A render succeeded', renderA.status === 200 || renderA.status === 201);
  assert('Org-A render has document', renderA.data.document != null);
  const docIdA = renderA.data.document ? renderA.data.document.id : null;
  assert('Org-A document has id', !!docIdA);

  // Step 4: Render document with org-B JWT
  process.stdout.write('\nStep 4: Render document with org-B JWT\n');
  const renderB = await request('POST', '/api/pdfme/render/now', TOKEN_B, {
    templateId: templateIdB,
    entityId: 'entity-iso-B-' + TS,
    entityType: 'invoice',
    channel: 'print',
    inputs: { title: 'Org B Invoice' },
  });
  assert('Org-B render succeeded', renderB.status === 200 || renderB.status === 201);
  assert('Org-B render has document', renderB.data.document != null);
  const docIdB = renderB.data.document ? renderB.data.document.id : null;
  assert('Org-B document has id', !!docIdB);

  // Step 5: GET /api/pdfme/render/documents with org-A - only org-A docs
  process.stdout.write('\nStep 5: Org-A document list shows only org-A documents\n');
  const histA = await request('GET', '/api/pdfme/render/documents', TOKEN_A);
  assert('Org-A documents list returns 200', histA.status === 200);
  assert('Org-A documents has data array', Array.isArray(histA.data.data));

  const orgADocs = histA.data.data || [];
  const orgADocIds = orgADocs.map(function(d) { return d.id; });
  assert('Org-A list contains org-A document', orgADocIds.includes(docIdA));
  assert('Org-A list does NOT contain org-B document', !orgADocIds.includes(docIdB));

  // Step 6: GET /api/pdfme/render/documents with org-B - only org-B docs
  process.stdout.write('\nStep 6: Org-B document list shows only org-B documents\n');
  const histB = await request('GET', '/api/pdfme/render/documents', TOKEN_B);
  assert('Org-B documents list returns 200', histB.status === 200);

  const orgBDocs = histB.data.data || [];
  const orgBDocIds = orgBDocs.map(function(d) { return d.id; });
  assert('Org-B list contains org-B document', orgBDocIds.includes(docIdB));
  assert('Org-B list does NOT contain org-A document', !orgBDocIds.includes(docIdA));

  // Step 7: Attempt to download org-B document with org-A JWT returns 404
  process.stdout.write('\nStep 7: Cross-tenant document download blocked\n');
  const crossDownload = await request('GET', '/api/pdfme/render/document/' + docIdB, TOKEN_A);
  assert('Org-A cannot download org-B document (404)', crossDownload.status === 404);

  const crossDownload2 = await request('GET', '/api/pdfme/render/document/' + docIdA, TOKEN_B);
  assert('Org-B cannot download org-A document (404)', crossDownload2.status === 404);

  // Step 8: Org-A CAN download its own document
  process.stdout.write('\nStep 8: Same-tenant document download works\n');
  const ownDownload = await request('GET', '/api/pdfme/render/document/' + docIdA, TOKEN_A);
  assert('Org-A can download own document (200)', ownDownload.status === 200);

  const ownDownloadB = await request('GET', '/api/pdfme/render/document/' + docIdB, TOKEN_B);
  assert('Org-B can download own document (200)', ownDownloadB.status === 200);

  // Step 9: Cross-tenant document verification blocked
  process.stdout.write('\nStep 9: Cross-tenant document verification blocked\n');
  const crossVerify = await request('GET', '/api/pdfme/render/verify/' + docIdB, TOKEN_A);
  assert('Org-A cannot verify org-B document (404)', crossVerify.status === 404);

  const crossVerify2 = await request('GET', '/api/pdfme/render/verify/' + docIdA, TOKEN_B);
  assert('Org-B cannot verify org-A document (404)', crossVerify2.status === 404);

  // Step 10: Cross-tenant document snapshot blocked
  process.stdout.write('\nStep 10: Cross-tenant document snapshot blocked\n');
  const crossSnap = await request('GET', '/api/pdfme/render/document/' + docIdB + '/snapshot', TOKEN_A);
  assert('Org-A cannot get org-B snapshot (404)', crossSnap.status === 404);

  // Step 11: Template-scoped document list isolation
  process.stdout.write('\nStep 11: Template-scoped document list isolation\n');
  const tplDocsA = await request('GET', '/api/pdfme/render/documents/' + templateIdA, TOKEN_A);
  assert('Org-A template docs returns 200', tplDocsA.status === 200);
  const tplADocIds = (tplDocsA.data.data || []).map(function(d) { return d.id; });
  assert('Template A docs contain org-A document', tplADocIds.includes(docIdA));

  // Org-B trying to list org-A template docs should return empty
  const crossTplDocs = await request('GET', '/api/pdfme/render/documents/' + templateIdA, TOKEN_B);
  assert('Org-B listing org-A template docs returns 200', crossTplDocs.status === 200);
  const crossTplDocIds = (crossTplDocs.data.data || []).map(function(d) { return d.id; });
  assert('Org-B gets no docs for org-A template', crossTplDocIds.length === 0);

  // Step 12: Render multiple org-A docs and verify count isolation
  process.stdout.write('\nStep 12: Multiple documents maintain isolation\n');
  const renderA2 = await request('POST', '/api/pdfme/render/now', TOKEN_A, {
    templateId: templateIdA,
    entityId: 'entity-iso-A2-' + TS,
    entityType: 'invoice',
    channel: 'print',
    inputs: { title: 'Org A Invoice 2' },
  });
  assert('Org-A second render succeeded', renderA2.status === 200 || renderA2.status === 201);
  const docIdA2 = renderA2.data.document ? renderA2.data.document.id : null;

  const histA2 = await request('GET', '/api/pdfme/render/documents', TOKEN_A);
  const orgA2Docs = histA2.data.data || [];
  const orgA2DocIds = orgA2Docs.map(function(d) { return d.id; });
  assert('Org-A list includes both org-A documents', orgA2DocIds.includes(docIdA) && orgA2DocIds.includes(docIdA2));
  assert('Org-A list still excludes org-B document', !orgA2DocIds.includes(docIdB));

  // Re-check org-B list hasn't changed
  const histB2 = await request('GET', '/api/pdfme/render/documents', TOKEN_B);
  const orgB2Docs = histB2.data.data || [];
  const orgB2DocIds = orgB2Docs.map(function(d) { return d.id; });
  assert('Org-B list still excludes org-A documents', !orgB2DocIds.includes(docIdA) && !orgB2DocIds.includes(docIdA2));

  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
