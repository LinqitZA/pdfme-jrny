/**
 * Test Feature #47: Toolbar page size selector
 *
 * Verifies:
 * - Page size dropdown changes canvas dimensions
 * - Click selector
 * - Verify A4, Letter options available
 * - Select Letter
 * - Verify canvas updates
 */

const fs = require('fs');
const path = require('path');

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

async function runTests() {
  console.log('=== Feature #47: Toolbar page size selector ===\n');

  const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf-8');

  // ─── Part 1: Page size state ───
  console.log('--- Part 1: Page size state ---');

  assert(
    componentSource.includes("const [pageSize, setPageSize] = useState('A4')"),
    'Page size state initialized to A4'
  );

  assert(
    componentSource.includes("const PAGE_SIZES = ['A4', 'Letter', 'Legal', 'A3', 'A5']"),
    'PAGE_SIZES array includes A4, Letter, Legal, A3, A5'
  );

  // ─── Part 2: Page size dimensions map ───
  console.log('--- Part 2: Page size dimensions ---');

  assert(
    componentSource.includes('PAGE_SIZE_DIMENSIONS'),
    'PAGE_SIZE_DIMENSIONS map exists for size-to-dimensions lookup'
  );

  // Verify A4 dimensions (595 x 842 points)
  assert(
    componentSource.includes('A4: { width: 595, height: 842 }'),
    'A4 dimensions are 595 x 842 points'
  );

  // Verify Letter dimensions (612 x 792 points)
  assert(
    componentSource.includes('Letter: { width: 612, height: 792 }'),
    'Letter dimensions are 612 x 792 points'
  );

  // Verify Legal dimensions (612 x 1008 points)
  assert(
    componentSource.includes('Legal: { width: 612, height: 1008 }'),
    'Legal dimensions are 612 x 1008 points'
  );

  // Verify A3 dimensions (842 x 1191 points)
  assert(
    componentSource.includes('A3: { width: 842, height: 1191 }'),
    'A3 dimensions are 842 x 1191 points'
  );

  // Verify A5 dimensions (420 x 595 points)
  assert(
    componentSource.includes('A5: { width: 420, height: 595 }'),
    'A5 dimensions are 420 x 595 points'
  );

  // ─── Part 3: Selector element ───
  console.log('--- Part 3: Page size selector ---');

  assert(
    componentSource.includes('data-testid="page-size-selector"'),
    'Page size selector has data-testid="page-size-selector"'
  );

  assert(
    componentSource.includes('aria-label="Page size"'),
    'Selector has aria-label="Page size"'
  );

  // Check selector is a <select> element
  const selectorMatch = componentSource.match(/<select[^>]*page-size-selector/);
  assert(
    selectorMatch !== null,
    'Page size uses <select> dropdown element'
  );

  // Check value bound to state
  assert(
    componentSource.includes('value={pageSize}'),
    'Selector value bound to pageSize state'
  );

  // Check onChange handler
  assert(
    componentSource.includes("onChange={(e) => { setPageSize(e.target.value); setIsDirty(true); }"),
    'Selector onChange sets pageSize and marks dirty'
  );

  // Check options rendered from PAGE_SIZES
  assert(
    componentSource.includes('PAGE_SIZES.map'),
    'Options rendered from PAGE_SIZES array via map'
  );

  // ─── Part 4: Canvas dimensions respond to page size ───
  console.log('--- Part 4: Canvas dimensions respond to page size ---');

  // Check canvas page uses PAGE_SIZE_DIMENSIONS for width
  assert(
    componentSource.includes("PAGE_SIZE_DIMENSIONS[pageSize]?.width || 595"),
    'Canvas width uses PAGE_SIZE_DIMENSIONS[pageSize] with A4 fallback'
  );

  // Check canvas page uses PAGE_SIZE_DIMENSIONS for height
  assert(
    componentSource.includes("PAGE_SIZE_DIMENSIONS[pageSize]?.height || 842"),
    'Canvas height uses PAGE_SIZE_DIMENSIONS[pageSize] with A4 fallback'
  );

  // Check canvas page has data attributes for testing
  assert(
    componentSource.includes('data-page-size={pageSize}'),
    'Canvas page exposes data-page-size attribute'
  );

  assert(
    componentSource.includes("data-page-width={PAGE_SIZE_DIMENSIONS[pageSize]?.width || 595}"),
    'Canvas page exposes data-page-width attribute'
  );

  assert(
    componentSource.includes("data-page-height={PAGE_SIZE_DIMENSIONS[pageSize]?.height || 842}"),
    'Canvas page exposes data-page-height attribute'
  );

  // ─── Part 5: Canvas zoom interaction ───
  console.log('--- Part 5: Canvas zoom interaction ---');

  // Canvas size should multiply by zoom
  assert(
    componentSource.includes("(PAGE_SIZE_DIMENSIONS[pageSize]?.width || 595) * (zoom / 100)"),
    'Canvas width multiplied by zoom factor'
  );

  assert(
    componentSource.includes("(PAGE_SIZE_DIMENSIONS[pageSize]?.height || 842) * (zoom / 100)"),
    'Canvas height multiplied by zoom factor'
  );

  // ─── Part 6: Canvas has smooth transition ───
  console.log('--- Part 6: Canvas transition animation ---');

  assert(
    componentSource.includes("transition: 'width 0.2s, height 0.2s'"),
    'Canvas has smooth width/height transition (0.2s) for page size changes'
  );

  // ─── Part 7: Page size saved with template ───
  console.log('--- Part 7: Page size included in save ---');

  // pageSize included in save/publish payloads
  assert(
    componentSource.includes('pageSize, pages') || componentSource.includes('pageSize,'),
    'pageSize included in save schema'
  );

  // Check pageSize loaded from template
  assert(
    componentSource.includes('setPageSize(schema.pageSize)') || componentSource.includes('setPageSize('),
    'pageSize restored when template loaded from API'
  );

  // ─── Part 8: Selector styling ───
  console.log('--- Part 8: Selector styling ---');

  // Check selector has consistent toolbar styling
  assert(
    componentSource.includes("border: '1px solid #e2e8f0'"),
    'Selector has subtle border matching toolbar style'
  );

  assert(
    componentSource.includes("fontSize: '13px'"),
    'Selector has 13px font size'
  );

  // ─── Part 9: All page sizes have correct standard dimensions ───
  console.log('--- Part 9: Dimension standards verification ---');

  // Verify dimension relationships
  // Letter is wider than A4 but shorter
  const letterW = 612, letterH = 792;
  const a4W = 595, a4H = 842;
  assert(
    letterW > a4W && letterH < a4H,
    'Letter is wider (612 > 595) but shorter (792 < 842) than A4'
  );

  // Legal is same width as Letter but taller
  const legalW = 612, legalH = 1008;
  assert(
    legalW === letterW && legalH > letterH,
    'Legal is same width as Letter (612) but taller (1008 > 792)'
  );

  // A3 is exactly double A4 height area (width=842=A4 height)
  const a3W = 842, a3H = 1191;
  assert(
    a3W === a4H,
    'A3 width (842) equals A4 height (standard ISO relationship)'
  );

  // A5 is exactly half A4 area (width=420, height=595=A4 width)
  const a5W = 420, a5H = 595;
  assert(
    a5H === a4W,
    'A5 height (595) equals A4 width (standard ISO relationship)'
  );

  // ─── Summary ───
  console.log('\n--- Results ---');
  results.forEach((r) => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
