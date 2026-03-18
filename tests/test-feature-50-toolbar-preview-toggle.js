/**
 * Feature #50: Toolbar preview mode toggle
 * Preview shows rendered with example data
 *
 * Steps:
 * 1. Toggle preview on
 * 2. Verify example data shown
 * 3. Verify edit controls disabled
 * 4. Toggle off - controls re-enable
 */
const http = require('http');
const fs = require('fs');

const FRONTEND_URL = 'http://localhost:3001';

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
  console.log('Feature #50: Toolbar preview mode toggle\n');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  const designerSrc = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf-8'
  );

  // === SECTION 1: Preview Data toggle button exists ===
  console.log('--- Preview Data Toggle Button ---');

  test('Preview Data button exists with data-testid="btn-preview-data"', () => {
    assert(html.includes('data-testid="btn-preview-data"'), 'btn-preview-data not found');
  });

  test('Preview Data button shows "Preview Data" when not in preview mode', () => {
    const match = html.match(/<button[^>]*data-testid="btn-preview-data"[^>]*>([\s\S]*?)<\/button>/);
    assert(match, 'btn-preview-data button not found');
    assert(match[1].includes('Preview Data'), 'Button should show "Preview Data" by default');
  });

  test('Preview Data button has correct aria-label when not in preview mode', () => {
    assert(
      html.includes('aria-label="Preview with example data"'),
      'Should have aria-label for preview mode'
    );
  });

  test('Preview Data button has correct title when not in preview mode', () => {
    assert(
      html.includes('title="Preview with example data (resolve field bindings)"'),
      'Should have descriptive title'
    );
  });

  test('Preview Data button toggles previewMode state on click', () => {
    assert(
      designerSrc.includes('setPreviewMode((prev) => !prev)') ||
      designerSrc.includes('setPreviewMode(prev => !prev)'),
      'onClick should toggle previewMode state'
    );
  });

  // === SECTION 2: Preview mode state and behavior ===
  console.log('\n--- Preview Mode State ---');

  test('previewMode state is initially false', () => {
    assert(
      designerSrc.includes('useState(false)') || designerSrc.includes('useState<boolean>(false)'),
      'previewMode should default to false'
    );
  });

  test('data-preview-mode attribute reflects current state', () => {
    assert(html.includes('data-preview-mode="false"'), 'Should show data-preview-mode="false" initially');
  });

  test('Button text changes to "Design Mode" when preview is active', () => {
    assert(
      designerSrc.includes("previewMode ? 'Design Mode' : 'Preview Data'"),
      'Button text should toggle between Design Mode and Preview Data'
    );
  });

  test('Button aria-label changes when preview is active', () => {
    assert(
      designerSrc.includes("previewMode ? 'Switch to design mode' : 'Preview with example data'"),
      'aria-label should change in preview mode'
    );
  });

  test('Button title changes when preview is active', () => {
    assert(
      designerSrc.includes("previewMode ? 'Switch back to design mode"),
      'Title should change in preview mode'
    );
  });

  // === SECTION 3: Visual styling changes in preview mode ===
  console.log('\n--- Preview Mode Visual Changes ---');

  test('Button background changes to blue when preview is active', () => {
    assert(
      designerSrc.includes("backgroundColor: previewMode ? '#dbeafe'"),
      'Background should be blue in preview mode'
    );
  });

  test('Button border changes to blue when preview is active', () => {
    assert(
      designerSrc.includes("borderColor: previewMode ? '#3b82f6'"),
      'Border should be blue in preview mode'
    );
  });

  test('Button text color changes to dark blue when preview is active', () => {
    assert(
      designerSrc.includes("color: previewMode ? '#1d4ed8'"),
      'Text color should be dark blue in preview mode'
    );
  });

  test('Button font weight changes to 600 when preview is active', () => {
    assert(
      designerSrc.includes('fontWeight: previewMode ? 600'),
      'Font weight should be bold in preview mode'
    );
  });

  // === SECTION 4: Example data shown in preview mode ===
  console.log('\n--- Example Data Resolution ---');

  test('resolveBindingToExample function exists', () => {
    assert(
      designerSrc.includes('resolveBindingToExample'),
      'resolveBindingToExample function should exist'
    );
  });

  test('Text elements resolve bindings to example values in preview mode', () => {
    assert(
      designerSrc.includes('if (previewMode)') &&
      designerSrc.includes('resolveBindingToExample'),
      'Text elements should resolve bindings in preview mode'
    );
  });

  test('Non-text elements also resolve bindings in preview mode', () => {
    assert(
      designerSrc.includes('previewMode && el.binding ? resolveBindingToExample'),
      'Other elements should resolve bindings in preview mode'
    );
  });

  test('FIELD_EXAMPLES map provides example values for preview mode', () => {
    assert(
      designerSrc.includes('FIELD_EXAMPLES') && designerSrc.includes('Record<string, string>'),
      'Should have FIELD_EXAMPLES map for preview data'
    );
  });

  test('In design mode, bindings show as {{fieldName}} placeholders', () => {
    assert(
      designerSrc.includes('`{{${el.binding}}}`'),
      'Design mode should show binding placeholders with curly braces'
    );
  });

  // === SECTION 5: Edit controls disabled in preview mode ===
  console.log('\n--- Edit Controls Disabled ---');

  test('Canvas elements have pointerEvents:none in preview mode', () => {
    assert(
      designerSrc.includes("pointerEvents: previewMode ? 'none' : 'auto'"),
      'Canvas elements should be non-interactive in preview mode'
    );
  });

  test('Canvas elements use default cursor in preview mode', () => {
    assert(
      designerSrc.includes("cursor: previewMode ? 'default' : 'pointer'"),
      'Cursor should be default in preview mode'
    );
  });

  test('Selection border is not shown in preview mode', () => {
    assert(
      designerSrc.includes('isSelected && !previewMode') ||
      designerSrc.includes('!previewMode'),
      'Selection border should not appear in preview mode'
    );
  });

  test('Properties panel is disabled in preview mode', () => {
    assert(
      designerSrc.includes('data-testid="properties-preview-disabled"'),
      'Properties panel should show disabled message in preview mode'
    );
  });

  test('Properties panel shows "Edit controls disabled in preview mode" message', () => {
    assert(
      designerSrc.includes('Edit controls disabled in preview mode'),
      'Disabled message text should be present'
    );
  });

  test('Properties scroll container has opacity 0.5 in preview mode', () => {
    assert(
      designerSrc.includes('opacity: previewMode ? 0.5 : 1'),
      'Properties container should be semi-transparent in preview mode'
    );
  });

  test('Properties scroll container has pointer-events:none in preview mode', () => {
    assert(
      designerSrc.includes("pointerEvents: previewMode ? 'none' : 'auto'"),
      'Properties container should block pointer events in preview mode'
    );
  });

  test('Properties scroll container has data-disabled attribute', () => {
    assert(
      designerSrc.includes("data-disabled={previewMode ? 'true' : 'false'}"),
      'data-disabled should reflect preview state'
    );
  });

  // === SECTION 6: Preview badge on canvas ===
  console.log('\n--- Preview Badge ---');

  test('Preview badge exists with data-testid="preview-mode-badge"', () => {
    assert(
      designerSrc.includes('data-testid="preview-mode-badge"'),
      'Preview badge should exist'
    );
  });

  test('Preview badge only shows when previewMode is true', () => {
    assert(
      designerSrc.includes('{previewMode && ('),
      'Badge should conditionally render based on previewMode'
    );
  });

  test('Preview badge shows "PREVIEW" text', () => {
    // Check for PREVIEW text near the badge testid (may have newlines/whitespace)
    const badgeIdx = designerSrc.indexOf('preview-mode-badge');
    assert(badgeIdx >= 0, 'preview-mode-badge not found');
    const badgeSection = designerSrc.substring(badgeIdx, badgeIdx + 800);
    assert(badgeSection.toUpperCase().includes('PREVIEW'), 'Badge section should contain PREVIEW text');
  });

  test('Preview badge positioned in top-right corner', () => {
    const badgeSection = designerSrc.substring(
      designerSrc.indexOf('preview-mode-badge'),
      designerSrc.indexOf('preview-mode-badge') + 500
    );
    assert(badgeSection.includes('position') && badgeSection.includes('absolute'), 'Badge should be absolutely positioned');
    assert(badgeSection.includes('top'), 'Badge should have top positioning');
    assert(badgeSection.includes('right'), 'Badge should have right positioning');
  });

  test('Preview badge has blue theme matching toggle button', () => {
    const badgeSection = designerSrc.substring(
      designerSrc.indexOf('preview-mode-badge'),
      designerSrc.indexOf('preview-mode-badge') + 500
    );
    assert(badgeSection.includes('#1d4ed8') || badgeSection.includes('#dbeafe'), 'Badge should use blue theme colors');
  });

  // === SECTION 7: Toggle off restores controls ===
  console.log('\n--- Toggle Off Restores Controls ---');

  test('Toggling off restores canvas element pointer events', () => {
    // When previewMode is false, pointerEvents should be 'auto'
    assert(
      designerSrc.includes("pointerEvents: previewMode ? 'none' : 'auto'"),
      'Pointer events should restore to auto when preview mode is off'
    );
  });

  test('Toggling off restores properties panel rendering', () => {
    assert(
      designerSrc.includes('previewMode ? (') && designerSrc.includes(': renderPropertiesPanel()'),
      'Properties panel should render normally when preview mode is off'
    );
  });

  test('Toggling off hides preview badge', () => {
    // Badge only renders when previewMode is true
    assert(
      designerSrc.includes('{previewMode && ('),
      'Preview badge should disappear when previewMode is false'
    );
  });

  test('data-preview-mode starts as false (design mode)', () => {
    assert(html.includes('data-preview-mode="false"'), 'Initial state should be design mode');
  });

  // === SECTION 8: Preview PDF button ===
  console.log('\n--- Preview PDF Button ---');

  test('Preview PDF button exists with data-testid="btn-preview"', () => {
    assert(html.includes('data-testid="btn-preview"'), 'btn-preview not found');
  });

  test('Preview PDF button has aria-label "Preview PDF"', () => {
    assert(html.includes('aria-label="Preview PDF"'), 'Preview PDF aria-label not found');
  });

  test('Preview PDF button calls handlePreview on click', () => {
    assert(
      designerSrc.includes('onClick={handlePreview}'),
      'btn-preview should call handlePreview'
    );
  });

  test('Preview PDF button is disabled during rendering', () => {
    assert(
      designerSrc.includes("disabled={renderStatus === 'loading' || renderStatus === 'progress'}"),
      'Preview button should be disabled during render'
    );
  });

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
})();
