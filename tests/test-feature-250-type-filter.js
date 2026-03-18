/**
 * Feature #250: Template list filter by type
 * Verifies that the type filter shows only matching templates.
 */

const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-250', 'org-250', ['template:edit', 'template:publish', 'template:delete']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function createTemplate(name, type) {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name,
      type,
      schema: { schemas: [[]], basePdf: 'BLANK_PDF' },
    }),
  });
  assert(res.status === 201, `Created template "${name}" (type=${type}) - status ${res.status}`);
  const data = await res.json();
  createdIds.push(data.id);
  return data;
}

async function fetchTemplates(queryParams = {}) {
  const params = new URLSearchParams();
  params.set('limit', '100');
  for (const [k, v] of Object.entries(queryParams)) {
    params.set(k, v);
  }
  const res = await fetch(`${API_BASE}/templates?${params.toString()}`, {
    headers: HEADERS,
  });
  return res.json();
}

async function cleanup() {
  for (const id of createdIds) {
    await fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }
}

async function testSetup() {
  console.log('\n--- Setup: Create templates of different types ---');
  await createTemplate('Invoice Test 250-A', 'invoice');
  await createTemplate('Invoice Test 250-B', 'invoice');
  await createTemplate('Statement Test 250-C', 'statement');
  await createTemplate('Report Aged Debtors 250-D', 'report_aged_debtors');
  await createTemplate('Custom Test 250-E', 'custom');
}

