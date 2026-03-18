/**
 * Feature #39: PDF tamper detection via SHA-256 hash
 *
 * Generated documents have SHA-256 hash for integrity verification.
 * Modifying the PDF file directly on disk causes the hash check to fail.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
const STORAGE_ROOT = path.join(process.cwd(), 'storage');

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'tamper-test-org-39';
const TOKEN = makeToken('tamper-user', ORG_ID, [
  'template:view', 'template:edit', 'template:publish', 'render:trigger',
]);
const OTHER_ORG_TOKEN = makeToken('other-user', 'other-org-39', [
  'template:view', 'template:edit', 'template:publish', 'render:trigger',
]);

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(data);
        let parsed;
        try { parsed = JSON.parse(buf.toString()); } catch (e) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${name}`);
  }
}

async function createAndPublishTemplate() {
  // Save draft
  const draft = await request('POST', '/api/pdfme/templates', {
    name: 'Tamper Test Template ' + Date.now(),
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  }, TOKEN);

  if (draft.status >= 400) {
    console.log('  Failed to create template:', JSON.stringify(draft.body).substring(0, 200));
    return null;
  }

  const templateId = draft.body.id;

  // Publish
  const pub = await request('POST', `/api/pdfme/templates/${templateId}/publish`, {}, TOKEN);
  if (pub.status >= 400) {
    console.log('  Failed to publish:', JSON.stringify(pub.body).substring(0, 200));
    return null;
  }

  return templateId;
}

async function renderDocument(templateId) {
  const resp = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'tamper-entity-' + Date.now(),
    channel: 'print',
    inputs: { title: 'Test Document' },
  }, TOKEN);

  return resp;
}

async function run() {
  console.log('Feature #39: PDF tamper detection via SHA-256 hash\n');

  // === Setup: Create template and render document ===
  console.log('Setup: Creating and publishing template...');
  const templateId = await createAndPublishTemplate();
  assert(templateId !== null, 'Template created and published');
  if (!templateId) {
    console.log('Cannot proceed without template');
    process.exit(1);
  }

  console.log('Setup: Rendering document...');
  const renderResp = await renderDocument(templateId);
  assert(renderResp.status < 300, 'Document rendered successfully');

  const renderBody = renderResp.body.document || renderResp.body;
  const documentId = renderBody.documentId || renderBody.id;
  assert(!!documentId, 'documentId returned in render response');

  const pdfHash = renderBody.pdfHash;
  assert(typeof pdfHash === 'string' && pdfHash.length > 0, 'pdfHash returned in render response');
  assert(pdfHash && pdfHash.length === 64, 'pdfHash is 64-char hex (SHA-256)');

  // === 1. Verify integrity - should pass ===
  console.log('\nTest 1: Verify document integrity (should be intact)');
  const verify1 = await request('GET', `/api/pdfme/render/verify/${documentId}`, null, TOKEN);
  assert(verify1.status < 300, 'verify returns success status');
  assert(verify1.body.verified === true, 'verified is true');
  assert(verify1.body.status === 'intact', 'status is "intact"');
  assert(verify1.body.message && verify1.body.message.includes('integrity confirmed'), 'message confirms integrity');
  assert(verify1.body.storedHash === pdfHash, 'storedHash matches render response pdfHash');
  assert(verify1.body.currentHash === pdfHash, 'currentHash matches stored hash');
  assert(verify1.body.documentId === documentId, 'documentId matches');

  // === 2. Verify response includes required fields ===
  console.log('\nTest 2: Verify response has all required fields');
  assert('verified' in verify1.body, 'response has "verified" field');
  assert('status' in verify1.body, 'response has "status" field');
  assert('message' in verify1.body, 'response has "message" field');
  assert('storedHash' in verify1.body, 'response has "storedHash" field');
  assert('currentHash' in verify1.body, 'response has "currentHash" field');
  assert('documentId' in verify1.body, 'response has "documentId" field');
  assert('filePath' in verify1.body, 'response has "filePath" field');

  // === 3. Tamper with the PDF file on disk ===
  console.log('\nTest 3: Tamper with PDF file on disk');
  const filePath = verify1.body.filePath;
  assert(typeof filePath === 'string' && filePath.length > 0, 'filePath is a non-empty string');

  const fullPath = path.join(STORAGE_ROOT, filePath);
  let fileExists = false;
  try {
    const stat = fs.statSync(fullPath);
    fileExists = stat.size > 0;
  } catch (e) {
    // file may not exist at expected path
  }
  assert(fileExists, 'PDF file exists on disk at expected path');

  if (fileExists) {
    // Read original content
    const original = fs.readFileSync(fullPath);

    // Tamper: append some bytes to the file
    const tampered = Buffer.concat([original, Buffer.from('TAMPERED_DATA')]);
    fs.writeFileSync(fullPath, tampered);

    // === 4. Verify after tampering - should fail ===
    console.log('\nTest 4: Verify document integrity after tampering (should detect tamper)');
    const verify2 = await request('GET', `/api/pdfme/render/verify/${documentId}`, null, TOKEN);
    assert(verify2.status < 300, 'verify returns success status (even for tampered)');
    assert(verify2.body.verified === false, 'verified is false after tampering');
    assert(verify2.body.status === 'tampered', 'status is "tampered"');
    assert(verify2.body.message && verify2.body.message.includes('tamper'), 'message mentions tamper');
    assert(verify2.body.storedHash === pdfHash, 'storedHash unchanged after tampering');
    assert(verify2.body.currentHash !== pdfHash, 'currentHash differs from stored hash');
    assert(verify2.body.currentHash !== verify2.body.storedHash, 'currentHash != storedHash');

    // === 5. Restore original and re-verify ===
    console.log('\nTest 5: Restore original PDF and re-verify (should pass again)');
    fs.writeFileSync(fullPath, original);
    const verify3 = await request('GET', `/api/pdfme/render/verify/${documentId}`, null, TOKEN);
    assert(verify3.body.verified === true, 'verified is true after restore');
    assert(verify3.body.status === 'intact', 'status is "intact" after restore');
    assert(verify3.body.currentHash === pdfHash, 'currentHash matches original after restore');
  }

  // === 6. Verify non-existent document ===
  console.log('\nTest 6: Verify non-existent document');
  const verify4 = await request('GET', '/api/pdfme/render/verify/nonexistent-doc-id', null, TOKEN);
  assert(verify4.body.error === 'Document not found' || verify4.status === 404, 'non-existent doc returns error');

  // === 7. Cross-org isolation ===
  console.log('\nTest 7: Cross-org cannot verify documents');
  const verify5 = await request('GET', `/api/pdfme/render/verify/${documentId}`, null, OTHER_ORG_TOKEN);
  assert(verify5.body.error === 'Document not found' || verify5.status === 404, 'cross-org verify returns not found');

  // === 8. Render another document and verify independently ===
  console.log('\nTest 8: Second document has independent hash');
  const render2 = await renderDocument(templateId);
  assert(render2.status < 300, 'second document rendered');
  const render2Body = render2.body.document || render2.body;
  const doc2Id = render2Body.documentId || render2Body.id;
  const hash2 = render2Body.pdfHash;
  assert(typeof hash2 === 'string' && hash2.length === 64, 'second doc has valid SHA-256 hash');

  if (doc2Id) {
    const verify6 = await request('GET', `/api/pdfme/render/verify/${doc2Id}`, null, TOKEN);
    assert(verify6.body.verified === true, 'second document verifies as intact');
    assert(verify6.body.storedHash === hash2, 'second doc storedHash matches');
  } else {
    assert(false, 'second document verifies as intact');
    assert(false, 'second doc storedHash matches');
  }

  // === 9. Hash is deterministic for same content ===
  console.log('\nTest 9: Hash format validation');
  assert(/^[0-9a-f]{64}$/.test(pdfHash), 'hash is lowercase hex, 64 chars');
  assert(/^[0-9a-f]{64}$/.test(hash2), 'second hash is lowercase hex, 64 chars');

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed!');
  }
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
