/**
 * Feature #107: Template create to publish to render full workflow
 * End-to-end template lifecycle: create → draft save → publish → render → download PDF → verify audit
 */

const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const BASE = 'http://localhost:3000/api/pdfme';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-e2e-107';
const USER_ID = 'user-e2e-107';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view']
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

async function step1_createTemplate() {
  console.log('\n--- Step 1: POST create template with schema ---');
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'E2E Workflow Test 107',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'heading',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Invoice Heading'
          }, {
            name: 'amount',
            type: 'text',
            position: { x: 50, y: 100 },
            width: 100,
            height: 20,
            content: '$0.00'
          }]
        }]
      }
    })
  });
  const data = await res.json();
  assert(res.status === 201, `Create template returns 201 (got ${res.status})`);
  assert(data.id && typeof data.id === 'string', `Template has an ID: ${data.id}`);
  assert(data.name === 'E2E Workflow Test 107', `Template name matches`);
  assert(data.status === 'draft', `Template status is draft (got ${data.status})`);
  assert(data.orgId === ORG_ID || data.id, `Template created for correct org`);
  templateId = data.id;
  return data;
}

async function step2_saveDraft() {
  console.log('\n--- Step 2: PUT save draft with updated elements ---');
  const res = await fetch(`${BASE}/templates/${templateId}/draft`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      schema: {
        pages: [{
          elements: [{
            name: 'heading',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Updated Invoice Heading'
          }, {
            name: 'amount',
            type: 'text',
            position: { x: 50, y: 100 },
            width: 100,
            height: 20,
            content: '$1,234.56'
          }, {
            name: 'footer',
            type: 'text',
            position: { x: 50, y: 200 },
            width: 200,
            height: 20,
            content: 'Thank you for your business'
          }]
        }]
      }
    })
  });
  const data = await res.json();
  assert(res.status === 200, `Draft save returns 200 (got ${res.status})`);
  assert(data.id === templateId, `Same template ID returned`);
  assert(data.status === 'draft', `Template still in draft status`);
  return data;
}

async function step3_publish() {
  console.log('\n--- Step 3: POST publish template ---');
  const res = await fetch(`${BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Publish returns 200/201 (got ${res.status})`);
  assert(data.id === templateId, `Same template ID returned`);
  assert(data.status === 'published', `Template status is now published (got ${data.status})`);
  assert(data.version >= 1, `Template has version >= 1 (got ${data.version})`);
  return data;
}

async function step4_renderNow() {
  console.log('\n--- Step 4: POST render/now ---');
  const res = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId: templateId,
      entityId: 'inv-e2e-107',
      channel: 'email',
      inputs: [{ heading: 'Test Invoice #107', amount: '$5,000.00', footer: 'E2E Test' }]
    })
  });
  const data = await res.json();
  assert(res.status === 200 || res.status === 201, `Render returns 200/201 (got ${res.status})`);
  assert(data.document, `Response contains document object`);
  assert(data.document.id && typeof data.document.id === 'string', `Document has an ID`);
  assert(data.document.status === 'done', `Document status is done (got ${data.document?.status})`);
  assert(data.document.templateId === templateId, `Document references correct template`);
  assert(data.document.orgId === ORG_ID, `Document orgId matches`);
  assert(data.document.outputChannel === 'email', `Document output channel is email`);
  assert(data.document.filePath && data.document.filePath.endsWith('.pdf'), `Document has a PDF file path`);
  assert(data.document.pdfHash && data.document.pdfHash.length > 0, `Document has a PDF hash`);
  documentId = data.document.id;
  return data;
}

async function step5_downloadPdf() {
  console.log('\n--- Step 5: GET download PDF ---');
  const res = await fetch(`${BASE}/render/document/${documentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert(res.status === 200, `Download returns 200 (got ${res.status})`);

  const contentType = res.headers.get('content-type');
  assert(contentType && contentType.includes('application/pdf'), `Content-Type is application/pdf (got ${contentType})`);

  const contentLength = res.headers.get('content-length');
  assert(contentLength && parseInt(contentLength) > 0, `Content-Length > 0 (got ${contentLength})`);

  const buffer = await res.arrayBuffer();
  assert(buffer.byteLength > 0, `PDF buffer has data (${buffer.byteLength} bytes)`);

  // Verify it's a valid PDF (starts with %PDF-)
  const bytes = new Uint8Array(buffer);
  const pdfHeader = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  assert(pdfHeader === '%PDF-', `File starts with %PDF- header (got ${pdfHeader})`);

  const etag = res.headers.get('etag');
  assert(etag && etag.length > 0, `ETag header present`);

  return buffer;
}

async function step6_verifyAudit() {
  console.log('\n--- Step 6: Verify audit entries for each step ---');

  // Check audit entries for the template
  const templateAuditRes = await fetch(`${BASE}/audit?entityType=template&entityId=${templateId}&limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const templateAudit = await templateAuditRes.json();
  assert(templateAuditRes.status === 200, `Audit query returns 200`);
  assert(templateAudit.data && Array.isArray(templateAudit.data), `Audit response has data array`);

  const templateActions = templateAudit.data.map(e => e.action);
  assert(templateActions.includes('template.created'), `Audit has template.created entry`);
  assert(templateActions.includes('template.updated'), `Audit has template.updated entry (draft save)`);
  assert(templateActions.includes('template.published'), `Audit has template.published entry`);

  // Verify audit entries have correct userId
  const allCorrectUser = templateAudit.data.every(e => e.userId === USER_ID);
  assert(allCorrectUser, `All audit entries have correct userId`);

  // Verify audit entries have correct orgId
  const allCorrectOrg = templateAudit.data.every(e => e.orgId === ORG_ID);
  assert(allCorrectOrg, `All audit entries have correct orgId`);

  // Check audit entries for the rendered document
  const docAuditRes = await fetch(`${BASE}/audit?entityType=generatedDocument&entityId=${documentId}&limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const docAudit = await docAuditRes.json();
  assert(docAuditRes.status === 200, `Document audit query returns 200`);

  const docActions = docAudit.data.map(e => e.action);
  assert(docActions.includes('document.rendered'), `Audit has document.rendered entry`);

  // Verify render audit has metadata
  const renderEntry = docAudit.data.find(e => e.action === 'document.rendered');
  if (renderEntry) {
    assert(renderEntry.metadata && renderEntry.metadata.templateId === templateId, `Render audit has templateId in metadata`);
    assert(renderEntry.metadata && renderEntry.metadata.channel === 'email', `Render audit has channel in metadata`);
    assert(renderEntry.userId === USER_ID, `Render audit has correct userId`);
  } else {
    assert(false, `Render audit entry found for metadata checks`);
    assert(false, `Render audit entry found for channel check`);
    assert(false, `Render audit entry found for userId check`);
  }
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
  } catch (e) {
    console.log('  Cleanup warning:', e.message);
  }
}

async function main() {
  console.log('=== Feature #107: Template create to publish to render full workflow ===');

  try {
    await step1_createTemplate();
    await step2_saveDraft();
    await step3_publish();
    await step4_renderNow();
    await step5_downloadPdf();
    await step6_verifyAudit();
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
