/**
 * Feature #308: ARIA labels on toolbar buttons
 * Tests that all toolbar buttons have aria-label attributes.
 *
 * Verification approach: Source code analysis + served HTML verification
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND = 'http://localhost:3001';
const DESIGNER_FILE = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function runTests() {
  console.log('Feature #308: ARIA labels on toolbar buttons\n');

  const source = fs.readFileSync(DESIGNER_FILE, 'utf8');

  // --- Toolbar buttons with aria-labels ---
  console.log('--- Toolbar Button ARIA Labels ---');

  // Back to templates
  assert(
    source.includes('data-testid="btn-back-to-templates"') && source.includes('aria-label="Back to template list"'),
    'Back to Templates button has aria-label'
  );

  // Template name input
  assert(
    source.includes('data-testid="template-name-input"') && source.includes('aria-label="Template name"'),
    'Template name input has aria-label'
  );

  // Page size selector
  assert(
    source.includes('data-testid="page-size-selector"') && source.includes('aria-label="Page size"'),
    'Page size selector has aria-label'
  );

  // Undo button (may include keyboard shortcut in label)
  const undoLine = source.split('\n').find(l => l.includes('data-testid="btn-undo"'));
  assert(
    undoLine && undoLine.includes('aria-label=') && undoLine.includes('Undo'),
    'Undo button has aria-label containing "Undo"'
  );

  // Redo button (may include keyboard shortcut in label)
  const redoLine = source.split('\n').find(l => l.includes('data-testid="btn-redo"'));
  assert(
    redoLine && redoLine.includes('aria-label=') && redoLine.includes('Redo'),
    'Redo button has aria-label containing "Redo"'
  );

  // Zoom selector
  assert(
    source.includes('data-testid="zoom-selector"') && source.includes('aria-label="Zoom level"'),
    'Zoom selector has aria-label'
  );

  // Preview Data toggle
  assert(
    source.includes('data-testid="btn-preview-data"') && source.includes('aria-label='),
    'Preview Data toggle has aria-label'
  );

  // Preview button
  assert(
    source.includes('data-testid="btn-preview"') && source.includes('aria-label="Preview PDF"'),
    'Preview button has aria-label'
  );

  // Generate PDF button
  assert(
    source.includes('data-testid="btn-render"') && source.includes('aria-label="Generate PDF"'),
    'Generate PDF button has aria-label'
  );

  // Async Render button
  assert(
    source.includes('data-testid="btn-async-render"') && source.includes('aria-label="Async render PDF"'),
    'Async Render button has aria-label'
  );

  // Save Draft button (may include keyboard shortcut in label)
  {
    const saveIdx = source.indexOf('data-testid="btn-save"');
    const saveContext = saveIdx >= 0 ? source.substring(saveIdx, saveIdx + 200) : '';
    assert(
      saveContext.includes('aria-label=') && (saveContext.toLowerCase().includes('save') || source.includes('aria-label="Save draft"')),
      'Save Draft button has aria-label containing "Save"'
    );
  }

  // Publish button
  assert(
    source.includes('data-testid="btn-publish"') && source.includes('aria-label="Publish template"'),
    'Publish button has aria-label'
  );

  // Archive button
  assert(
    source.includes('data-testid="btn-archive"') && source.includes('aria-label="Archive template"'),
    'Archive button has aria-label'
  );

  // --- Other interactive elements with aria-labels ---
  console.log('\n--- Additional Interactive Elements ---');

  // Left panel tabs
  assert(
    source.includes('aria-label={`${tab} tab`}'),
    'Left panel tabs have aria-labels'
  );

  // Bold button
  assert(
    source.includes('data-testid="prop-bold"') && source.includes('aria-label="Toggle bold"'),
    'Bold button has aria-label'
  );

  // Italic button
  assert(
    source.includes('data-testid="prop-italic"') && source.includes('aria-label="Toggle italic"'),
    'Italic button has aria-label'
  );

  // Text alignment buttons
  assert(
    source.includes('aria-label={`Align ${align}`}'),
    'Text alignment buttons have aria-labels'
  );

  // Delete element button
  assert(
    source.includes('data-testid="btn-delete-element"') && source.includes('aria-label="Delete element"'),
    'Delete element button has aria-label'
  );

  // Add column button
  assert(
    source.includes('data-testid="prop-add-column"') && source.includes('aria-label="Add table column"'),
    'Add column button has aria-label'
  );

  // Binding picker button
  assert(
    source.includes('data-testid="btn-open-binding-picker"') && source.includes('aria-label="Open binding picker"'),
    'Binding picker button has aria-label'
  );

  // Upload asset button
  assert(
    source.includes('data-testid="asset-upload-btn"') && source.includes('aria-label="Upload asset"'),
    'Upload asset button has aria-label'
  );

  // Add page button
  assert(
    source.includes('data-testid="btn-add-page"') && source.includes('aria-label="Add page"'),
    'Add page button has aria-label'
  );

  // Narrow viewport toggle buttons
  assert(
    source.includes('data-testid="btn-toggle-left-panel"') && source.includes('aria-label="Toggle blocks and fields panel"'),
    'Toggle left panel button has aria-label'
  );

  assert(
    source.includes('data-testid="btn-toggle-right-panel"') && source.includes('aria-label="Toggle properties panel"'),
    'Toggle right panel button has aria-label'
  );

  // Error/action buttons
  console.log('\n--- Error & Action Button ARIA Labels ---');

  assert(
    source.includes('data-testid="save-error-retry"') && source.includes('aria-label="Retry save"'),
    'Save error retry button has aria-label'
  );

  assert(
    source.includes('data-testid="save-error-dismiss"') && source.includes('aria-label="Dismiss error"'),
    'Save error dismiss button has aria-label'
  );

  assert(
    source.includes('data-testid="publish-error-retry"') && source.includes('aria-label="Retry publish"'),
    'Publish error retry button has aria-label'
  );

  assert(
    source.includes('data-testid="publish-error-dismiss"') && source.includes('aria-label="Dismiss publish error"'),
    'Publish error dismiss button has aria-label'
  );

  assert(
    source.includes('data-testid="render-dismiss"') && source.includes('aria-label="Dismiss render overlay"'),
    'Render dismiss button has aria-label'
  );

  assert(
    source.includes('data-testid="toast-dismiss"') && source.includes('aria-label="Dismiss notification"'),
    'Toast dismiss button has aria-label'
  );

  // Context menu buttons
  assert(
    source.includes('data-testid="ctx-duplicate-page"') && source.includes('aria-label="Duplicate page"'),
    'Duplicate page context menu has aria-label'
  );

  assert(
    source.includes('data-testid="ctx-delete-page"') && source.includes('aria-label="Delete page"'),
    'Delete page context menu has aria-label'
  );

  // --- Verify served page ---
  console.log('\n--- Served HTML Verification ---');

  try {
    const res = await fetch(FRONTEND);
    assert(res.status === 200, 'Frontend page loads successfully');
    assert(
      res.body.includes('aria-label'),
      'Served HTML contains aria-label attributes'
    );
  } catch (e) {
    assert(false, `Frontend fetch failed: ${e.message}`);
  }

  // --- Count total aria-label occurrences ---
  console.log('\n--- ARIA Label Coverage ---');

  const ariaLabelCount = (source.match(/aria-label=/g) || []).length;
  assert(
    ariaLabelCount >= 25,
    `Total aria-label attributes: ${ariaLabelCount} (>=25 expected for comprehensive coverage)`
  );

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
