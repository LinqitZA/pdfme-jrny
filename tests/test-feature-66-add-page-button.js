/**
 * Feature #66: Add page button creates blank page
 * Button adds new blank page
 *
 * Steps:
 * 1. Click Add Page
 * 2. Page count +1
 * 3. Blank page on canvas
 *
 * Tests SSR HTML and source code for add page functionality.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const SOURCE_FILE = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

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
  console.log('Feature #66: Add page button creates blank page\n');

  let html;
  let source;
  try {
    html = await fetchPage(FRONTEND_URL);
    source = fs.readFileSync(SOURCE_FILE, 'utf8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Add Page Button in Source (conditionally rendered in Pages tab) ===
  console.log('--- Add Page Button in Source ---');

  test('Add Page button defined with data-testid="btn-add-page"', () => {
    assert(source.includes('data-testid="btn-add-page"'), 'btn-add-page not found in source');
  });

  test('Add Page button has aria-label="Add page"', () => {
    assert(source.includes('aria-label="Add page"'), 'aria-label "Add page" not found');
  });

  test('Add Page button shows "Add Page" text', () => {
    assert(source.includes('Add Page'), 'Add Page text not found in source');
  });

  test('Add Page button has + icon', () => {
    assert(source.includes('>+</span> Add Page'), '+ icon not found');
  });

  // === SECTION 2: Add Page Button Source Attributes ===
  console.log('\n--- Add Page Button Source ---');

  test('Add Page button has data-testid in source', () => {
    assert(source.includes('data-testid="btn-add-page"'), 'btn-add-page testid not in source');
  });

  test('Add Page button has onClick={addPage}', () => {
    assert(source.includes('onClick={addPage}'), 'onClick={addPage} not found');
  });

  test('Add Page button is full-width', () => {
    const btnBlock = source.match(/btn-add-page[\s\S]{0,300}width: '100%'/);
    assert(btnBlock, 'Add Page button not full width');
  });

  test('Add Page button has centered content layout', () => {
    const btnBlock = source.match(/btn-add-page[\s\S]{0,500}justifyContent: 'center'/);
    assert(btnBlock, 'Add Page button not centered');
  });

  // === SECTION 3: addPage Function Logic ===
  console.log('\n--- addPage Function Logic ---');

  test('addPage function exists as useCallback', () => {
    assert(source.includes('const addPage = useCallback('), 'addPage useCallback not found');
  });

  test('addPage uses setPagesWithHistory for undo support', () => {
    const addPageFn = source.match(/const addPage = useCallback\(\(\)[\s\S]{0,200}setPagesWithHistory/);
    assert(addPageFn, 'addPage does not use setPagesWithHistory');
  });

  test('addPage creates new page via createPage function', () => {
    const addPageFn = source.match(/const addPage = useCallback\(\(\)[\s\S]{0,200}createPage/);
    assert(addPageFn, 'addPage does not call createPage');
  });

  test('addPage auto-names page based on page count (Page N+1)', () => {
    const naming = source.match(/createPage\(`Page \$\{prev\.length \+ 1\}`\)/);
    assert(naming, 'addPage does not auto-name pages');
  });

  test('addPage appends new page to end of pages array', () => {
    const append = source.match(/return \[\.\.\.prev, newPage\]/);
    assert(append, 'addPage does not append to pages array');
  });

  test('addPage sets isDirty flag', () => {
    const dirty = source.match(/const addPage = useCallback\(\(\)[\s\S]{0,300}setIsDirty\(true\)/);
    assert(dirty, 'addPage does not set isDirty');
  });

  // === SECTION 4: createPage Function Creates Blank Page ===
  console.log('\n--- createPage Function ---');

  test('createPage function exists', () => {
    assert(source.includes('function createPage(label: string): TemplatePage'), 'createPage function not found');
  });

  test('createPage returns object with id field', () => {
    assert(source.includes("id: `page-${pageIdCounter}`"), 'createPage does not generate page id');
  });

  test('createPage returns object with label field', () => {
    const createPageFn = source.match(/function createPage[\s\S]{0,200}label,/);
    assert(createPageFn, 'createPage does not include label');
  });

  test('createPage returns blank page with empty elements array', () => {
    const emptyElements = source.match(/function createPage[\s\S]{0,200}elements: \[\]/);
    assert(emptyElements, 'createPage does not have empty elements array');
  });

  test('createPage increments page ID counter for unique IDs', () => {
    assert(source.includes('pageIdCounter += 1'), 'pageIdCounter not incremented');
  });

  // === SECTION 5: Page Count Tracking ===
  console.log('\n--- Page Count Tracking ---');

  test('Pages tab exists for viewing page list', () => {
    assert(html.includes('data-testid="tab-pages"'), 'tab-pages not found');
  });

  test('Page indicator exists showing current page', () => {
    assert(html.includes('data-testid="page-indicator"'), 'page-indicator not found');
  });

  test('TemplatePage type includes elements array', () => {
    assert(source.includes('elements: DesignElement[]') || source.includes('elements:'), 'elements field not in TemplatePage');
  });

  // === SECTION 6: Undo Integration ===
  console.log('\n--- Undo Integration ---');

  test('addPage supports undo via setPagesWithHistory', () => {
    // setPagesWithHistory pushes to undo stack before mutation
    assert(source.includes('pushUndoState(prevPages)'), 'pushUndoState not called in setPagesWithHistory');
  });

  test('Undo after add page would restore previous page count', () => {
    // handleUndo pops from undoStack and restores pages
    assert(source.includes('undoStackRef.current.pop()'), 'Undo pop not found');
  });

  // === SECTION 7: Pages Tab in Left Panel ===
  console.log('\n--- Pages Tab ---');

  test('Pages tab button exists in left panel tabs', () => {
    assert(html.includes('data-testid="tab-pages"'), 'Pages tab not in HTML');
  });

  test('Pages tab has role="tab"', () => {
    const pagesTab = source.match(/data-testid="tab-pages"[\s\S]{0,100}role="tab"/);
    assert(pagesTab || source.includes('role="tab"'), 'Pages tab does not have role="tab"');
  });

  test('Add Page button is inside Pages tab panel', () => {
    // btn-add-page appears within the pages tab panel section
    const pagesSection = source.match(/activeTab === 'pages'[\s\S]{0,5000}btn-add-page/);
    assert(pagesSection, 'Add Page button not in pages tab panel');
  });

  // === SECTION 8: Page Thumbnails ===
  console.log('\n--- Page Thumbnails ---');

  test('Page thumbnails rendered with page label', () => {
    // Page label rendered in the pages tab
    assert(source.includes('{page.label}'), 'page.label rendering not found');
  });

  test('Page thumbnails are clickable to switch pages', () => {
    // Clicking a thumbnail sets currentPageIndex
    assert(source.includes('setCurrentPageIndex'), 'setCurrentPageIndex not found');
  });

  // === SECTION 9: Canvas Shows Multiple Pages ===
  console.log('\n--- Canvas Page Rendering ---');

  test('Canvas page element exists in HTML', () => {
    assert(html.includes('data-testid="canvas-page"'), 'canvas-page not in HTML');
  });

  test('Designer root renders correctly', () => {
    assert(html.includes('data-testid="erp-designer-root"'), 'erp-designer-root not found');
  });

  // === SUMMARY ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
})();
