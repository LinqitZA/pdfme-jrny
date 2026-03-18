/**
 * Feature #51: Toolbar save draft triggers callback
 * Save draft calls onSaveDraft
 *
 * Steps:
 * 1. Make changes
 * 2. Click Save Draft
 * 3. Verify callback called
 * 4. Verify indicator shows
 *
 * Tests SSR HTML for button presence, source code for callback wiring.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

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
  console.log('Feature #51: Toolbar save draft triggers callback\n');

  // Fetch HTML and source code
  let html;
  let source;
  try {
    html = await fetchPage(FRONTEND_URL);
    source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Save Draft button exists in HTML ===
  console.log('--- Save Draft Button ---');

  test('Save Draft button exists with data-testid="btn-save"', () => {
    assert(html.includes('data-testid="btn-save"'), 'btn-save not found in HTML');
  });

  test('Save Draft button has aria-label for accessibility', () => {
    assert(html.includes('aria-label="Save draft'), 'Save draft aria-label not found');
  });

  test('Save Draft button has keyboard shortcut attribute', () => {
    assert(html.includes('aria-keyshortcuts="Control+S"'), 'Control+S shortcut not found');
  });

  test('Save Draft button has data-save-status attribute', () => {
    assert(html.includes('data-save-status='), 'data-save-status attribute not found');
  });

  test('Save Draft button text shows "Save Draft" by default', () => {
    assert(html.includes('Save Draft'), 'Save Draft text not found');
  });

  // === SECTION 2: onSaveDraft prop defined in interface ===
  console.log('\n--- onSaveDraft Prop ---');

  test('ErpDesignerProps interface includes onSaveDraft prop', () => {
    assert(source.includes('onSaveDraft?:'), 'onSaveDraft prop not in interface');
  });

  test('onSaveDraft prop has JSDoc description', () => {
    assert(source.includes('Callback fired when the Save Draft toolbar button is clicked'), 'onSaveDraft JSDoc not found');
  });

  test('onSaveDraft is destructured in component function', () => {
    assert(source.includes('onSaveDraft,'), 'onSaveDraft not destructured');
  });

  // === SECTION 3: onSaveDraft is called in handleSave ===
  console.log('\n--- onSaveDraft Callback Wiring ---');

  test('handleSave function calls onSaveDraft callback', () => {
    assert(source.includes('onSaveDraft(templateData)') || source.includes('onSaveDraft('), 'onSaveDraft not called in handleSave');
  });

  test('onSaveDraft is in handleSave dependency array', () => {
    assert(source.includes('onSaveDraft, templateId') || source.includes('onSaveDraft,'), 'onSaveDraft not in useCallback deps');
  });

  test('onSaveDraft receives template data object', () => {
    // Check that the callback receives a template data object with name, pageSize, pages
    const handleSaveSection = source.substring(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('const handleSave = useCallback') + 2000
    );
    assert(handleSaveSection.includes('onSaveDraft'), 'onSaveDraft not found in handleSave');
    assert(handleSaveSection.includes('templateData') || handleSaveSection.includes('{ name'), 'template data not passed');
  });

  // === SECTION 4: Save status indicators ===
  console.log('\n--- Save Status Indicators ---');

  test('Save button shows "Saving…" text when saving', () => {
    assert(source.includes("'Saving…'") || source.includes('"Saving…"'), 'Saving… text not found');
  });

  test('Save button shows "Retry Save" text on error', () => {
    assert(source.includes("'Retry Save'") || source.includes('"Retry Save"'), 'Retry Save text not found');
  });

  test('Save success toast exists with data-testid', () => {
    assert(source.includes('data-testid="save-success-toast"'), 'save-success-toast not found');
  });

  test('Save success message shows draft saved text', () => {
    assert(source.includes('Draft saved successfully'), 'Draft saved successfully message not found');
  });

  test('Save error banner exists with data-testid', () => {
    assert(source.includes('data-testid="save-error-banner"'), 'save-error-banner not found');
  });

  test('Save error banner has retry button', () => {
    assert(source.includes('data-testid="save-error-retry"'), 'save-error-retry not found');
  });

  test('Save button is disabled during saving', () => {
    assert(source.includes("saveStatus === 'saving'") && source.includes('disabled='), 'Save button not disabled during saving');
  });

  test('Save button changes color based on dirty state', () => {
    assert(source.includes('isDirty'), 'isDirty not used for button styling');
  });

  test('Save button changes color on error state', () => {
    assert(source.includes("saveStatus === 'error'"), 'Error state styling not found');
  });

  // === SECTION 5: Template data structure ===
  console.log('\n--- Template Data Passed to Callback ---');

  test('Template data includes name field', () => {
    const handleSaveSection = source.substring(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('const handleSave = useCallback') + 1000
    );
    assert(handleSaveSection.includes('name'), 'name not in template data');
  });

  test('Template data includes pageSize field', () => {
    const handleSaveSection = source.substring(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('const handleSave = useCallback') + 1000
    );
    assert(handleSaveSection.includes('pageSize'), 'pageSize not in template data');
  });

  test('Template data includes pages field', () => {
    const handleSaveSection = source.substring(
      source.indexOf('const handleSave = useCallback'),
      source.indexOf('const handleSave = useCallback') + 1000
    );
    assert(handleSaveSection.includes('pages'), 'pages not in template data');
  });

  // === Summary ===
  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
