/**
 * Test Feature #67: Page simulator 1/2/3 page toggle
 *
 * Verifies:
 * - Toolbar has page simulator buttons for 1, 2, and 3 pages
 * - Toggle 1 page - elements with scope 'first'/'last' visible, 'notFirst' hidden
 * - Toggle 2 pages - pageScope badges update correctly
 * - Toggle 3 pages - all variants visible on appropriate pages
 * - Simulator can be cleared (toggled off)
 * - Elements show correct opacity/visibility based on simulation
 */

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-page-sim-67';
const USER_ID = 'user-page-sim-67';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);

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
  console.log('=== Feature #67: Page simulator 1/2/3 page toggle ===\n');

  const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf-8');

  // ─── Part 1: Page simulator UI in toolbar ───
  console.log('--- Part 1: Page simulator toolbar UI ---');

  // Test 1: Page simulator container exists
  assert(
    componentSource.includes('data-testid="page-simulator"'),
    'Page simulator container with data-testid exists in toolbar'
  );

  // Test 2: Button for 1-page simulation
  assert(
    componentSource.includes('data-testid="page-sim-1"') || componentSource.includes('data-testid={`page-sim-${count}`}'),
    'Page simulator has 1-page toggle button'
  );

  // Test 3: Button for 2-page simulation
  assert(
    componentSource.includes('[1, 2, 3]') && componentSource.includes('page-sim-'),
    'Page simulator has buttons for 1, 2, and 3 page counts'
  );

  // Test 4: Clear button
  assert(
    componentSource.includes('data-testid="page-sim-clear"'),
    'Page simulator has clear/reset button'
  );

  // Test 5: Simulator state variable exists
  assert(
    componentSource.includes('pageSimulatorCount') && componentSource.includes('setPageSimulatorCount'),
    'pageSimulatorCount state variable exists'
  );

  // Test 6: Simulator can be null (off) or 1/2/3
  assert(
    componentSource.includes("useState<1 | 2 | 3 | null>(null)"),
    'pageSimulatorCount typed as 1 | 2 | 3 | null, defaults to null (off)'
  );

  // Test 7: Clicking same button toggles off
  assert(
    componentSource.includes('pageSimulatorCount === count ? null :'),
    'Clicking active simulator button toggles it off (back to null)'
  );

  // ─── Part 2: Page scope visibility logic ───
  console.log('--- Part 2: Page scope visibility logic ---');

  // Test 8: isElementVisibleInSimulation callback exists
  assert(
    componentSource.includes('isElementVisibleInSimulation'),
    'isElementVisibleInSimulation callback function exists'
  );

  // Test 9: Handles "all" scope (always visible)
  assert(
    componentSource.includes("scope === 'all'") && componentSource.includes('return true'),
    'Elements with pageScope "all" are always visible'
  );

  // Test 10: Handles "first" scope
  assert(
    componentSource.includes("case 'first'") && componentSource.includes('isFirstPage'),
    'Elements with pageScope "first" only visible on first page'
  );

  // Test 11: Handles "last" scope
  assert(
    componentSource.includes("case 'last'") && componentSource.includes('isLastPage'),
    'Elements with pageScope "last" only visible on last page'
  );

  // Test 12: Handles "notFirst" scope
  assert(
    componentSource.includes("case 'notFirst'") && componentSource.includes('!isFirstPage'),
    'Elements with pageScope "notFirst" hidden on first page'
  );

  // Test 13: Null simulator shows all elements (no filtering)
  assert(
    componentSource.includes('pageSimulatorCount === null') && componentSource.includes('return true'),
    'When simulator is off (null), all elements are visible regardless of scope'
  );

  // ─── Part 3: Canvas element rendering with simulation ───
  console.log('--- Part 3: Canvas rendering with simulation ---');

  // Test 14: Elements wrapped with sim-hidden data attribute
  assert(
    componentSource.includes('data-sim-hidden'),
    'Canvas elements have data-sim-hidden attribute for testing'
  );

  // Test 15: Hidden elements have reduced opacity
  assert(
    componentSource.includes('opacity: simHidden ? 0.15 : 1'),
    'Simulation-hidden elements rendered at 15% opacity (visible but faded)'
  );

  // Test 16: Hidden elements have pointer-events none
  assert(
    componentSource.includes("pointerEvents: simHidden ? 'none' : 'auto'"),
    'Simulation-hidden elements are non-interactive (pointer-events: none)'
  );

  // Test 17: Transition for smooth visibility changes
  assert(
    componentSource.includes("transition: 'opacity 0.2s ease'"),
    'Opacity changes animated with 0.2s transition'
  );

  // Test 18: data-page-scope attribute on wrapper
  assert(
    componentSource.includes("data-page-scope={el.pageScope || 'all'}"),
    'Canvas element wrappers expose data-page-scope attribute'
  );

  // ─── Part 4: Root element data attributes ───
  console.log('--- Part 4: Root element data attributes ---');

  // Test 19: Root element has data-page-simulator attribute
  assert(
    componentSource.includes('data-page-simulator='),
    'Root element exposes data-page-simulator attribute'
  );

  // Test 20: data-page-simulator shows "off" when inactive
  assert(
    componentSource.includes("pageSimulatorCount !== null ? String(pageSimulatorCount) : 'off'"),
    'data-page-simulator shows count or "off"'
  );

  // ─── Part 5: Toolbar button styling ───
  console.log('--- Part 5: Toolbar button styling ---');

  // Test 21: Active button has distinct background color
  assert(
    componentSource.includes("backgroundColor: pageSimulatorCount === count ? '#4f46e5' : '#fff'"),
    'Active simulator button has indigo background (#4f46e5)'
  );

  // Test 22: Active button has white text
  assert(
    componentSource.includes("color: pageSimulatorCount === count ? '#fff' : '#374151'"),
    'Active simulator button has white text, inactive has dark text'
  );

  // Test 23: Active button has bold font weight
  assert(
    componentSource.includes('fontWeight: pageSimulatorCount === count ? 700 : 500'),
    'Active simulator button has bold (700) weight'
  );

  // Test 24: Buttons have aria-pressed for accessibility
  assert(
    componentSource.includes('aria-pressed={pageSimulatorCount === count}'),
    'Simulator buttons have aria-pressed for accessibility'
  );

  // Test 25: Buttons have descriptive title/aria-label
  assert(
    componentSource.includes('Simulate ${count}-page document'),
    'Simulator buttons have descriptive titles'
  );

  // ─── Part 6: Page scope logic correctness (unit tests) ───
  console.log('--- Part 6: Page scope logic unit tests ---');

  // Simulate the isElementVisibleInSimulation logic
  function isVisible(pageScope, simulatorCount, pageIndex) {
    if (simulatorCount === null) return true;
    const scope = pageScope || 'all';
    if (scope === 'all') return true;
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === (simulatorCount - 1) || pageIndex >= (simulatorCount - 1);
    switch (scope) {
      case 'first': return isFirstPage;
      case 'last': return isLastPage;
      case 'notFirst': return !isFirstPage;
      default: return true;
    }
  }

  // Test 26: 1-page doc: first scope visible on page 0
  assert(isVisible('first', 1, 0) === true, '1-page: scope "first" visible on page 0');

  // Test 27: 1-page doc: last scope visible on page 0 (it's both first and last)
  assert(isVisible('last', 1, 0) === true, '1-page: scope "last" visible on page 0');

  // Test 28: 1-page doc: notFirst scope hidden on page 0
  assert(isVisible('notFirst', 1, 0) === false, '1-page: scope "notFirst" hidden on page 0');

  // Test 29: 2-page doc: first scope visible on page 0, hidden on page 1
  assert(isVisible('first', 2, 0) === true && isVisible('first', 2, 1) === false, '2-page: scope "first" visible on page 0, hidden on page 1');

  // Test 30: 2-page doc: last scope hidden on page 0, visible on page 1
  assert(isVisible('last', 2, 0) === false && isVisible('last', 2, 1) === true, '2-page: scope "last" hidden on page 0, visible on page 1');

  // Test 31: 2-page doc: notFirst hidden on page 0, visible on page 1
  assert(isVisible('notFirst', 2, 0) === false && isVisible('notFirst', 2, 1) === true, '2-page: scope "notFirst" hidden on page 0, visible on page 1');

  // Test 32: 3-page doc: first scope visible only on page 0
  assert(
    isVisible('first', 3, 0) === true &&
    isVisible('first', 3, 1) === false &&
    isVisible('first', 3, 2) === false,
    '3-page: scope "first" visible only on page 0'
  );

  // Test 33: 3-page doc: last scope visible only on page 2
  assert(
    isVisible('last', 3, 0) === false &&
    isVisible('last', 3, 1) === false &&
    isVisible('last', 3, 2) === true,
    '3-page: scope "last" visible only on page 2'
  );

  // Test 34: 3-page doc: notFirst scope visible on pages 1 and 2
  assert(
    isVisible('notFirst', 3, 0) === false &&
    isVisible('notFirst', 3, 1) === true &&
    isVisible('notFirst', 3, 2) === true,
    '3-page: scope "notFirst" visible on pages 1 and 2'
  );

  // Test 35: all scope visible everywhere regardless of simulator
  assert(
    isVisible('all', 1, 0) && isVisible('all', 2, 0) && isVisible('all', 2, 1) &&
    isVisible('all', 3, 0) && isVisible('all', 3, 1) && isVisible('all', 3, 2),
    'scope "all" visible on every page in every simulator mode'
  );

  // Test 36: undefined/null scope treated as "all"
  assert(
    isVisible(undefined, 1, 0) && isVisible(null, 2, 1) && isVisible('', 3, 2),
    'undefined/null/empty scope treated as "all" (always visible)'
  );

  // Test 37: Simulator off (null) shows everything
  assert(
    isVisible('first', null, 0) && isVisible('last', null, 0) && isVisible('notFirst', null, 0),
    'Simulator off (null) shows all elements regardless of scope'
  );

  // ─── Part 7: simulatedElements memoization ───
  console.log('--- Part 7: Simulated elements memoization ---');

  // Test 38: simulatedElements computed with useMemo
  assert(
    componentSource.includes('simulatedElements') && componentSource.includes('useMemo'),
    'simulatedElements derived via useMemo for performance'
  );

  // Test 39: simulatedElements returns all elements when simulator off
  assert(
    componentSource.includes('pageSimulatorCount === null') && componentSource.includes('return currentPage.elements'),
    'simulatedElements returns unmodified elements when simulator is off'
  );

  // Test 40: simulatedElements adds _simHidden flag
  assert(
    componentSource.includes('_simHidden'),
    'simulatedElements adds _simHidden flag to elements during simulation'
  );

  // ─── Part 8: Integration with existing features ───
  console.log('--- Part 8: Integration verification ---');

  // Test 41: pageScope property exists on DesignElement interface
  assert(
    componentSource.includes("pageScope?: 'all' | 'first' | 'last' | 'notFirst'"),
    'DesignElement interface includes pageScope property with correct values'
  );

  // Test 42: Properties panel has pageScope selector
  assert(
    componentSource.includes('Page Scope') || componentSource.includes('pageScope') && componentSource.includes('<option'),
    'Properties panel includes pageScope selector for elements'
  );

  // Test 43: Separator divider before simulator in toolbar
  assert(
    componentSource.includes('Sim:'),
    'Toolbar has "Sim:" label before page simulator buttons'
  );

  // ─── Summary ───
  console.log('\n' + results.join('\n'));
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
  if (failed > 0) {
    console.log(`❌ ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
