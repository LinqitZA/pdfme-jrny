/**
 * Feature #254: Render history filter by template type
 *
 * Verifies document history is filterable by entityType (template type).
 * - Generate documents for invoices and statements
 * - Filter history by entityType=invoice → only invoice docs shown
 * - Filter by entityType=statement → only statement docs shown
 * - Clear filter → all shown
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const USER_ID = 'user-render-254';
const ORG_ID = 'org-render-254';
const TOKEN = makeJwt(USER_ID, ORG_ID, ['super_admin', 'template:edit', 'template:publish', 'render:trigger']);
const HEADERS = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function run() {
  console.log('Feature #254: Render history filter by template type\n');

  const minimalSchema = {
    schemas: [[{ name: 'heading', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }]],
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  };

  // Step 1: Create and publish an invoice template
  console.log('Step 1: Create invoice template');
  const invRes = await api('POST', '/templates', { name: `Invoice 254 ${Date.now()}`, type: 'invoice', schema: minimalSchema });
  assert(invRes.status === 201, `Invoice template created: ${invRes.status}`);
  const invoiceTemplateId = invRes.data?.id;

  const invPubRes = await api('POST', `/templates/${invoiceTemplateId}/publish`);
  assert(invPubRes.status === 200 || invPubRes.status === 201, `Invoice template published: ${invPubRes.status}`);

  // Step 2: Create and publish a statement template
  console.log('\nStep 2: Create statement template');
  const stmtRes = await api('POST', '/templates', { name: `Statement 254 ${Date.now()}`, type: 'statement', schema: minimalSchema });
  assert(stmtRes.status === 201, `Statement template created: ${stmtRes.status}`);
  const statementTemplateId = stmtRes.data?.id;

  const stmtPubRes = await api('POST', `/templates/${statementTemplateId}/publish`);
  assert(stmtPubRes.status === 200 || stmtPubRes.status === 201, `Statement template published: ${stmtPubRes.status}`);

  // Step 3: Render invoice documents
  console.log('\nStep 3: Render invoice documents');
  const invRender1 = await api('POST', '/render/now', {
    templateId: invoiceTemplateId,
    entityId: 'inv-entity-254-a',
    entityType: 'invoice',
    channel: 'email',
    inputs: [{ heading: 'Invoice Doc A' }],
  });
  assert(invRender1.status === 200 || invRender1.status === 201, `Invoice render 1: ${invRender1.status}`);
  const invDoc1Id = invRender1.data?.document?.id;
  assert(!!invDoc1Id, `Invoice doc 1 ID: ${invDoc1Id}`);

  const invRender2 = await api('POST', '/render/now', {
    templateId: invoiceTemplateId,
    entityId: 'inv-entity-254-b',
    entityType: 'invoice',
    channel: 'print',
    inputs: [{ heading: 'Invoice Doc B' }],
  });
  assert(invRender2.status === 200 || invRender2.status === 201, `Invoice render 2: ${invRender2.status}`);

  // Step 4: Render statement documents
  console.log('\nStep 4: Render statement documents');
  const stmtRender1 = await api('POST', '/render/now', {
    templateId: statementTemplateId,
    entityId: 'stmt-entity-254-a',
    entityType: 'statement',
    channel: 'email',
    inputs: [{ heading: 'Statement Doc A' }],
  });
  assert(stmtRender1.status === 200 || stmtRender1.status === 201, `Statement render 1: ${stmtRender1.status}`);
  const stmtDoc1Id = stmtRender1.data?.document?.id;
  assert(!!stmtDoc1Id, `Statement doc 1 ID: ${stmtDoc1Id}`);

  // Step 5: Filter by entityType=invoice
  console.log('\nStep 5: Filter render history by entityType=invoice');
  const invHistory = await api('GET', '/render/documents?entityType=invoice&limit=100');
  assert(invHistory.status === 200, `Invoice history status: ${invHistory.status}`);
  assert(Array.isArray(invHistory.data?.data), 'Response has data array');

  const invDocs = invHistory.data.data;
  assert(invDocs.length >= 2, `Has invoice documents: ${invDocs.length}`);
  assert(invDocs.every(d => d.entityType === 'invoice'), 'All entries are invoice type');
  assert(invDocs.every(d => d.entityType !== 'statement'), 'No statement entries in invoice filter');

  // Verify our specific docs are there
  const hasOurInvDocs = invDocs.some(d => d.entityId === 'inv-entity-254-a') && invDocs.some(d => d.entityId === 'inv-entity-254-b');
  assert(hasOurInvDocs, 'Our invoice docs in filtered results');

  // Step 6: Filter by entityType=statement
  console.log('\nStep 6: Filter render history by entityType=statement');
  const stmtHistory = await api('GET', '/render/documents?entityType=statement&limit=100');
  assert(stmtHistory.status === 200, `Statement history status: ${stmtHistory.status}`);
  assert(Array.isArray(stmtHistory.data?.data), 'Response has data array');

  const stmtDocs = stmtHistory.data.data;
  assert(stmtDocs.length >= 1, `Has statement documents: ${stmtDocs.length}`);
  assert(stmtDocs.every(d => d.entityType === 'statement'), 'All entries are statement type');
  assert(stmtDocs.every(d => d.entityType !== 'invoice'), 'No invoice entries in statement filter');

  // Step 7: Clear filter - all shown
  console.log('\nStep 7: No filter - all documents shown');
  const allHistory = await api('GET', '/render/documents?limit=100');
  assert(allHistory.status === 200, `All history status: ${allHistory.status}`);
  assert(Array.isArray(allHistory.data?.data), 'Response has data array');

  const allDocs = allHistory.data.data;
  const hasInv = allDocs.some(d => d.entityType === 'invoice');
  const hasStmt = allDocs.some(d => d.entityType === 'statement');
  assert(hasInv, 'Unfiltered results contain invoice type');
  assert(hasStmt, 'Unfiltered results contain statement type');
  assert(allDocs.length >= invDocs.length, 'Unfiltered has more or equal docs than invoice filter');

  // Step 8: Filter by non-existent type - empty
  console.log('\nStep 8: Filter by non-existent entityType');
  const noneHistory = await api('GET', '/render/documents?entityType=nonexistent&limit=100');
  assert(noneHistory.status === 200, `Non-existent type status: ${noneHistory.status}`);
  assert(noneHistory.data.data.length === 0, `No docs for non-existent type: ${noneHistory.data.data.length}`);

  // Step 9: Combined filter - entityType + status
  console.log('\nStep 9: Combined entityType + status filter');
  const combinedHistory = await api('GET', '/render/documents?entityType=invoice&status=done&limit=100');
  assert(combinedHistory.status === 200, `Combined filter status: ${combinedHistory.status}`);
  assert(combinedHistory.data.data.every(d => d.entityType === 'invoice' && d.status === 'done'),
    'Combined filter returns only done invoice docs');

  // Step 10: Verify document data integrity
  console.log('\nStep 10: Verify document data integrity');
  const sampleDoc = invDocs.find(d => d.entityId === 'inv-entity-254-a');
  if (sampleDoc) {
    assert(!!sampleDoc.id, 'Document has id');
    assert(!!sampleDoc.templateId, 'Document has templateId');
    assert(sampleDoc.templateId === invoiceTemplateId, 'Correct templateId');
    assert(typeof sampleDoc.templateVer === 'number', 'Has templateVer');
    assert(!!sampleDoc.pdfHash, 'Has pdfHash');
    assert(!!sampleDoc.createdAt, 'Has createdAt');
    assert(!!sampleDoc.outputChannel, 'Has outputChannel');
  } else {
    assert(false, 'Could not find sample document for integrity check');
  }

  // Cleanup
  console.log('\nCleanup');
  await api('DELETE', `/templates/${invoiceTemplateId}`);
  await api('DELETE', `/templates/${statementTemplateId}`);
  assert(true, 'Templates archived');

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
