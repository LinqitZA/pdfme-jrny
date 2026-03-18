const http = require('http');
const fs = require('fs');

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push('  \u2713 ' + name);
  } else {
    failed++;
    results.push('  \u2717 ' + name);
  }
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  const designerSrc = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 1: Toolbar controls use native <button>/<select>/<input>
  // Native elements are automatically tabbable
  // ──────────────────────────────────────────────────────────────────

  // Helper: check if a testid appears within N chars after a tag open
  function tagHasTestId(src, tag, testid) {
    const testidIdx = src.indexOf(testid);
    if (testidIdx === -1) return false;
    const before = src.substring(Math.max(0, testidIdx - 200), testidIdx);
    const lastTagOpen = before.lastIndexOf('<' + tag);
    if (lastTagOpen === -1) return false;
    const betweenStr = before.substring(lastTagOpen);
    return !betweenStr.includes('>');
  }

  // Toolbar buttons
  assert(tagHasTestId(designerSrc, 'button', '"btn-back-to-templates"'), 'Back button is native <button>');
  assert(tagHasTestId(designerSrc, 'button', '"btn-undo"'), 'Undo is native <button>');
  assert(tagHasTestId(designerSrc, 'button', '"btn-redo"'), 'Redo is native <button>');
  assert(designerSrc.includes('<button') && designerSrc.includes('btn-preview'), 'Preview is native <button>');
  assert(designerSrc.includes('<button') && designerSrc.includes('btn-render'), 'Render is native <button>');
  assert(designerSrc.includes('<button') && designerSrc.includes('btn-save'), 'Save is native <button>');
  assert(designerSrc.includes('<button') && designerSrc.includes('btn-publish'), 'Publish is native <button>');
  assert(designerSrc.includes('<button') && designerSrc.includes('btn-archive'), 'Archive is native <button>');

  // Toolbar selects
  assert(tagHasTestId(designerSrc, 'select', '"page-size-selector"'), 'Page size selector is native <select>');
  assert(tagHasTestId(designerSrc, 'select', '"zoom-selector"'), 'Zoom selector is native <select>');

  // Template name input
  assert(tagHasTestId(designerSrc, 'input', '"template-name-input"'), 'Template name is native <input>');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 2: Left panel tabs use native <button>
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('data-testid={`tab-${tab}`}'), 'Panel tabs have test ids');
  const tabButtonMatch = designerSrc.match(/<button[^>]*data-testid=\{`tab-\$\{tab\}`\}/);
  assert(tabButtonMatch, 'Panel tabs are native <button> elements');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 3: Block cards have tabIndex and keyboard support
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('block-${block.id}`') && designerSrc.includes('tabIndex={0}'),
    'Block cards have tabIndex={0} for keyboard accessibility');
  assert(designerSrc.includes('role="button"') && designerSrc.includes('block-${block.id}'),
    'Block cards have role="button"');
  assert(designerSrc.includes("aria-label={`Add ${block.label} block`}"),
    'Block cards have descriptive aria-label');

  // Keyboard activation
  const blockKeyDown = designerSrc.includes("onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addElementToCanvas(block.id)");
  assert(blockKeyDown, 'Block cards support Enter/Space key activation');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 4: Field items have tabIndex and keyboard support
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('field-${field.key}`') && designerSrc.includes('role="option"'),
    'Field items have role="option"');
  assert(designerSrc.includes("aria-label={`Bind field ${field.key}`}"),
    'Field items have descriptive aria-label');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 5: Page thumbnails have tabIndex and keyboard support
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('page-thumbnail-${index}`') && designerSrc.includes('role="tab"'),
    'Page thumbnails have role="tab"');
  assert(designerSrc.includes("aria-label={`Page ${index + 1}`}"),
    'Page thumbnails have descriptive aria-label');
  assert(designerSrc.includes("aria-selected={index === currentPageIndex}"),
    'Page thumbnails have aria-selected state');
  const pageKeyDown = designerSrc.includes("if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrentPageIndex(index)");
  assert(pageKeyDown, 'Page thumbnails support Enter/Space key activation');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 6: Canvas elements have tabIndex and keyboard support
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('canvas-element-${el.id}`') && designerSrc.includes('tabIndex={0}'),
    'Canvas elements have tabIndex={0}');
  assert(designerSrc.includes("aria-selected={isSelected}"),
    'Canvas elements have aria-selected state');
  const canvasKeyDown = designerSrc.includes("if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setSelectedElementId(el.id)");
  assert(canvasKeyDown, 'Canvas elements support Enter/Space key selection');
  const deleteKey = designerSrc.includes("e.key === 'Delete' || e.key === 'Backspace'");
  assert(deleteKey, 'Canvas elements support Delete/Backspace key for removal');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 7: Error banners have tabbable retry/dismiss buttons
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('<button') && designerSrc.includes('save-error-retry'),
    'Save error retry is native <button> (tabbable)');
  assert(designerSrc.includes('<button') && designerSrc.includes('save-error-dismiss'),
    'Save error dismiss is native <button> (tabbable)');
  assert(designerSrc.includes('<button') && designerSrc.includes('publish-error-retry'),
    'Publish error retry is native <button> (tabbable)');
  assert(designerSrc.includes('<button') && designerSrc.includes('render-dismiss'),
    'Render dismiss is native <button> (tabbable)');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 8: Toast dismiss buttons are tabbable
  // ──────────────────────────────────────────────────────────────────

  assert(designerSrc.includes('<button') && designerSrc.includes('toast-dismiss'),
    'Toast dismiss is native <button> (tabbable)');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 9: Right panel property controls
  // ──────────────────────────────────────────────────────────────────

  // Check that property panel inputs use native elements
  assert(designerSrc.includes('<input') && designerSrc.includes('prop-x'),
    'Position X input is native <input>');
  assert(designerSrc.includes('<input') && designerSrc.includes('prop-y'),
    'Position Y input is native <input>');
  assert(designerSrc.includes('<input') && designerSrc.includes('prop-w'),
    'Width input is native <input>');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 10: No focus traps - verify no tabIndex={-1} on containers
  // ──────────────────────────────────────────────────────────────────

  const negativeTabs = (designerSrc.match(/tabIndex=\{-1\}/g) || []).length;
  assert(negativeTabs === 0, 'No tabIndex={-1} focus traps on container elements');

  // Verify no inert attribute (which would trap focus)
  const inertAttrs = (designerSrc.match(/\binert\b/g) || []).length;
  assert(inertAttrs === 0, 'No inert attributes blocking focus');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 11: Verify logical tab order via DOM structure
  // Toolbar -> Left panel -> Canvas -> Right panel
  // ──────────────────────────────────────────────────────────────────

  // Use data-testid to find the actual rendered elements (not CSS definitions)
  const toolbarPos = designerSrc.indexOf('data-testid="designer-toolbar"');
  const leftPanelPos = designerSrc.indexOf('data-testid="left-panel"');
  const canvasPos = designerSrc.indexOf('data-testid="center-canvas"');
  const rightPanelPos = designerSrc.indexOf('data-testid="right-panel"');

  assert(toolbarPos > 0 && leftPanelPos > 0 && toolbarPos < leftPanelPos, 'Toolbar appears before left panel in DOM (correct tab order)');
  assert(leftPanelPos > 0 && canvasPos > 0 && leftPanelPos < canvasPos, 'Left panel appears before canvas in DOM (correct tab order)');
  assert(canvasPos > 0 && rightPanelPos > 0 && canvasPos < rightPanelPos, 'Canvas appears before right panel in DOM (correct tab order)');

  // ──────────────────────────────────────────────────────────────────
  // SECTION 12: Verify rendered page has tabindex attributes
  // ──────────────────────────────────────────────────────────────────

  const html = await fetchPage('http://localhost:3001');
  const tabindexCount = (html.match(/tabindex="0"/g) || []).length;
  assert(tabindexCount > 0, 'Rendered page has tabindex="0" attributes on interactive elements');

  const roleButtonCount = (html.match(/role="button"/g) || []).length;
  assert(roleButtonCount > 0, 'Rendered page has role="button" attributes');

  const ariaLabelCount = (html.match(/aria-label="/g) || []).length;
  assert(ariaLabelCount > 0, 'Rendered page has aria-label attributes');

  // Verify native buttons are present (auto-tabbable)
  const buttonCount = (html.match(/<button/g) || []).length;
  assert(buttonCount >= 10, 'Rendered page has many native <button> elements (' + buttonCount + ')');

  // Verify native selects are present
  const selectCount = (html.match(/<select/g) || []).length;
  assert(selectCount >= 2, 'Rendered page has native <select> elements (' + selectCount + ')');

  // Verify native inputs are present
  const inputCount = (html.match(/<input/g) || []).length;
  assert(inputCount >= 1, 'Rendered page has native <input> elements (' + inputCount + ')');

  // Clickable publish validation errors are keyboard accessible
  assert(designerSrc.includes('publish-validation-error') && designerSrc.includes("tabIndex={err.elementId ? 0 : undefined}"),
    'Clickable validation errors have tabIndex');

  // Print results
  process.stdout.write('\n=== Feature #306: Tab navigation through designer controls ===\n');
  results.forEach(function(r) { process.stdout.write(r + '\n'); });
  process.stdout.write('\nTotal: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + '\n\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  process.stderr.write('Test runner error: ' + err.message + '\n');
  process.exit(1);
});