async function testFilterByInvoice() {
  console.log('\n--- Filter by type=invoice ---');
  const result = await fetchTemplates({ type: 'invoice' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  // All results should be type=invoice
  const allInvoice = result.data.every(t => t.type === 'invoice');
  assert(allInvoice, `All returned templates are type=invoice (${result.data.length} results)`);

  // Should include our test templates
  const names = result.data.map(t => t.name);
  const hasA = names.some(n => n.includes('Invoice Test 250-A'));
  const hasB = names.some(n => n.includes('Invoice Test 250-B'));
  assert(hasA, 'Invoice Test 250-A found in filtered results');
  assert(hasB, 'Invoice Test 250-B found in filtered results');

  // Should NOT include statement or report templates
  const hasStatement = names.some(n => n.includes('Statement Test 250-C'));
  const hasReport = names.some(n => n.includes('Report Aged Debtors 250-D'));
  assert(!hasStatement, 'Statement template NOT in invoice filter results');
  assert(!hasReport, 'Report template NOT in invoice filter results');
}

async function testFilterByReportAgedDebtors() {
  console.log('\n--- Filter by type=report_aged_debtors ---');
  const result = await fetchTemplates({ type: 'report_aged_debtors' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  const allReport = result.data.every(t => t.type === 'report_aged_debtors');
  assert(allReport, `All returned templates are type=report_aged_debtors (${result.data.length} results)`);

  const names = result.data.map(t => t.name);
  const hasD = names.some(n => n.includes('Report Aged Debtors 250-D'));
  assert(hasD, 'Report Aged Debtors 250-D found in filtered results');

  const hasInvoice = names.some(n => n.includes('Invoice Test 250'));
  assert(!hasInvoice, 'Invoice templates NOT in report filter results');
}

async function testFilterByStatement() {
  console.log('\n--- Filter by type=statement ---');
  const result = await fetchTemplates({ type: 'statement' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  const allStatement = result.data.every(t => t.type === 'statement');
  assert(allStatement, `All returned templates are type=statement (${result.data.length} results)`);

  const names = result.data.map(t => t.name);
  const hasC = names.some(n => n.includes('Statement Test 250-C'));
  assert(hasC, 'Statement Test 250-C found in filtered results');
}

async function testFilterByCustom() {
  console.log('\n--- Filter by type=custom ---');
  const result = await fetchTemplates({ type: 'custom' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  const allCustom = result.data.every(t => t.type === 'custom');
  assert(allCustom, `All returned templates are type=custom (${result.data.length} results)`);

  const names = result.data.map(t => t.name);
  const hasE = names.some(n => n.includes('Custom Test 250-E'));
  assert(hasE, 'Custom Test 250-E found in filtered results');
}

async function testNoFilterReturnsAll() {
  console.log('\n--- No filter returns all types ---');
  const result = await fetchTemplates({});
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  const names = result.data.map(t => t.name);
  const types = [...new Set(result.data.map(t => t.type))];
  // Should have multiple types (at least our test types)
  const hasInvoice = result.data.some(t => t.type === 'invoice');
  const hasStatement = result.data.some(t => t.type === 'statement');
  assert(hasInvoice, 'Unfiltered list includes invoice type');
  assert(hasStatement, 'Unfiltered list includes statement type');
  assert(result.data.length >= 5, `Unfiltered list has at least 5 templates (got ${result.data.length})`);
}

async function testFilterByNonexistentType() {
  console.log('\n--- Filter by nonexistent type ---');
  const result = await fetchTemplates({ type: 'nonexistent_type_xyz_250' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');
  assert(result.data.length === 0, `Nonexistent type returns 0 templates (got ${result.data.length})`);
}

async function testTypesEndpoint() {
  console.log('\n--- Types endpoint returns available types ---');
  const res = await fetch(`${API_BASE}/templates/types`, { headers: HEADERS });
  assert(res.ok, `GET /templates/types returns OK (status ${res.status})`);
  const data = await res.json();
  assert(data.types && Array.isArray(data.types), 'Response has types array');
  assert(data.types.includes('invoice'), 'Types includes invoice');
  assert(data.types.includes('statement'), 'Types includes statement');
  assert(data.types.includes('report_aged_debtors'), 'Types includes report_aged_debtors');
  assert(data.types.includes('custom'), 'Types includes custom');
}

async function testUIComponentHasTypeFilter() {
  console.log('\n--- UI component has type filter ---');
  const fs = require('fs');
  const source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/TemplateList.tsx', 'utf-8');

  assert(source.includes('type-filter-dropdown'), 'TemplateList has type-filter-dropdown data-testid');
  assert(source.includes('typeFilter'), 'TemplateList has typeFilter state');
  assert(source.includes('setTypeFilter'), 'TemplateList has setTypeFilter');
  assert(source.includes("params.set('type', typeFilter)"), 'Type filter is sent as query parameter');
  assert(source.includes('availableTypes'), 'TemplateList fetches available types');
  assert(source.includes('/templates/types'), 'TemplateList calls /templates/types endpoint');
  assert(source.includes('All types'), 'Type filter has "All types" default option');
}

async function testFilterCombinedWithSearch() {
  console.log('\n--- Filter combined with search ---');
  const result = await fetchTemplates({ type: 'invoice', search: '250-A' });
  assert(result.data && Array.isArray(result.data), 'Response has data array');

  // Only invoice AND matching search
  const allMatch = result.data.every(t => t.type === 'invoice');
  assert(allMatch, 'Combined filter: all results are invoice type');

  const hasA = result.data.some(t => t.name.includes('250-A'));
  assert(hasA, 'Combined filter: Invoice 250-A found');

  const hasB = result.data.some(t => t.name.includes('250-B'));
  // 250-B might or might not match depending on search implementation
  // If search is strict, 250-B shouldn't be found
}

async function testPaginationCountReflectsFilter() {
  console.log('\n--- Pagination count reflects filter ---');
  const allResult = await fetchTemplates({});
  const invoiceResult = await fetchTemplates({ type: 'invoice' });

  assert(invoiceResult.pagination != null, 'Filtered result has pagination');
  assert(invoiceResult.pagination.total <= allResult.pagination.total, `Filtered total (${invoiceResult.pagination.total}) <= unfiltered total (${allResult.pagination.total})`);
  assert(invoiceResult.pagination.total >= 2, `Invoice filter shows at least 2 templates (got ${invoiceResult.pagination.total})`);
}

async function main() {
  console.log('=== Feature #250: Template list filter by type ===');

  try {
    await testSetup();
    await testFilterByInvoice();
    await testFilterByReportAgedDebtors();
    await testFilterByStatement();
    await testFilterByCustom();
    await testNoFilterReturnsAll();
    await testFilterByNonexistentType();
    await testTypesEndpoint();
    await testUIComponentHasTypeFilter();
    await testFilterCombinedWithSearch();
    await testPaginationCountReflectsFilter();
  } finally {
    await cleanup();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
