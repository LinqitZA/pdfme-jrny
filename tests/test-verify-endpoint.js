/**
 * Test script for Feature #146: Render verify endpoint checks hash
 *
 * Tests:
 * 1. Generate a document via render/now
 * 2. GET verify/:documentId — integrity confirmed (hash matches)
 * 3. Modify PDF on disk (tamper)
 * 4. GET verify again — tamper detected
 * 5. GET verify with non-existent ID — 404
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.API_BASE || 'http://localhost:3001';
let PASS = 0;
let FAIL = 0;

// Build dev JWT token (no signature verification in dev mode)
function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-verify-test', 'org-verify-test', [
  'template:edit', 'template:publish', 'render:trigger'
]);

function assert(desc, condition) {
  if (condition) {
    PASS++;
    console.log('  PASS:', desc);
  } else {
    FAIL++;
    console.log('  FAIL:', desc);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Feature #146: Render verify endpoint checks hash ===\n');

  // Step 1: Create a template
  console.log('Step 1: Create template...');
  const createResp = await request('POST', '/api/pdfme/templates', {
    type: 'invoice',
    name: 'Verify Test Template',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[{ name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 100, height: 10 }]],
    },
  });
  const templateId = createResp.body.id;
  console.log('  Template ID:', templateId);

  // Step 2: Publish template
  console.log('Step 2: Publish template...');
  const pubResp = await request('POST', '/api/pdfme/templates/' + templateId + '/publish');
  console.log('  Publish status:', pubResp.status, pubResp.body?.status || '');

  // Step 3: Render a document
  console.log('Step 3: Render document...');
  const renderResp = await request('POST', '/api/pdfme/render/now', {
    templateId,
    entityId: 'entity-verify-001',
    channel: 'email',
    inputs: [{ title: 'Verify Test Document' }],
  });

  if (!renderResp.body.document) {
    console.log('  ERROR: Render failed:', JSON.stringify(renderResp.body));
    process.exit(1);
  }

  const doc = renderResp.body.document;
  console.log('  Document ID:', doc.id);
  console.log('  PDF Hash:', doc.pdfHash.substring(0, 16) + '...');
  console.log('  File path:', doc.filePath);

  // Step 4: Verify integrity (should pass)
  console.log('\nStep 4: GET verify/:documentId — integrity should be confirmed...');
  const verifyResp = await request('GET', '/api/pdfme/render/verify/' + doc.id);
  console.log('  Status:', verifyResp.status);
  console.log('  Response:', JSON.stringify(verifyResp.body));

  assert('HTTP 200', verifyResp.status === 200);
  assert('verified = true', verifyResp.body.verified === true);
  assert('status = intact', verifyResp.body.status === 'intact');
  assert('message contains "integrity confirmed"',
    verifyResp.body.message && verifyResp.body.message.includes('integrity confirmed'));
  assert('storedHash present', !!verifyResp.body.storedHash);
  assert('currentHash present', !!verifyResp.body.currentHash);
  assert('storedHash === currentHash', verifyResp.body.storedHash === verifyResp.body.currentHash);

  // Step 5: Tamper with PDF on disk
  console.log('\nStep 5: Modify PDF on disk (tamper)...');
  const storageRoot = path.join(__dirname, '..', 'storage');
  const fullPath = path.join(storageRoot, doc.filePath);
  console.log('  Tampering with:', fullPath);
  fs.appendFileSync(fullPath, 'TAMPERED_DATA_12345');

  // Step 6: Verify integrity again (should detect tamper)
  console.log('\nStep 6: GET verify/:documentId — should detect tamper...');
  const verifyResp2 = await request('GET', '/api/pdfme/render/verify/' + doc.id);
  console.log('  Status:', verifyResp2.status);
  console.log('  Response:', JSON.stringify(verifyResp2.body));

  assert('HTTP 200', verifyResp2.status === 200);
  assert('verified = false after tamper', verifyResp2.body.verified === false);
  assert('status = tampered', verifyResp2.body.status === 'tampered');
  assert('message contains "tamper detected"',
    verifyResp2.body.message && verifyResp2.body.message.includes('tamper detected'));
  assert('storedHash !== currentHash', verifyResp2.body.storedHash !== verifyResp2.body.currentHash);

  // Step 7: Verify non-existent document returns 404
  console.log('\nStep 7: GET verify with non-existent ID — should return 404...');
  const verify404 = await request('GET', '/api/pdfme/render/verify/non-existent-id-12345');
  console.log('  Status:', verify404.status);
  assert('404 for non-existent document', verify404.status === 404);

  // Step 8: Verify with no auth returns 401
  console.log('\nStep 8: Verify without auth — should return 401...');
  const noAuthResp = await new Promise((resolve, reject) => {
    const url = new URL('/api/pdfme/render/verify/' + doc.id, BASE_URL);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
  assert('401 without auth', noAuthResp.status === 401);

  // Summary
  console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===');
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
