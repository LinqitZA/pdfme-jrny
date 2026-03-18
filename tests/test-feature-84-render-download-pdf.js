/**
 * Feature #84: Render download streams PDF binary
 * GET download/:documentId returns PDF file with correct headers
 */

const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-dl-84';
const USER_ID = 'user-dl-84';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger']
});

const OTHER_TOKEN = signJwt({
  sub: 'user-other-84',
  orgId: 'org-other-84',
  roles: ['render:trigger']
});

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

let passed = 0;
let failed = 0;
let templateId = null;
let documentId = null;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function setup() {
  console.log('\n--- Setup: Create, publish, and render a template ---');

  // Create template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Download Test 84',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'title',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Download Test Invoice'
          }]
        }]
      }
    })
  });
  const tmpl = await createRes.json();
  templateId = tmpl.id;
  assert(createRes.status === 201, `Template created (${tmpl.id})`);

  // Publish
  const pubRes = await fetch(`${BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers
  });
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published`);

  // Render
  const renderRes = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'inv-dl-84',
      channel: 'print'
    })
  });
  const renderData = await renderRes.json();
  assert(renderRes.status === 200 || renderRes.status === 201, `Document rendered`);
  assert(renderData.document && renderData.document.id, `Document has ID`);
  documentId = renderData.document.id;
}

async function test1_downloadReturnsPdf() {
  console.log('\n--- Test 1: GET download returns PDF binary ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(res.status === 200, `Download returns 200 (got ${res.status})`);

  const contentType = res.headers.get('content-type');
  assert(contentType === 'application/pdf', `Content-Type is application/pdf (got ${contentType})`);

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  assert(bytes.length > 0, `Response body has data (${bytes.length} bytes)`);

  // Check PDF magic bytes
  const pdfHeader = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  assert(pdfHeader === '%PDF-', `Binary starts with %PDF- header`);

  // Check PDF version
  const pdfVersion = String.fromCharCode(...bytes.slice(0, 8));
  assert(pdfVersion.startsWith('%PDF-1.') || pdfVersion.startsWith('%PDF-2.'), `Valid PDF version: ${pdfVersion.trim()}`);
}

async function test2_responseHeaders() {
  console.log('\n--- Test 2: Response has correct headers ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const contentType = res.headers.get('content-type');
  assert(contentType && contentType.includes('application/pdf'), `Content-Type includes application/pdf`);

  const contentDisposition = res.headers.get('content-disposition');
  assert(contentDisposition && contentDisposition.includes('filename'), `Content-Disposition has filename`);

  const contentLength = res.headers.get('content-length');
  assert(contentLength && parseInt(contentLength) > 0, `Content-Length > 0 (${contentLength})`);

  const etag = res.headers.get('etag');
  assert(etag && etag.length > 0, `ETag header present (${etag})`);
}

async function test3_pdfStructure() {
  console.log('\n--- Test 3: Valid PDF binary structure ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check PDF header
  assert(bytes[0] === 0x25, `First byte is % (0x25)`); // %
  assert(bytes[1] === 0x50, `Second byte is P (0x50)`); // P
  assert(bytes[2] === 0x44, `Third byte is D (0x44)`); // D
  assert(bytes[3] === 0x46, `Fourth byte is F (0x46)`); // F

  // Check PDF contains typical structure markers
  const text = new TextDecoder().decode(bytes);
  assert(text.includes('obj'), `PDF contains object definitions`);
  assert(text.includes('endobj'), `PDF contains endobj markers`);
  assert(text.includes('%%EOF') || text.includes('startxref'), `PDF contains EOF or xref marker`);

  // Size should be reasonable for a simple document
  assert(bytes.length > 100, `PDF is larger than 100 bytes (${bytes.length})`);
  assert(bytes.length < 10000000, `PDF is smaller than 10MB (${bytes.length})`);
}

async function test4_nonExistentDocument() {
  console.log('\n--- Test 4: Non-existent document returns error ---');
  const res = await fetch(`${BASE}/render/document/nonexistent-doc-id-xyz`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(res.status === 404, `Non-existent document returns 404 (got ${res.status})`);
}

async function test5_noAuth() {
  console.log('\n--- Test 5: No auth returns 401 ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`);
  assert(res.status === 401, `No auth returns 401 (got ${res.status})`);
}

async function test6_crossOrg() {
  console.log('\n--- Test 6: Cross-org download blocked ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${OTHER_TOKEN}` }
  });
  assert(res.status === 404 || res.status === 403, `Cross-org returns 404 or 403 (got ${res.status})`);
}

async function test7_multipleDownloads() {
  console.log('\n--- Test 7: Multiple downloads return consistent data ---');
  const res1 = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const buf1 = await res1.arrayBuffer();

  const res2 = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const buf2 = await res2.arrayBuffer();

  assert(buf1.byteLength === buf2.byteLength, `Both downloads have same size (${buf1.byteLength})`);

  const etag1 = res1.headers.get('etag');
  const etag2 = res2.headers.get('etag');
  assert(etag1 === etag2, `ETags match across downloads`);
}

async function cleanup() {
  console.log('\n--- Cleanup ---');
  try {
    if (templateId) {
      await fetch(`${BASE}/templates/${templateId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('  Cleaned up template');
    }
  } catch (e) {}
}

async function main() {
  console.log('=== Feature #84: Render download streams PDF binary ===');

  try {
    await setup();
    await test1_downloadReturnsPdf();
    await test2_responseHeaders();
    await test3_pdfStructure();
    await test4_nonExistentDocument();
    await test5_noAuth();
    await test6_crossOrg();
    await test7_multipleDownloads();
  } catch (err) {
    console.error('\n💥 Fatal error:', err.message);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
