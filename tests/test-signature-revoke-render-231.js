/**
 * Feature #231: Signature revocation removes from future renders
 *
 * Tests:
 * 1. Upload signature
 * 2. Render document - signature appears
 * 3. Revoke signature
 * 4. Render new document - signature absent or fallback
 * 5. Previous renders unchanged
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-231', 'org-231', ['template:edit', 'template:publish', 'render:trigger']);
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

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'http://localhost:3000');
    const headers = {
      authorization: AUTH,
      ...(body ? { 'content-type': 'application/json' } : {}),
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

// Create a small but real PNG for signature (8x8 red square)
function createSignaturePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function runTests() {
  console.log('\n=== Feature #231: Signature revocation removes from future renders ===\n');

  // Step 1: Create a template with a drawnSignature field
  console.log('--- Create template with drawnSignature field ---');
  const tmplRes = await request('POST', '/api/pdfme/templates', {
    orgId: 'org-231',
    type: 'invoice',
    name: 'Signature Test Invoice 231',
    schema: {
      pages: [{
        elements: [
          {
            type: 'text',
            name: 'title',
            content: 'Invoice',
            position: { x: 10, y: 10 },
            width: 100,
            height: 20,
          },
          {
            type: 'drawnSignature',
            name: 'userSignature',
            fallbackBehaviour: 'blank',
            position: { x: 10, y: 200 },
            width: 50,
            height: 20,
          },
        ],
      }],
    },
    createdBy: 'user-231',
  });
  assert(tmplRes.status === 201, `Template created (status ${tmplRes.status})`);
  const templateId = tmplRes.body.id;

  // Step 2: Publish the template
  const pubRes = await request('POST', `/api/pdfme/templates/${templateId}/publish`);
  assert(pubRes.body.status === 'published', 'Template published');

  // Step 3: Upload a signature
  console.log('\n--- Upload signature ---');
  const sigPng = createSignaturePng();
  const sigBase64 = sigPng.toString('base64');

  const sigUpload = await request('POST', '/api/pdfme/signatures', {
    data: sigBase64,
  });
  assert(sigUpload.status === 201, `Signature uploaded (status ${sigUpload.status})`);
  const sigId = sigUpload.body.id;
  assert(sigId, `Signature ID: ${sigId}`);
  assert(sigUpload.body.filePath, `Signature file path: ${sigUpload.body.filePath}`);

  // Step 4: Verify signature is active
  const sigCheck = await request('GET', '/api/pdfme/signatures/me');
  assert(sigCheck.status === 200, 'Signature retrievable');
  assert(sigCheck.body.id === sigId, 'Active signature matches uploaded');
  assert(sigCheck.body.revokedAt === null, 'Signature not revoked');

  // Step 5: Render document WITH active signature
  console.log('\n--- Render with active signature ---');
  const render1 = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-231-with-sig',
    channel: 'email',
  });
  assert(render1.status === 200 || render1.status === 201, `Render with signature succeeded (status ${render1.status})`);
  const doc1Id = render1.body?.document?.id;
  assert(doc1Id, `Document 1 ID (with sig): ${doc1Id}`);
  assert(render1.body?.document?.status === 'done', 'Document 1 status is done');

  // Step 6: Download document 1 and verify it's a valid PDF
  const dl1 = await request('GET', `/api/pdfme/render/document/${doc1Id}`);
  assert(dl1.status === 200, `Document 1 downloadable (status ${dl1.status})`);
  assert(dl1.headers['content-type']?.includes('application/pdf'), 'Document 1 is PDF');
  const doc1Hash = dl1.headers['etag'];
  const doc1Size = dl1.rawBody.length;
  assert(doc1Size > 0, `Document 1 has content (${doc1Size} bytes)`);

  // Step 7: Revoke the signature
  console.log('\n--- Revoke signature ---');
  const revokeRes = await request('DELETE', '/api/pdfme/signatures/me');
  assert(revokeRes.status === 200, `Signature revoked (status ${revokeRes.status})`);
  assert(revokeRes.body.message?.includes('revoked'), 'Revocation confirmed');

  // Step 8: Verify signature is no longer active
  const sigCheckRevoked = await request('GET', '/api/pdfme/signatures/me');
  assert(sigCheckRevoked.status === 404, `No active signature after revocation (status ${sigCheckRevoked.status})`);

  // Step 9: Render NEW document WITHOUT signature (after revocation)
  console.log('\n--- Render after revocation (should use fallback) ---');
  const render2 = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-231-no-sig',
    channel: 'email',
  });
  assert(render2.status === 200 || render2.status === 201, `Render after revocation succeeded (status ${render2.status})`);
  const doc2Id = render2.body?.document?.id;
  assert(doc2Id, `Document 2 ID (no sig): ${doc2Id}`);
  assert(render2.body?.document?.status === 'done', 'Document 2 status is done (fallback used)');

  // Step 10: Download document 2 and verify it's different from document 1
  const dl2 = await request('GET', `/api/pdfme/render/document/${doc2Id}`);
  assert(dl2.status === 200, `Document 2 downloadable (status ${dl2.status})`);
  assert(dl2.headers['content-type']?.includes('application/pdf'), 'Document 2 is PDF');
  const doc2Hash = dl2.headers['etag'];
  assert(doc2Hash !== doc1Hash, `Document 2 has different hash (sig vs no-sig): ${doc2Hash} vs ${doc1Hash}`);

  // Step 11: Previous render (doc1) is UNCHANGED
  console.log('\n--- Verify previous render unchanged ---');
  const dl1After = await request('GET', `/api/pdfme/render/document/${doc1Id}`);
  assert(dl1After.status === 200, 'Previous document still downloadable');
  assert(dl1After.headers['etag'] === doc1Hash, 'Previous document hash unchanged');
  assert(dl1After.rawBody.length === doc1Size, 'Previous document size unchanged');

  // Step 12: Render history shows both documents
  console.log('\n--- Verify render history shows both documents ---');
  const history = await request('GET', `/api/pdfme/render/documents/${templateId}`);
  assert(history.status === 200, 'Render history accessible');
  assert(history.body.data.length >= 2, `History has ${history.body.data.length} documents`);

  const histDocIds = history.body.data.map(d => d.id);
  assert(histDocIds.includes(doc1Id), 'History includes pre-revocation document');
  assert(histDocIds.includes(doc2Id), 'History includes post-revocation document');

  // Step 13: Test with fallbackBehaviour='placeholder' (signature is still revoked)
  console.log('\n--- Test placeholder fallback ---');
  const tmplPlaceholder = await request('POST', '/api/pdfme/templates', {
    orgId: 'org-231',
    type: 'invoice',
    name: 'Placeholder Sig Template 231',
    schema: {
      pages: [{
        elements: [
          {
            type: 'text',
            name: 'title',
            content: 'Placeholder Invoice',
            position: { x: 10, y: 10 },
            width: 100,
            height: 20,
          },
          {
            type: 'drawnSignature',
            name: 'sigPlaceholder',
            fallbackBehaviour: 'placeholder',
            position: { x: 10, y: 200 },
            width: 60,
            height: 25,
          },
        ],
      }],
    },
    createdBy: 'user-231',
  });
  const placeholderTmplId = tmplPlaceholder.body.id;
  await request('POST', `/api/pdfme/templates/${placeholderTmplId}/publish`);

  const renderPlaceholder = await request('POST', '/api/pdfme/render/now', {
    templateId: placeholderTmplId,
    entityId: 'entity-231-placeholder',
    channel: 'email',
  });
  assert(
    renderPlaceholder.status === 200 || renderPlaceholder.status === 201,
    `Placeholder render succeeded (status ${renderPlaceholder.status})`,
  );
  assert(renderPlaceholder.body?.document?.status === 'done', 'Placeholder render produces done document');

  // Step 14: Verify blank fallback produces valid but signature-less document
  console.log('\n--- Verify blank fallback produces valid document ---');
  // The render after revocation used 'blank' fallback (transparent 1x1 PNG)
  // Verify it's a valid PDF that can be downloaded
  const blankFallbackDoc = await request('GET', `/api/pdfme/render/document/${doc2Id}`);
  assert(blankFallbackDoc.status === 200, 'Blank fallback document is downloadable');
  const pdfHeader = blankFallbackDoc.rawBody.slice(0, 5).toString();
  assert(pdfHeader === '%PDF-', 'Blank fallback document is valid PDF');

  // Step 15: Upload new signature and render - should work again
  console.log('\n--- Upload new signature and render again ---');
  const newSigUpload = await request('POST', '/api/pdfme/signatures', {
    data: sigBase64,
  });
  assert(newSigUpload.status === 201, 'New signature uploaded');

  const render3 = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-231-new-sig',
    channel: 'email',
  });
  assert(render3.status === 200 || render3.status === 201, `Render with new sig succeeded (status ${render3.status})`);
  assert(render3.body?.document?.status === 'done', 'Render with new signature produces done doc');

  // The new render should include the new signature (different from no-sig render)
  const doc3Id = render3.body?.document?.id;
  const dl3 = await request('GET', `/api/pdfme/render/document/${doc3Id}`);
  assert(dl3.headers['etag'] !== doc2Hash, 'New signature render differs from no-sig render');

  // Step 16: Revoke new signature again and verify render uses fallback again
  console.log('\n--- Revoke again and verify fallback ---');
  await request('DELETE', '/api/pdfme/signatures/me');
  const sigAfterRevoke2 = await request('GET', '/api/pdfme/signatures/me');
  assert(sigAfterRevoke2.status === 404, 'No active signature after second revocation');

  const render4 = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-231-revoke2',
    channel: 'email',
  });
  assert(render4.body?.document?.status === 'done', 'Render after second revocation uses fallback');
  const doc4Id = render4.body?.document?.id;
  const dl4 = await request('GET', `/api/pdfme/render/document/${doc4Id}`);
  // After second revocation, render should differ from signed render (doc3 with sig)
  const doc3Hash = dl3.headers['etag'];
  assert(dl4.headers['etag'] !== doc3Hash, 'Second revocation render differs from signed render (no signature embedded)');

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
