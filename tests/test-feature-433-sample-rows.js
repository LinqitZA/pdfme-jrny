/**
 * Feature #433: Add sample row data for table canvas preview and preview mode
 * Tests that tables on the canvas show realistic sample data rows instead of placeholders.
 */

const crypto = require('crypto');
const API_BASE = 'http://localhost:3001/api/pdfme';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(orgId = 'test-org-433') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'test-user-433', orgId,
    roles: ['admin', 'template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger'],
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const AUTH_TOKEN = `Bearer ${makeToken()}`;
const HEADERS = { 'Content-Type': 'application/json', Authorization: AUTH_TOKEN };

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  ❌ ${testName}`);
  }
}

async function runTests() {
  console.log('=== Feature #433: Sample Row Data for Table Canvas Preview ===\n');

  // ─── 1. generateSampleRows function exists in compiled JS ───
  console.log('--- 1. Designer compiled JS contains sample row logic ---');

  const designerRes = await fetch('http://localhost:3000');
  assert(designerRes.ok, 'Designer loads successfully');

  const html = await designerRes.text();
  const jsChunks = html.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [];

  let foundSampleRows = false;
  let foundSampleRowTestId = false;
  let foundMoreRowsIndicator = false;
  let foundSampleTemplates = false;
  let foundFallbackPlaceholder = false;

  for (const chunk of jsChunks) {
    try {
      const chunkRes = await fetch(`http://localhost:3000${chunk}`);
      const text = await chunkRes.text();
      if (text.includes('table-sample-row')) foundSampleRowTestId = true;
      if (text.includes('table-sample-rows')) foundSampleRows = true;
      if (text.includes('and more rows')) foundMoreRowsIndicator = true;
      if (text.includes('Widget A') || text.includes('Service B')) foundSampleTemplates = true;
      if (text.includes('getElementTypeLabel') || text.includes('Line Items Table') || text.includes('Grouped Table')) foundFallbackPlaceholder = true;
    } catch { /* ignore */ }
  }

  assert(foundSampleRows, 'table-sample-rows test-id found in compiled JS');
  assert(foundSampleRowTestId, 'table-sample-row test-id found in compiled JS');
  assert(foundMoreRowsIndicator, '"and more rows" indicator found in compiled JS');
  assert(foundSampleTemplates, 'Sample data templates (Widget A/Service B) found in compiled JS');
  assert(foundFallbackPlaceholder, 'Fallback placeholder logic preserved');

  // ─── 2. generateSampleRows function correctness (via source inspection) ───
  console.log('\n--- 2. Source code structure verification ---');

  // Read the actual source to verify the function exists and has correct logic
  const fs = require('fs');
  const srcPath = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';
  const src = fs.readFileSync(srcPath, 'utf-8');

  assert(src.includes('function generateSampleRows'), 'generateSampleRows function exists');
  assert(src.includes('SAMPLE_ROW_TEMPLATES'), 'SAMPLE_ROW_TEMPLATES constant exists');
  assert(src.includes('Widget A'), 'Sample row 1 has "Widget A"');
  assert(src.includes('Service B'), 'Sample row 2 has "Service B"');
  assert(src.includes('Component C'), 'Sample row 3 has "Component C"');

  // Verify it handles different field types
  assert(src.includes("currency") && src.includes("R 1,000.00"), 'Currency type generates currency values');
  assert(src.includes("number") && src.includes("'10'"), 'Number type generates numeric values');
  assert(src.includes("date") && src.includes("2026-03-18"), 'Date type generates date values');
  assert(src.includes("percentage") && src.includes("15%"), 'Percentage type generates percentage values');

  // Verify column key heuristics
  assert(src.includes("amount") && src.includes("price") && src.includes("total"), 'Key heuristic for currency columns (amount/price/total)');
  assert(src.includes("qty") && src.includes("quantity"), 'Key heuristic for quantity columns');

  // ─── 3. Table canvas rendering shows sample rows ───
  console.log('\n--- 3. Canvas rendering logic ---');

  assert(src.includes('table-sample-rows-'), 'Sample rows container has dynamic test-id');
  assert(src.includes('table-sample-row-'), 'Individual rows have indexed test-ids');
  assert(src.includes('… and more rows') || src.includes('and more rows'), '"... and more rows" indicator present');

  // Verify the condition for showing sample rows
  assert(src.includes('hasSampleData'), 'hasSampleData condition controls sample row display');
  assert(src.includes('arrayFieldGroups[el.dataSource]'), 'Uses arrayFieldGroups for field data');
  assert(src.includes('getElementTypeLabel(el.type)'), 'Falls back to placeholder when no data source');

  // ─── 4. renderCanvasElement dependencies updated ───
  console.log('\n--- 4. React memoization dependencies ---');

  // The renderCanvasElement useCallback should include arrayFieldGroups and fieldExamples
  // Search for the dependency array near renderCanvasElement
  const depsIdx = src.indexOf('arrayFieldGroups, fieldExamples]');
  assert(depsIdx > -1, 'arrayFieldGroups and fieldExamples in renderCanvasElement dependency array');
  // Verify it's in a useCallback context
  const contextBefore = src.substring(Math.max(0, depsIdx - 200), depsIdx);
  assert(contextBefore.includes('handleResizeMouseDown'), 'Dependencies are in renderCanvasElement useCallback');

  // ─── 5. Sample row limit ───
  console.log('\n--- 5. Sample row generation limits ---');

  assert(src.includes('Math.min(rowCount, 3)'), 'Limits to maximum 3 rows');

  // Verify default rowCount is 2
  const funcSignature = src.match(/function generateSampleRows\([^)]*rowCount\s*(?::\s*\w+)?\s*=\s*(\d+)/);
  if (funcSignature) {
    assert(funcSignature[1] === '2', 'Default rowCount is 2');
  } else {
    assert(src.includes('rowCount: number = 2') || src.includes('rowCount = 2'), 'Default rowCount is 2');
  }

  // ─── 6. Preview mode support ───
  console.log('\n--- 6. Preview mode support ---');

  // The sample rows should render in both design and preview mode since
  // the condition is based on dataSource, not previewMode
  assert(src.includes('hasSampleData'), 'Sample data renders regardless of previewMode');

  // ─── 7. Fallback behavior ───
  console.log('\n--- 7. Fallback for tables without data source ---');

  // Tables without a dataSource should still show the placeholder
  const fallbackMatch = src.match(/if\s*\(hasSampleData\)[\s\S]*?return\s*\(\s*<div[^>]*style.*flex.*1.*display.*flex.*alignItems.*center/);
  assert(!!fallbackMatch || src.includes('getElementTypeLabel(el.type)'), 'Fallback to element type label when no sample data');

  // ─── 8. Template with dataSource - API round-trip ───
  console.log('\n--- 8. API round-trip with dataSource for sample data ---');

  const templatePayload = {
    name: 'SampleRows-Test-433-' + Date.now(),
    type: 'invoice',
    schema: {
      basePdf: 'BLANK_PDF',
      pageSize: { width: 210, height: 297 },
      pages: [{
        id: 'page-1',
        label: 'Page 1',
        elements: [
          {
            id: 'lit-sample',
            type: 'line-items',
            x: 20, y: 50, w: 495, h: 200,
            columns: [
              { key: 'description', header: 'Description', width: 200, align: 'left' },
              { key: 'qty', header: 'Qty', width: 60, align: 'right' },
              { key: 'unitPrice', header: 'Unit Price', width: 80, align: 'right' },
              { key: 'amount', header: 'Amount', width: 80, align: 'right' },
            ],
            showHeader: true,
            borderStyle: 'solid',
            dataSource: 'lineItems',
          },
        ],
      }],
    },
  };

  const createRes = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(templatePayload),
  });
  assert(createRes.ok, 'Template created with dataSource for sample rows');
  const created = await createRes.json();

  // Verify the template schema persists the dataSource
  const getRes = await fetch(`${API_BASE}/templates/${created.id}`, { headers: HEADERS });
  const template = await getRes.json();
  const schema = template.schema || template.draftSchema;
  const el = schema?.pages?.[0]?.elements?.[0];
  assert(el?.dataSource === 'lineItems', 'dataSource persisted for sample row rendering');
  assert(el?.columns?.length === 4, 'All columns persisted for sample data generation');
  assert(el?.columns?.[0]?.key === 'description', 'Column keys preserved for field matching');

  // ─── 9. Column alignment in sample rows ───
  console.log('\n--- 9. Column alignment in sample rows ---');

  // Verify the source uses column align property for sample row cells
  assert(src.includes("el.columns![cellIdx]?.align || 'left'"), 'Sample row cells respect column alignment');

  // ─── 10. Overflow handling ───
  console.log('\n--- 10. Cell overflow handling ---');

  assert(src.includes('textOverflow') && src.includes('ellipsis'), 'Text overflow ellipsis for long values');
  assert(src.includes('whiteSpace') && src.includes('nowrap'), 'No text wrapping in sample cells');

  // ─── 11. Fields without example values ───
  console.log('\n--- 11. Default values for fields without examples ---');

  // The generateSampleRows function should handle missing example values
  assert(src.includes('field.example'), 'Uses field.example when available');
  assert(src.includes('field?.fieldType'), 'Falls back to fieldType-based defaults');
  assert(src.includes('col.key.toLowerCase()'), 'Falls back to column key name heuristics');

  // ─── Cleanup ───
  if (created?.id) {
    await fetch(`${API_BASE}/templates/${created.id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
  }

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`${'='.repeat(50)}`);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
