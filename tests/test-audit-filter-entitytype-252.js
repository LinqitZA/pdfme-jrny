/**
 * Feature #252: Audit log filter by entityType
 *
 * Verifies that the audit log can be filtered by entity type:
 * - Create template events (entityType=template)
 * - Render events (entityType=generatedDocument)
 * - Filter by entityType=template returns only template entries
 * - Filter by entityType=generatedDocument returns only render entries
 * - No filter returns all entries
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const USER_ID = 'user-audit-252';
const ORG_ID = 'org-audit-252';
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
  console.log('Feature #252: Audit log filter by entityType\n');

  // Step 1: Create a template (generates entityType=template audit entries)
  console.log('Step 1: Create template events');
  const minimalSchema = {
    schemas: [[{ name: 'heading', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }]],
    basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  };

  const createRes = await api('POST', '/templates', { name: `Audit Filter Test 252 ${Date.now()}`, type: 'invoice', schema: minimalSchema });
  assert(createRes.status === 201, `Template created: ${createRes.status}`);
  const templateId = createRes.data?.id;
  assert(!!templateId, `Template ID received: ${templateId}`);

  // Publish the template (generates another template audit entry)
  const pubRes = await api('POST', `/templates/${templateId}/publish`);
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published: ${pubRes.status}`);

  // Step 2: Render a document (generates entityType=generatedDocument audit entries)
  console.log('\nStep 2: Create render events');
  const renderRes = await api('POST', '/render/now', {
    templateId,
    entityId: 'audit-test-entity-252',
    channel: 'email',
    inputs: [{ heading: 'Audit Test Doc' }],
  });
  assert(renderRes.status === 200 || renderRes.status === 201, `Render succeeded: ${renderRes.status}`);
  const docId = renderRes.data?.document?.id;
  assert(!!docId, `Document ID received: ${docId}`);

  // Render a second document
  const renderRes2 = await api('POST', '/render/now', {
    templateId,
    entityId: 'audit-test-entity-252-b',
    channel: 'print',
    inputs: [{ heading: 'Audit Test Doc 2' }],
  });
  assert(renderRes2.status === 200 || renderRes2.status === 201, `Second render succeeded: ${renderRes2.status}`);
  const docId2 = renderRes2.data?.document?.id;
  assert(!!docId2, `Second document ID received: ${docId2}`);

  // Small delay to ensure audit logs are written
  await new Promise(r => setTimeout(r, 500));

  // Step 3: Query audit logs WITHOUT filter - should have both types
  console.log('\nStep 3: Query audit logs without filter');
  const allRes = await api('GET', '/audit?limit=100');
  assert(allRes.status === 200, `Audit query (no filter) status: ${allRes.status}`);
  assert(Array.isArray(allRes.data?.data), 'Response has data array');

  const allEntries = allRes.data.data;
  const templateEntries = allEntries.filter(e => e.entityType === 'template');
  const docEntries = allEntries.filter(e => e.entityType === 'generatedDocument');
  assert(templateEntries.length > 0, `Has template entries: ${templateEntries.length}`);
  assert(docEntries.length > 0, `Has generatedDocument entries: ${docEntries.length}`);

  // Step 4: Filter by entityType=template
  console.log('\nStep 4: Filter by entityType=template');
  const templateRes = await api('GET', '/audit?entityType=template&limit=100');
  assert(templateRes.status === 200, `Filtered query status: ${templateRes.status}`);
  assert(Array.isArray(templateRes.data?.data), 'Response has data array');

  const filteredTemplateEntries = templateRes.data.data;
  assert(filteredTemplateEntries.length > 0, `Has template entries: ${filteredTemplateEntries.length}`);

  const allTemplate = filteredTemplateEntries.every(e => e.entityType === 'template');
  assert(allTemplate, 'All entries have entityType=template');

  const noDoc = filteredTemplateEntries.every(e => e.entityType !== 'generatedDocument');
  assert(noDoc, 'No generatedDocument entries in template filter');

  // Verify our specific template is in the results
  const ourTemplateEntries = filteredTemplateEntries.filter(e => e.entityId === templateId);
  assert(ourTemplateEntries.length >= 1, `Our template in results: ${ourTemplateEntries.length} entries`);

  // Verify template actions are correct
  const templateActions = ourTemplateEntries.map(e => e.action);
  assert(templateActions.includes('template.created'), 'Has template.created action');
  assert(templateActions.includes('template.published'), 'Has template.published action');

  // Step 5: Filter by entityType=generatedDocument
  console.log('\nStep 5: Filter by entityType=generatedDocument');
  const docRes = await api('GET', '/audit?entityType=generatedDocument&limit=100');
  assert(docRes.status === 200, `Filtered query status: ${docRes.status}`);
  assert(Array.isArray(docRes.data?.data), 'Response has data array');

  const filteredDocEntries = docRes.data.data;
  assert(filteredDocEntries.length > 0, `Has generatedDocument entries: ${filteredDocEntries.length}`);

  const allDoc = filteredDocEntries.every(e => e.entityType === 'generatedDocument');
  assert(allDoc, 'All entries have entityType=generatedDocument');

  const noTemplate = filteredDocEntries.every(e => e.entityType !== 'template');
  assert(noTemplate, 'No template entries in generatedDocument filter');

  // Verify our rendered docs are in the results
  const ourDocEntries = filteredDocEntries.filter(e => e.entityId === docId || e.entityId === docId2);
  assert(ourDocEntries.length >= 2, `Our documents in results: ${ourDocEntries.length} entries`);

  // Verify document actions
  const docActions = ourDocEntries.map(e => e.action);
  assert(docActions.every(a => a === 'document.rendered'), 'All doc entries have document.rendered action');

  // Verify metadata on render audit entries
  const docEntry = ourDocEntries.find(e => e.entityId === docId);
  if (docEntry && docEntry.metadata) {
    assert(docEntry.metadata.templateId === templateId, 'Metadata has correct templateId');
    assert(docEntry.metadata.channel === 'email', 'Metadata has correct channel');
  } else {
    assert(false, 'Document audit entry has metadata');
  }

  // Step 6: Filter by non-existent entityType - should return empty
  console.log('\nStep 6: Filter by non-existent entityType');
  const noneRes = await api('GET', '/audit?entityType=nonexistent&limit=100');
  assert(noneRes.status === 200, `Non-existent type query status: ${noneRes.status}`);
  assert(Array.isArray(noneRes.data?.data), 'Response has data array');
  assert(noneRes.data.data.length === 0, `No entries for non-existent type: ${noneRes.data.data.length}`);

  // Step 7: Pagination respects entityType filter
  console.log('\nStep 7: Pagination respects entityType filter');
  const paginatedRes = await api('GET', '/audit?entityType=template&limit=1');
  assert(paginatedRes.status === 200, `Paginated query status: ${paginatedRes.status}`);
  assert(paginatedRes.data.data.length <= 1, `Limit 1 returns at most 1: ${paginatedRes.data.data.length}`);
  assert(paginatedRes.data.data.every(e => e.entityType === 'template'), 'Paginated results still filtered');

  if (paginatedRes.data.pagination?.cursor) {
    const page2 = await api('GET', `/audit?entityType=template&limit=1&cursor=${paginatedRes.data.pagination.cursor}`);
    assert(page2.status === 200, `Page 2 status: ${page2.status}`);
    assert(page2.data.data.every(e => e.entityType === 'template'), 'Page 2 results still filtered by entityType');
  } else {
    assert(true, 'Only one page of template results (pagination not needed)');
  }

  // Step 8: Combined filter - entityType + action
  console.log('\nStep 8: Combined filter - entityType + action');
  const combinedRes = await api('GET', '/audit?entityType=template&action=template.created&limit=100');
  assert(combinedRes.status === 200, `Combined filter status: ${combinedRes.status}`);
  assert(combinedRes.data.data.every(e => e.entityType === 'template' && e.action === 'template.created'),
    'Combined filter returns only template.created entries');

  // Step 9: Combined filter - entityType + entityId
  console.log('\nStep 9: Combined filter - entityType + entityId');
  const byIdRes = await api('GET', `/audit?entityType=template&entityId=${templateId}&limit=100`);
  assert(byIdRes.status === 200, `EntityId filter status: ${byIdRes.status}`);
  assert(byIdRes.data.data.every(e => e.entityType === 'template' && e.entityId === templateId),
    'Combined entityType + entityId filter works');
  assert(byIdRes.data.data.length >= 2, `Has create+publish entries: ${byIdRes.data.data.length}`);

  // Step 10: Cleanup - archive template
  console.log('\nStep 10: Cleanup');
  await api('DELETE', `/templates/${templateId}`);
  assert(true, 'Template archived for cleanup');

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
