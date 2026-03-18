/**
 * Feature #258: Filter persistence within session
 * Applied filters persist during session navigation
 *
 * Tests:
 * 1. Code verification: sessionStorage save on filter change
 * 2. Code verification: sessionStorage restore on mount
 * 3. API verification: filters produce correct results
 * 4. Navigation flow: filters preserved across page navigation
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const FRONTEND_BASE = 'http://localhost:3002';

// Helper: create auth headers with proper HMAC JWT
function authHeaders(orgId = 'org-test-258') {
  const crypto = require('crypto');
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-test-258',
    orgId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  const token = header + '.' + payload + '.' + sig;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

const headers = authHeaders();
const ORG_ID = 'org-test-258';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${testName}`);
  } else {
    failed++;
    results.push(`  ❌ ${testName}`);
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Read the TemplateList source to verify implementation
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('Feature #258: Filter persistence within session\n');

  // ============================================
  // SECTION 1: Code verification
  // ============================================
  console.log('--- Section 1: Code Verification ---');

  const templateListSource = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'TemplateList.tsx'),
    'utf8'
  );

  // Test 1: sessionStorage used for type filter initialization
  assert(
    templateListSource.includes("sessionStorage.getItem('tpl_filter_type')"),
    'Type filter initializes from sessionStorage'
  );

  // Test 2: sessionStorage used for status filter initialization
  assert(
    templateListSource.includes("sessionStorage.getItem('tpl_filter_status')"),
    'Status filter initializes from sessionStorage'
  );

  // Test 3: sessionStorage used for search query initialization
  assert(
    templateListSource.includes("sessionStorage.getItem('tpl_filter_search')"),
    'Search query initializes from sessionStorage'
  );

  // Test 4: Type filter change saves to sessionStorage
  assert(
    templateListSource.includes("sessionStorage.setItem('tpl_filter_type'"),
    'Type filter change persists to sessionStorage'
  );

  // Test 5: Status filter change saves to sessionStorage
  assert(
    templateListSource.includes("sessionStorage.setItem('tpl_filter_status'"),
    'Status filter change persists to sessionStorage'
  );

  // Test 6: Search query change saves to sessionStorage
  assert(
    templateListSource.includes("sessionStorage.setItem('tpl_filter_search'"),
    'Search query change persists to sessionStorage'
  );

  // Test 7: SSR guard - typeof window check
  const windowChecks = (templateListSource.match(/typeof window !== 'undefined'/g) || []).length;
  assert(
    windowChecks >= 3,
    `SSR guard present for all 3 filter initializations (found ${windowChecks})`
  );

  // Test 8: Fallback to empty string when sessionStorage has no value
  assert(
    templateListSource.includes("|| ''") || templateListSource.includes("|| \"\""),
    'Fallback to empty string when no sessionStorage value'
  );

  // Test 9: useState with lazy initializer pattern
  assert(
    templateListSource.includes('useState<string>(() => {'),
    'Uses lazy initializer pattern for useState'
  );

  // Test 10: Cursor reset still happens alongside filter persistence
  assert(
    templateListSource.includes('setCursor(null)') && templateListSource.includes("sessionStorage.setItem('tpl_filter_type'"),
    'Cursor reset happens alongside sessionStorage persistence'
  );

  // ============================================
  // SECTION 2: API verification - filters work correctly
  // ============================================
  console.log('\n--- Section 2: API Verification ---');

  // Create test templates with distinct types
  const templateNames = [
    { name: 'PERSIST_TEST_invoice_258', type: 'invoice' },
    { name: 'PERSIST_TEST_statement_258', type: 'statement' },
    { name: 'PERSIST_TEST_custom_258', type: 'custom' },
  ];

  const createdIds = [];
  const defaultSchema = { type: 'text' };
  for (const t of templateNames) {
    const res = await fetchJSON(`${API_BASE}/templates`, {
      method: 'POST',
      body: JSON.stringify({ name: t.name, type: t.type, orgId: ORG_ID, schema: defaultSchema }),
    });
    if (res.status === 201 || res.status === 200) {
      createdIds.push(res.body.id || res.body.data?.id);
    }
  }

  // Test 11: Type filter returns only matching templates
  const invoiceRes = await fetchJSON(`${API_BASE}/templates?type=invoice&orgId=${ORG_ID}&limit=100`);
  assert(
    invoiceRes.status === 200,
    'Type filter API returns 200'
  );

  const invoiceTemplates = invoiceRes.body.data || [];
  const hasInvoice = invoiceTemplates.some(t => t.name === 'PERSIST_TEST_invoice_258');
  const hasStatement = invoiceTemplates.some(t => t.name === 'PERSIST_TEST_statement_258');
  assert(hasInvoice, 'Type=invoice includes invoice template');
  assert(!hasStatement, 'Type=invoice excludes statement template');

  // Test 14: Status filter returns only matching templates
  const draftRes = await fetchJSON(`${API_BASE}/templates?status=draft&orgId=${ORG_ID}&limit=100`);
  assert(
    draftRes.status === 200,
    'Status filter API returns 200'
  );
  const draftTemplates = draftRes.body.data || [];
  const allDraft = draftTemplates.every(t => t.status === 'draft');
  assert(allDraft, 'Status=draft returns only draft templates');

  // Test 16: Search filter returns matching templates
  const searchRes = await fetchJSON(`${API_BASE}/templates?search=PERSIST_TEST_invoice&orgId=${ORG_ID}&limit=100`);
  assert(
    searchRes.status === 200,
    'Search filter API returns 200'
  );
  const searchData = searchRes.body.data || [];
  assert(
    searchData.some(t => t.name === 'PERSIST_TEST_invoice_258'),
    'Search finds matching template'
  );

  // Test 18: Combined type + status filter
  const combinedRes = await fetchJSON(`${API_BASE}/templates?type=invoice&status=draft&orgId=${ORG_ID}&limit=100`);
  assert(
    combinedRes.status === 200,
    'Combined type+status filter API returns 200'
  );
  const combinedData = combinedRes.body.data || [];
  const allCombined = combinedData.every(t => t.type === 'invoice' && t.status === 'draft');
  assert(allCombined || combinedData.length === 0, 'Combined filter returns only matching templates');

  // Test 20: Combined search + type filter
  const combinedSearchRes = await fetchJSON(`${API_BASE}/templates?search=PERSIST_TEST&type=statement&orgId=${ORG_ID}&limit=100`);
  assert(
    combinedSearchRes.status === 200,
    'Combined search+type filter API returns 200'
  );
  const combinedSearchData = combinedSearchRes.body.data || [];
  assert(
    combinedSearchData.every(t => t.type === 'statement'),
    'Combined search+type returns only matching type'
  );

  // ============================================
  // SECTION 3: Navigation flow verification
  // ============================================
  console.log('\n--- Section 3: Navigation Flow Verification ---');

  // Test 22: TemplateList page exists and renders
  const templatesPageSource = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'templates', 'page.tsx'),
    'utf8'
  );
  assert(
    templatesPageSource.includes('TemplateList'),
    'Templates page renders TemplateList component'
  );

  // Test 23: Navigation to designer uses window.location.href
  assert(
    templatesPageSource.includes('window.location.href'),
    'Template selection navigates via window.location.href (full page nav)'
  );

  // Test 24: Designer back button exists
  const designerSource = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf8'
  );
  assert(
    designerSource.includes('btn-back-to-templates'),
    'Designer has back-to-templates button'
  );

  // Test 25: Back navigation goes to /templates
  assert(
    designerSource.includes("/templates"),
    'Back button navigates to /templates route'
  );

  // Test 26: sessionStorage keys are consistent (save matches load)
  const saveKeys = ['tpl_filter_type', 'tpl_filter_status', 'tpl_filter_search'];
  for (const key of saveKeys) {
    const getPattern = `sessionStorage.getItem('${key}')`;
    const setPattern = `sessionStorage.setItem('${key}'`;
    assert(
      templateListSource.includes(getPattern) && templateListSource.includes(setPattern),
      `Key '${key}' is both read and written consistently`
    );
  }

  // Test 29: Filter state variables use sessionStorage for initial value
  // Verify the pattern: useState<string>(() => { ... sessionStorage.getItem ... })
  const lazyInitPattern = /useState<string>\(\(\) => \{[^}]*sessionStorage\.getItem/g;
  const lazyMatches = templateListSource.match(lazyInitPattern) || [];
  assert(
    lazyMatches.length === 3,
    `All 3 filter states use lazy initializer with sessionStorage (found ${lazyMatches.length})`
  );

  // Test 30: No mock data patterns
  const mockPatterns = ['globalThis', 'devStore', 'dev-store', 'mockDb', 'fakeData'];
  const hasMocks = mockPatterns.some(p => templateListSource.includes(p));
  assert(!hasMocks, 'No mock data patterns in TemplateList');

  // ============================================
  // Cleanup
  // ============================================
  console.log('\n--- Cleanup ---');
  for (const id of createdIds) {
    if (id) {
      await fetch(`${API_BASE}/templates/${id}`, {
        method: 'DELETE',
        headers,
      });
    }
  }
  console.log(`Cleaned up ${createdIds.filter(Boolean).length} test templates`);

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${passed + failed} tests passing`);
  console.log(`========================================`);
  results.forEach(r => console.log(r));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
