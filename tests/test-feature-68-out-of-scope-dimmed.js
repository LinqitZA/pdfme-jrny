/**
 * Feature #68: Out-of-scope elements dimmed with badge
 * Elements outside scope at 50% opacity
 *
 * Steps:
 * 1. Set pageScope=first on element
 * 2. View page 2
 * 3. Verify 50% opacity
 * 4. Verify scope badge
 *
 * Tests source code and SSR HTML for out-of-scope element behavior.
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
  console.log('Feature #68: Out-of-scope elements dimmed with badge\n');

  let html;
  let source;
  try {
    html = await fetchPage(FRONTEND_URL);
    source = fs.readFileSync(SOURCE_FILE, 'utf8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: DesignElement pageScope Property ===
  console.log('--- pageScope Property ---');

  test('DesignElement type includes pageScope property', () => {
    assert(source.includes("pageScope?: 'all' | 'first' | 'last' | 'notFirst'"), 'pageScope type not found');
  });

  test('pageScope defaults to "all" when not set', () => {
    assert(source.includes("el.pageScope || 'all'"), 'pageScope default not found');
  });

  test('pageScope property editor exists in Properties panel', () => {
    assert(source.includes('data-testid="prop-page-scope"'), 'prop-page-scope testid not found');
  });

  test('pageScope selector has all four options', () => {
    // Options: all, first, last, notFirst
    assert(source.includes("value=\"all\"") || source.includes("'all'"), 'all option missing');
    assert(source.includes("'first'"), 'first option missing');
    assert(source.includes("'last'"), 'last option missing');
    assert(source.includes("'notFirst'"), 'notFirst option missing');
  });

  // === SECTION 2: Out-of-scope Opacity ===
  console.log('\n--- Out-of-scope Opacity (50%) ---');

  test('Out-of-scope elements have 0.5 opacity', () => {
    assert(source.includes("opacity: isOutOfScope ? 0.5 : 1"), '0.5 opacity for out-of-scope not found');
  });

  test('In-scope elements have full opacity (1)', () => {
    assert(source.includes("opacity: isOutOfScope ? 0.5 : 1"), 'Full opacity for in-scope not found');
  });

  test('Opacity transition is smooth (0.2s ease)', () => {
    const transition = source.match(/data-out-of-scope[\s\S]{0,500}transition: 'opacity 0\.2s ease'/);
    assert(transition, 'Smooth opacity transition not found');
  });

  test('Out-of-scope elements have pointerEvents none', () => {
    assert(source.includes("pointerEvents: isOutOfScope ? 'none' : 'auto'"), 'pointerEvents none for out-of-scope not found');
  });

  // === SECTION 3: Scope Badge ===
  console.log('\n--- Scope Badge ---');

  test('Scope badge rendered for out-of-scope elements', () => {
    assert(source.includes('scope-badge'), 'scope-badge class not found');
  });

  test('Scope badge has data-testid with element ID', () => {
    assert(source.includes('data-testid={`scope-badge-${el.id}`}'), 'scope-badge testid not found');
  });

  test('Scope badge shows "First only" for first-page-scope elements', () => {
    assert(source.includes("first: 'First only'"), 'First only label not found');
  });

  test('Scope badge shows "Last only" for last-page-scope elements', () => {
    assert(source.includes("last: 'Last only'"), 'Last only label not found');
  });

  test('Scope badge shows "Not first" for notFirst-scope elements', () => {
    assert(source.includes("notFirst: 'Not first'"), 'Not first label not found');
  });

  test('Scope badge only shows when element is out of scope (not for all)', () => {
    assert(source.includes("isOutOfScope && scope !== 'all'"), 'Badge visibility guard not found');
  });

  test('Scope badge has purple color scheme', () => {
    const badgeStyle = source.match(/scope-badge[\s\S]{0,500}color: '#9333ea'/);
    assert(badgeStyle, 'Purple text color not found for scope badge');
  });

  test('Scope badge has light purple background', () => {
    const badgeStyle = source.match(/scope-badge[\s\S]{0,500}backgroundColor: '#f3e8ff'/);
    assert(badgeStyle, 'Light purple background not found for scope badge');
  });

  test('Scope badge has purple border', () => {
    const badgeStyle = source.match(/scope-badge[\s\S]{0,500}border: '1px solid #d8b4fe'/);
    assert(badgeStyle, 'Purple border not found for scope badge');
  });

  test('Scope badge is positioned at top-right of element', () => {
    const position = source.match(/scope-badge[\s\S]{0,300}position: 'absolute'/);
    assert(position, 'Badge not absolutely positioned');
  });

  test('Scope badge has zIndex for visibility', () => {
    const zIndex = source.match(/scope-badge[\s\S]{0,800}zIndex: 10/);
    assert(zIndex, 'Badge zIndex not found');
  });

  // === SECTION 4: Page Scope Visibility Logic ===
  console.log('\n--- Page Scope Visibility Logic ---');

  test('isElementVisibleInSimulation function exists', () => {
    assert(source.includes('const isElementVisibleInSimulation = useCallback'), 'isElementVisibleInSimulation not found');
  });

  test('Simulator off shows all elements', () => {
    assert(source.includes("if (pageSimulatorCount === null) return true"), 'Simulator off check not found');
  });

  test('scope=all always visible', () => {
    assert(source.includes("if (scope === 'all') return true"), 'scope all always visible check not found');
  });

  test('scope=first visible only on first page', () => {
    assert(source.includes("case 'first': return isFirstPage"), 'first scope logic not found');
  });

  test('scope=last visible only on last page', () => {
    assert(source.includes("case 'last': return isLastPage"), 'last scope logic not found');
  });

  test('scope=notFirst visible on pages after first', () => {
    assert(source.includes("case 'notFirst': return !isFirstPage"), 'notFirst scope logic not found');
  });

  test('isFirstPage checks currentPageIndex === 0', () => {
    assert(source.includes('const isFirstPage = currentPageIndex === 0'), 'isFirstPage check not found');
  });

  // === SECTION 5: Data Attributes for Testing ===
  console.log('\n--- Data Attributes ---');

  test('Elements have data-sim-hidden attribute', () => {
    assert(source.includes("data-sim-hidden={simHidden ? 'true' : 'false'}"), 'data-sim-hidden not found');
  });

  test('Elements have data-page-scope attribute', () => {
    assert(source.includes('data-page-scope={'), 'data-page-scope attribute not found');
  });

  test('Elements have data-out-of-scope attribute', () => {
    assert(source.includes("data-out-of-scope={isOutOfScope ? 'true' : 'false'}"), 'data-out-of-scope not found');
  });

  // === SECTION 6: Page Simulator ===
  console.log('\n--- Page Simulator ---');

  test('Page simulator exists for testing pageScope', () => {
    assert(source.includes('page-sim-1') || source.includes('pageSimulatorCount'), 'Page simulator not found');
  });

  test('Page simulator buttons exist in HTML', () => {
    assert(html.includes('data-testid="page-sim-1"'), 'page-sim-1 not in HTML');
    assert(html.includes('data-testid="page-sim-2"'), 'page-sim-2 not in HTML');
    assert(html.includes('data-testid="page-sim-3"'), 'page-sim-3 not in HTML');
  });

  test('Page simulator toggles simulated page count', () => {
    assert(source.includes('pageSimulatorCount'), 'pageSimulatorCount state not found');
  });

  // === SECTION 7: Properties Panel Scope Badge ===
  console.log('\n--- Properties Panel Scope Badge ---');

  test('Properties panel shows page scope badge', () => {
    assert(source.includes('data-testid="page-scope-badge"'), 'page-scope-badge not found');
  });

  test('Properties badge shows "First page only" for first scope', () => {
    assert(source.includes("'first' && 'First page only'") || source.includes("First page only"), 'First page only text not found');
  });

  test('Properties badge shows "Last page only" for last scope', () => {
    assert(source.includes("'last' && 'Last page only'") || source.includes("Last page only"), 'Last page only text not found');
  });

  test('Properties badge shows "Not first page" for notFirst scope', () => {
    assert(source.includes("'notFirst' && 'Not first page'") || source.includes("Not first page"), 'Not first page text not found');
  });

  // === SECTION 8: SSR HTML Verification ===
  console.log('\n--- SSR HTML Verification ---');

  test('Designer root renders', () => {
    assert(html.includes('data-testid="erp-designer-root"'), 'Designer root not found');
  });

  test('Canvas page renders', () => {
    assert(html.includes('data-testid="canvas-page"'), 'Canvas page not found');
  });

  // === SUMMARY ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
})();
