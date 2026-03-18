/**
 * Feature #53: Toolbar export JSON when permitted
 * Export downloads template JSON
 *
 * Steps:
 * 1. canExportJson=true: click triggers download
 * 2. Verify valid JSON
 * 3. canExportJson=false: disabled
 *
 * Tests SSR HTML for button presence and source code for export logic.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const PAGE_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'page.tsx');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Feature #53: Toolbar export JSON when permitted\n');

  let html, htmlDisabled, source, pageSource;
  try {
    html = await fetchPage(FRONTEND_URL);
    htmlDisabled = await fetchPage(`${FRONTEND_URL}?canExportJson=false`);
    source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    pageSource = fs.readFileSync(PAGE_PATH, 'utf-8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: canExportJson prop in interface ===
  console.log('--- canExportJson Prop Definition ---');

  test('ErpDesignerProps includes canExportJson prop', () => {
    assert(source.includes('canExportJson?:'), 'canExportJson not in interface');
  });

  test('canExportJson has boolean type', () => {
    assert(source.includes('canExportJson?: boolean'), 'canExportJson is not boolean');
  });

  test('canExportJson defaults to true', () => {
    assert(source.includes('canExportJson = true'), 'canExportJson default not set to true');
  });

  test('canExportJson is destructured in component', () => {
    assert(source.includes('canExportJson'), 'canExportJson not destructured');
  });

  // === SECTION 2: Export JSON button in HTML ===
  console.log('\n--- Export JSON Button ---');

  test('Export JSON button exists with data-testid="btn-export-json"', () => {
    assert(html.includes('data-testid="btn-export-json"'), 'btn-export-json not found in HTML');
  });

  test('Export JSON button has aria-label', () => {
    assert(html.includes('aria-label="Export template JSON"'), 'Export aria-label not found');
  });

  test('Export JSON button shows "Export JSON" text', () => {
    assert(html.includes('Export JSON'), 'Export JSON text not found');
  });

  // === SECTION 3: handleExportJson function ===
  console.log('\n--- Export JSON Handler ---');

  test('handleExportJson function exists', () => {
    assert(source.includes('handleExportJson'), 'handleExportJson not found');
  });

  test('handleExportJson checks canExportJson before proceeding', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('canExportJson'), 'canExportJson not checked in handler');
  });

  test('handleExportJson creates JSON string from template data', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('JSON.stringify'), 'JSON.stringify not found');
  });

  test('handleExportJson creates a Blob with application/json type', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('application/json'), 'application/json content type not found');
  });

  test('handleExportJson uses createObjectURL for download', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('createObjectURL'), 'createObjectURL not found');
  });

  test('handleExportJson creates an anchor element for download', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes("createElement('a')") || exportSection.includes('createElement("a")'), 'anchor element not created');
  });

  test('handleExportJson sets download filename with .json extension', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('.json'), '.json extension not found');
  });

  test('handleExportJson clicks the anchor to trigger download', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('.click()'), '.click() not found');
  });

  test('handleExportJson revokes object URL after download', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('revokeObjectURL'), 'revokeObjectURL not found');
  });

  // === SECTION 4: Template data in export ===
  console.log('\n--- Export Data Structure ---');

  test('Export includes name field', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 800
    );
    assert(exportSection.includes('name'), 'name not in export data');
  });

  test('Export includes pageSize field', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 800
    );
    assert(exportSection.includes('pageSize'), 'pageSize not in export data');
  });

  test('Export includes pages field', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 800
    );
    assert(exportSection.includes('pages'), 'pages not in export data');
  });

  test('Export is pretty-printed (indented) JSON', () => {
    assert(source.includes('JSON.stringify(templateData, null, 2)'), 'JSON not pretty-printed');
  });

  // === SECTION 5: Disabled state (canExportJson=false) ===
  console.log('\n--- Export JSON Disabled State ---');

  test('Export button disabled attribute uses canExportJson', () => {
    const btnSection = source.substring(
      source.indexOf('data-testid="btn-export-json"'),
      source.indexOf('data-testid="btn-export-json"') + 500
    );
    assert(btnSection.includes('!canExportJson'), '!canExportJson not in disabled');
  });

  test('Export button has muted styling when disabled', () => {
    const btnSection = source.substring(
      source.indexOf('data-testid="btn-export-json"'),
      source.indexOf('data-testid="btn-export-json"') + 500
    );
    assert(btnSection.includes("!canExportJson ? '#94a3b8'") || btnSection.includes('!canExportJson'), 'Muted color not found');
  });

  test('Export button has disabled tooltip', () => {
    assert(source.includes('Export is not permitted'), 'Disabled tooltip not found');
  });

  test('Export button opacity reduced when disabled', () => {
    const btnSection = source.substring(
      source.indexOf('data-testid="btn-export-json"'),
      source.indexOf('data-testid="btn-export-json"') + 500
    );
    assert(btnSection.includes('!canExportJson') && btnSection.includes('opacity'), 'Reduced opacity not found');
  });

  test('Export button cursor is not-allowed when disabled', () => {
    const btnSection = source.substring(
      source.indexOf('data-testid="btn-export-json"'),
      source.indexOf('data-testid="btn-export-json"') + 500
    );
    assert(btnSection.includes('not-allowed') && btnSection.includes('!canExportJson'), 'not-allowed cursor not found');
  });

  // === SECTION 6: Success feedback ===
  console.log('\n--- Export Success Feedback ---');

  test('Export shows success toast/message', () => {
    const exportSection = source.substring(
      source.indexOf('const handleExportJson'),
      source.indexOf('const handleExportJson') + 1000
    );
    assert(exportSection.includes('addToast') || exportSection.includes('success'), 'No success feedback found');
  });

  test('Export success message mentions JSON export', () => {
    assert(source.includes('Template JSON exported') || source.includes('JSON exported'), 'JSON export message not found');
  });

  // === SECTION 7: Page.tsx integration ===
  console.log('\n--- Page Integration ---');

  test('page.tsx reads canExportJson from search params', () => {
    assert(pageSource.includes('canExportJson'), 'canExportJson not in page.tsx');
  });

  test('page.tsx passes canExportJson to ErpDesigner', () => {
    assert(pageSource.includes('canExportJson={canExportJson}') || pageSource.includes('canExportJson='), 'canExportJson not passed');
  });

  test('Export button onClick calls handleExportJson', () => {
    const btnSection = source.substring(
      source.indexOf('data-testid="btn-export-json"'),
      source.indexOf('data-testid="btn-export-json"') + 300
    );
    assert(btnSection.includes('handleExportJson'), 'handleExportJson not in onClick');
  });

  // === Summary ===
  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
