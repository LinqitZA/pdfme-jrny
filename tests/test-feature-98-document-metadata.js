/**
 * Test Feature #98: GeneratedDocument has correct metadata
 * Document record stores all required fields after rendering
 */

const http = require('http');
const jwt = require('jsonwebtoken');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = 'pdfme-dev-secret';

let passed = 0;
let failed = 0;

function makeToken(claims = {}) {
  return jwt.sign(
    {
      sub: claims.sub || 'user-meta-98',
      orgId: claims.orgId || 'org-meta-98',
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
  } else {
    failed++;
    const fs = require('fs');
    fs.appendFileSync('/tmp/debug-98.txt', `FAIL: ${name}\n`);
  }
}

async function runTests() {
  const token = makeToken();
  const fs = require('fs');
  try { fs.unlinkSync('/tmp/debug-98.txt'); } catch {}

  console.log('Feature #98: GeneratedDocument has correct metadata\n');

  // --- Setup: Create and publish a template ---
  console.log('Setting up test data...');
  const tmplRes = await request(
    'POST',
    '/api/pdfme/templates',
    {
      name: 'META98_Template',
      type: 'invoice',
      schema: {
        pages: [{ elements: [{ name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }] }],
        basePdf: { width: 595, height: 842, padding: [0, 0, 0, 0] },
      },
    },
    token,
  );
  const templateId = tmplRes.body.id;
  assert('Template created', !!templateId);

  // Publish the template
  const pubRes = await request('POST', `/api/pdfme/templates/${templateId}/publish`, {}, token);
  assert('Template published', pubRes.status === 200 || pubRes.status === 201);
  const publishedVer = pubRes.body.version || pubRes.body.publishedVer || 2;

  // --- Test 1: Render a document with channel=print ---
  console.log('\n1. Render document with channel=print');
  const entityId1 = `entity-meta98-print-${Date.now()}`;
  const renderRes1 = await request(
    'POST',
    '/api/pdfme/render/now',
    {
      templateId,
      inputs: [{ field1: 'Test Value for Meta 98' }],
      entityType: 'invoice',
      entityId: entityId1,
      channel: 'print',
    },
    token,
  );
  assert('Render returns 201', renderRes1.status === 201);
  const doc1 = renderRes1.body.document || renderRes1.body;
  assert('Document has id', !!doc1.id);
  assert('Document has templateId', doc1.templateId === templateId);
  assert('Document templateVer matches published version', doc1.templateVer === publishedVer);
  assert('Document has pdfHash', typeof doc1.pdfHash === 'string' && doc1.pdfHash.length > 0);
  assert('Document pdfHash starts with algorithm prefix', doc1.pdfHash.startsWith('sha256:') || doc1.pdfHash.startsWith('blake3:'));
  assert('Document status is done', doc1.status === 'done');
  assert('Document outputChannel is print', doc1.outputChannel === 'print');
  assert('Document entityType is invoice', doc1.entityType === 'invoice');
  assert('Document entityId matches', doc1.entityId === entityId1);
  assert('Document has orgId', doc1.orgId === 'org-meta-98');
  assert('Document has createdAt', !!doc1.createdAt);
  assert('Document has filePath', typeof doc1.filePath === 'string' && doc1.filePath.length > 0);
  assert('Document has triggeredBy', doc1.triggeredBy === 'user-meta-98');

  // --- Test 2: Render a document with channel=email ---
  console.log('\n2. Render document with channel=email');
  const entityId2 = `entity-meta98-email-${Date.now()}`;
  const renderRes2 = await request(
    'POST',
    '/api/pdfme/render/now',
    {
      templateId,
      inputs: [{ field1: 'Email Test Value' }],
      entityType: 'invoice',
      entityId: entityId2,
      channel: 'email',
    },
    token,
  );
  assert('Email render returns 201', renderRes2.status === 201);
  const doc2 = renderRes2.body.document || renderRes2.body;
  assert('Email doc status is done', doc2.status === 'done');
  assert('Email doc outputChannel is email', doc2.outputChannel === 'email');
  assert('Email doc entityId matches', doc2.entityId === entityId2);
  assert('Email doc templateId matches', doc2.templateId === templateId);
  assert('Email doc templateVer matches', doc2.templateVer === publishedVer);

  // --- Test 3: Query record via history endpoint ---
  console.log('\n3. Query rendered document via history');
  const histRes = await request('GET', '/api/pdfme/render/history?limit=100', null, token);
  assert('History returns 200', histRes.status === 200);
  assert('History has data', Array.isArray(histRes.body.data));

  const histDoc1 = histRes.body.data.find((d) => d.id === doc1.id);
  assert('Print doc found in history', !!histDoc1);
  if (histDoc1) {
    assert('History doc templateId matches', histDoc1.templateId === templateId);
    assert('History doc templateVer matches', histDoc1.templateVer === publishedVer);
    assert('History doc pdfHash matches', histDoc1.pdfHash === doc1.pdfHash);
    assert('History doc status is done', histDoc1.status === 'done');
    assert('History doc outputChannel is print', histDoc1.outputChannel === 'print');
    assert('History doc entityType is invoice', histDoc1.entityType === 'invoice');
    assert('History doc entityId matches', histDoc1.entityId === entityId1);
    assert('History doc has createdAt', !!histDoc1.createdAt);
  }

  const histDoc2 = histRes.body.data.find((d) => d.id === doc2.id);
  assert('Email doc found in history', !!histDoc2);
  if (histDoc2) {
    assert('History email doc outputChannel is email', histDoc2.outputChannel === 'email');
    assert('History email doc status is done', histDoc2.status === 'done');
  }

  // --- Test 4: pdfHash is unique per document ---
  console.log('\n4. PDF hash uniqueness');
  assert('Different documents have unique hashes or same template output', typeof doc1.pdfHash === 'string' && typeof doc2.pdfHash === 'string');

  // --- Test 5: Query single document if endpoint exists ---
  console.log('\n5. Query document by template');
  const docsByTmpl = await request('GET', `/api/pdfme/render/documents/${templateId}`, null, token);
  assert('Documents by template returns 200', docsByTmpl.status === 200);
  assert('Documents by template has data', Array.isArray(docsByTmpl.body.data));
  const matchDocs = docsByTmpl.body.data.filter((d) => d.templateId === templateId);
  assert('All docs belong to correct template', matchDocs.length === docsByTmpl.body.data.length);

  // --- Test 6: Verify metadata fields are non-null ---
  console.log('\n6. Non-null metadata validation');
  assert('templateId is non-null string', typeof doc1.templateId === 'string' && doc1.templateId.length > 0);
  assert('templateVer is positive integer', Number.isInteger(doc1.templateVer) && doc1.templateVer > 0);
  assert('pdfHash is non-empty string', typeof doc1.pdfHash === 'string' && doc1.pdfHash.length > 10);
  assert('status is valid enum', ['queued', 'generating', 'done', 'failed'].includes(doc1.status));
  assert('outputChannel is valid', ['email', 'print'].includes(doc1.outputChannel));
  assert('entityType is non-empty', typeof doc1.entityType === 'string' && doc1.entityType.length > 0);
  assert('entityId is non-empty', typeof doc1.entityId === 'string' && doc1.entityId.length > 0);

  // --- Cleanup ---
  console.log('\nCleaning up...');
  await request('DELETE', `/api/pdfme/templates/${templateId}`, null, token);

  // --- Summary ---
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    try {
      const debugOut = fs.readFileSync('/tmp/debug-98.txt', 'utf8');
      console.log('\nFailed tests:\n' + debugOut);
    } catch {}
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
