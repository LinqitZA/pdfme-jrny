/**
 * Test Feature #183: Filter and sort with real database data
 *
 * Steps:
 * 1. Create 50 templates of various types
 * 2. Filter by type=invoice - verify server returns only invoices
 * 3. Sort by createdAt - verify order matches database
 * 4. Filter by status
 * 5. Sort by name ASC
 */

const BASE = 'http://localhost:3000/api/pdfme';

function makeToken(sub, orgId, roles = ['template:edit', 'template:publish']) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return `${header}.${payload}.testsig`;
}

const ORG_ID = 'org-test-183';
const USER_ID = 'user-test-183';
const TOKEN = makeToken(USER_ID, ORG_ID);
const AUTH = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

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

const TYPES = ['invoice', 'statement', 'purchase_order', 'delivery_note', 'credit_note'];

async function createTemplate(name, type) {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      name,
      type,
      schema: { pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: name }] }] },
    }),
  });
  return res.json();
}

async function run() {
  console.log('\n=== Feature #183: Filter and sort with real database data ===\n');

  // Step 1: Create 50 templates of various types
  console.log('Step 1: Create 50 templates of various types');
  const created = [];
  const promises = [];
  for (let i = 0; i < 50; i++) {
    const type = TYPES[i % TYPES.length];
    const name = `Test183_${type}_${String(i).padStart(3, '0')}`;
    promises.push(createTemplate(name, type));
  }
  const results = await Promise.all(promises);
  created.push(...results);
  assert(created.length === 50, `Created ${created.length} templates`);
  assert(created.every(t => t.id), 'All templates have IDs');

  // Count by type
  const invoiceCount = created.filter(t => t.type === 'invoice').length;
  const statementCount = created.filter(t => t.type === 'statement').length;
  console.log(`  Types: invoice=${invoiceCount}, statement=${statementCount}, others=${50 - invoiceCount - statementCount}`);
  assert(invoiceCount === 10, `10 invoices created`);
  assert(statementCount === 10, `10 statements created`);

  // Step 2: Filter by type=invoice
  console.log('\nStep 2: Filter by type=invoice');
  const invoiceRes = await fetch(`${BASE}/templates?type=invoice&limit=100`, { headers: AUTH });
  const invoiceData = await invoiceRes.json();
  assert(invoiceRes.status === 200, 'Filter returns 200');

  // Filter to only our org's templates
  const orgInvoices = invoiceData.data.filter(t => t.orgId === ORG_ID && t.name.startsWith('Test183_'));
  assert(orgInvoices.length === 10, `Got ${orgInvoices.length} invoices for our test (expected 10)`);
  assert(orgInvoices.every(t => t.type === 'invoice'), 'All returned templates are invoices');
  assert(orgInvoices.every(t => t.type !== 'statement'), 'No statements in invoice filter');
  assert(orgInvoices.every(t => t.type !== 'purchase_order'), 'No purchase_orders in invoice filter');

  // Step 3: Filter by type=statement
  console.log('\nStep 3: Filter by type=statement');
  const stmtRes = await fetch(`${BASE}/templates?type=statement&limit=100`, { headers: AUTH });
  const stmtData = await stmtRes.json();
  const orgStmts = stmtData.data.filter(t => t.orgId === ORG_ID && t.name.startsWith('Test183_'));
  assert(orgStmts.length === 10, `Got ${orgStmts.length} statements (expected 10)`);
  assert(orgStmts.every(t => t.type === 'statement'), 'All returned templates are statements');

  // Step 4: Sort by createdAt DESC (default)
  console.log('\nStep 4: Sort by createdAt DESC (default)');
  const defaultSortRes = await fetch(`${BASE}/templates?limit=100`, { headers: AUTH });
  const defaultSortData = await defaultSortRes.json();
  const testTemplates = defaultSortData.data.filter(t => t.orgId === ORG_ID && t.name.startsWith('Test183_'));
  assert(testTemplates.length >= 50, `Got ${testTemplates.length} test templates`);

  // Check that results are sorted by createdAt DESC
  let sortedDesc = true;
  for (let i = 1; i < testTemplates.length; i++) {
    if (new Date(testTemplates[i].createdAt) > new Date(testTemplates[i - 1].createdAt)) {
      sortedDesc = false;
      break;
    }
  }
  assert(sortedDesc, 'Default sort is createdAt DESC');

  // Step 5: Sort by createdAt ASC
  console.log('\nStep 5: Sort by createdAt ASC');
  const ascRes = await fetch(`${BASE}/templates?sort=createdAt&order=asc&limit=100`, { headers: AUTH });
  const ascData = await ascRes.json();
  const ascTemplates = ascData.data.filter(t => t.orgId === ORG_ID && t.name.startsWith('Test183_'));

  let sortedAsc = true;
  for (let i = 1; i < ascTemplates.length; i++) {
    if (new Date(ascTemplates[i].createdAt) < new Date(ascTemplates[i - 1].createdAt)) {
      sortedAsc = false;
      break;
    }
  }
  assert(sortedAsc, 'Sort by createdAt ASC works');

  // Step 6: Sort by name ASC
  console.log('\nStep 6: Sort by name ASC');
  const nameRes = await fetch(`${BASE}/templates?sort=name&order=asc&limit=100`, { headers: AUTH });
  const nameData = await nameRes.json();
  const nameTemplates = nameData.data.filter(t => t.orgId === ORG_ID && t.name.startsWith('Test183_'));

  let nameSorted = true;
  for (let i = 1; i < nameTemplates.length; i++) {
    if (nameTemplates[i].name < nameTemplates[i - 1].name) {
      nameSorted = false;
      break;
    }
  }
  assert(nameSorted, 'Sort by name ASC works');

  // Step 7: Filter by type + verify total count in pagination
  console.log('\nStep 7: Filter by type and check pagination total');
  const poRes = await fetch(`${BASE}/templates?type=purchase_order&limit=5`, { headers: AUTH });
  const poData = await poRes.json();
  assert(poData.pagination, 'Response has pagination object');
  assert(typeof poData.pagination.total === 'number', 'Pagination has total count');
  const poTemplates = poData.data.filter(t => t.name.startsWith('Test183_'));
  assert(poTemplates.every(t => t.type === 'purchase_order'), 'Filtered by purchase_order correctly');

  // Step 8: Publish some and filter by status
  console.log('\nStep 8: Filter by status');
  // Publish first 3 invoices
  const publishedIds = [];
  for (let i = 0; i < 3; i++) {
    const t = orgInvoices[i];
    const pubRes = await fetch(`${BASE}/templates/${t.id}/publish`, {
      method: 'POST',
      headers: AUTH,
    });
    if (pubRes.ok) publishedIds.push(t.id);
  }
  assert(publishedIds.length === 3, `Published ${publishedIds.length} templates`);

  const pubFilterRes = await fetch(`${BASE}/templates?status=published&limit=100`, { headers: AUTH });
  const pubFilterData = await pubFilterRes.json();
  const pubOnly = pubFilterData.data.filter(t => t.name.startsWith('Test183_'));
  assert(pubOnly.length >= 3, `Found ${pubOnly.length} published test templates`);
  assert(pubOnly.every(t => t.status === 'published'), 'All filtered results are published');

  const draftFilterRes = await fetch(`${BASE}/templates?status=draft&limit=100`, { headers: AUTH });
  const draftFilterData = await draftFilterRes.json();
  const draftOnly = draftFilterData.data.filter(t => t.name.startsWith('Test183_'));
  assert(draftOnly.every(t => t.status === 'draft'), 'Draft filter returns only drafts');
  assert(draftOnly.length >= 47, `Found ${draftOnly.length} draft test templates (expected >=47)`);

  // Step 9: Combined filter - type + status
  console.log('\nStep 9: Combined filter type=invoice&status=published');
  const combinedRes = await fetch(`${BASE}/templates?type=invoice&status=published&limit=100`, { headers: AUTH });
  const combinedData = await combinedRes.json();
  const combined = combinedData.data.filter(t => t.name.startsWith('Test183_'));
  assert(combined.length === 3, `Combined filter returns ${combined.length} (expected 3)`);
  assert(combined.every(t => t.type === 'invoice' && t.status === 'published'), 'Combined filter works correctly');

  // Step 10: Verify data comes from real DB (not mock) - unique test data
  console.log('\nStep 10: Verify data from real database');
  const uniqueName = `UNIQUE_DB_CHECK_${Date.now()}`;
  const uniqueTemplate = await createTemplate(uniqueName, 'invoice');
  assert(uniqueTemplate.id, 'Created unique template');

  const checkRes = await fetch(`${BASE}/templates?type=invoice&limit=200`, { headers: AUTH });
  const checkData = await checkRes.json();
  const foundUnique = checkData.data.find(t => t.name === uniqueName);
  assert(foundUnique, 'Unique template found via filter query');
  assert(foundUnique && foundUnique.id === uniqueTemplate.id, 'Correct template returned from DB');

  // Step 11: Verify distinct types endpoint returns real data
  console.log('\nStep 11: Distinct types from database');
  const typesRes = await fetch(`${BASE}/templates/types`, { headers: AUTH });
  const typesData = await typesRes.json();
  assert(typesData.types && Array.isArray(typesData.types), 'Types endpoint returns array');
  assert(typesData.types.includes('invoice'), 'Types include invoice');
  assert(typesData.types.includes('statement'), 'Types include statement');
  assert(typesData.types.includes('purchase_order'), 'Types include purchase_order');

  // Step 12: Pagination limit works correctly
  console.log('\nStep 12: Pagination limit');
  const limitRes = await fetch(`${BASE}/templates?limit=5`, { headers: AUTH });
  const limitData = await limitRes.json();
  assert(limitData.data.length === 5, `Limit=5 returns exactly 5 results (got ${limitData.data.length})`);
  assert(limitData.pagination.hasMore === true, 'hasMore is true when more results exist');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
