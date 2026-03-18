/**
 * Feature #203: Render result cached for download
 *
 * Verifies that a generated PDF can be downloaded multiple times
 * without re-rendering. The same PDF content is returned each time.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const ORG_ID = 'test-org-203';
const USER = 'user-203';
const TOKEN = makeJwt(USER, ORG_ID);

let templateId = null;
let documentId = null;

async function setup() {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      name: 'Cache Test 203',
      type: 'invoice',
      schema: {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        schemas: [[
          { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 10, content: 'Cache Test Document' }
        ]],
      },
    }),
  });
  const data = await res.json();
  templateId = data.id;
  console.log(`Created template: ${templateId}`);

  const pubRes = await fetch(`${API_BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const pubData = await pubRes.json();
  console.log(`Published: status=${pubData.status}`);
}

async function cleanup() {
  if (templateId) {
    await fetch(`${API_BASE}/templates/${templateId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
  }
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

async function test_generate_document() {
  console.log('\nTest: Generate a document via render/now');
  const res = await fetch(`${API_BASE}/render/now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify({
      templateId,
      entityId: 'entity-cache-203',
      channel: 'email',
    }),
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Render succeeded (status ${res.status})`);
  assert(data.document && data.document.id, `Document ID returned: ${data.document?.id}`);
  assert(data.document?.status === 'done', `Document status is done`);
  assert(data.document?.filePath, `Document has filePath: ${data.document?.filePath}`);
  assert(data.document?.pdfHash, `Document has pdfHash`);
  documentId = data.document?.id;
}

async function test_first_download() {
  console.log('\nTest: First download of generated PDF');
  const res = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(res.status === 200, `Download returns 200 (got ${res.status})`);
  const contentType = res.headers.get('content-type');
  assert(contentType && contentType.includes('application/pdf'), `Content-Type is application/pdf`);
  const buffer = await res.arrayBuffer();
  assert(buffer.byteLength > 0, `PDF has content (${buffer.byteLength} bytes)`);
  const etag = res.headers.get('etag');
  assert(etag && etag.length > 0, `ETag header present: ${etag}`);
  return { buffer: Buffer.from(buffer), etag };
}

async function test_second_download(firstResult) {
  console.log('\nTest: Second download returns same PDF (cached, no re-render)');
  const res = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(res.status === 200, `Second download returns 200`);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert(buffer.byteLength === firstResult.buffer.byteLength, `Same size: ${buffer.byteLength} === ${firstResult.buffer.byteLength}`);
  assert(buffer.equals(firstResult.buffer), 'PDF content is identical (byte-for-byte)');
  const etag = res.headers.get('etag');
  assert(etag === firstResult.etag, `Same ETag: ${etag} === ${firstResult.etag}`);
}

async function test_third_download(firstResult) {
  console.log('\nTest: Third download also returns same cached PDF');
  const res = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(res.status === 200, `Third download returns 200`);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert(buffer.equals(firstResult.buffer), 'Third download PDF is identical');
}

async function test_nonexistent_document() {
  console.log('\nTest: Download nonexistent document returns 404');
  const res = await fetch(`${API_BASE}/render/document/nonexistent-id-xyz`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  assert(res.status === 404, `Nonexistent returns 404 (got ${res.status})`);
}

async function test_no_rerender_triggered() {
  console.log('\nTest: Verify no re-render triggered (same hash on repeated downloads)');
  const res1 = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const etag1 = res1.headers.get('etag');
  await res1.arrayBuffer();

  const res2 = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const etag2 = res2.headers.get('etag');
  await res2.arrayBuffer();

  assert(etag1 === etag2, `ETags match across downloads (no re-render): ${etag1}`);
}

async function test_verify_document_integrity() {
  console.log('\nTest: Verify document integrity matches cached version');
  const verifyRes = await fetch(`${API_BASE}/render/verify/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const verifyData = await verifyRes.json();
  assert(verifyData.verified === true, 'Document integrity verified');
  assert(verifyData.status === 'intact', 'Document status is intact');

  const downloadRes = await fetch(`${API_BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const etag = downloadRes.headers.get('etag');
  await downloadRes.arrayBuffer();
  assert(etag === `"${verifyData.storedHash}"`, 'Download ETag matches stored hash');
}

async function run() {
  console.log('=== Feature #203: Render result cached for download ===');

  try {
    await setup();

    await test_generate_document();
    const firstResult = await test_first_download();
    await test_second_download(firstResult);
    await test_third_download(firstResult);
    await test_nonexistent_document();
    await test_no_rerender_triggered();
    await test_verify_document_integrity();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
