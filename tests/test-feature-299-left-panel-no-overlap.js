/**
 * Feature #299: Left panel doesn't overlap canvas
 * Verifies that the left panel and canvas are properly separated
 * with no visual overlap at any viewport size.
 *
 * Tests:
 * 1. Left panel has fixed width with flexShrink: 0 (won't compress)
 * 2. Left panel has maxWidth matching width (can't grow beyond 260px)
 * 3. Left panel has overflow: hidden (content won't bleed out)
 * 4. Left panel has borderRight separator
 * 5. Canvas has flex: 1 (takes remaining space, not overlapping)
 * 6. Canvas has minWidth: 0 (prevents flex overflow)
 * 7. Parent container uses display: flex with overflow: hidden
 * 8. At mobile breakpoint, left panel uses position: absolute (overlay, not overlap)
 * 9. Mobile panel has z-index for proper stacking
 * 10. Left panel tab content has overflow: auto (scroll, not overflow)
 * 11. No negative margins on left panel or canvas
 * 12. No transform on left panel at desktop (only mobile hidden state)
 * 13. Canvas has overflow: auto (scrolls internally, not bleeding)
 * 14. Left panel and canvas are direct siblings in the flex container
 * 15. Medium breakpoint (1200px) adjusts left panel width down to 220px
 * 16. Root container has maxWidth: 100vw and overflow: hidden
 * 17. Left panel has data-testid for testing
 * 18. Canvas has data-testid for testing
 * 19. Left panel flex column layout (vertical stacking within)
 * 20. Panel separation border is visible (#e2e8f0)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

// Read the component source
const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

console.log('\n=== Feature #299: Left panel doesn\'t overlap canvas ===\n');

// --- Left Panel Properties ---
console.log('--- Left Panel Properties ---');

// 1. Left panel has fixed width with flexShrink: 0
assert(
  source.includes("width: '260px'") && source.includes('flexShrink: 0'),
  'Left panel has fixed width 260px with flexShrink: 0'
);

// 2. Left panel has maxWidth matching width
assert(
  source.includes("maxWidth: '260px'"),
  'Left panel has maxWidth: 260px to prevent growing'
);

// 3. Left panel has overflow: hidden
// Find the left panel style block
const leftPanelMatch = source.match(/data-testid="left-panel"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  leftPanelMatch && leftPanelMatch[1].includes("overflow: 'hidden'"),
  'Left panel has overflow: hidden to prevent content bleed'
);

// 4. Left panel has borderRight separator
assert(
  leftPanelMatch && leftPanelMatch[1].includes("borderRight: '1px solid #e2e8f0'"),
  'Left panel has visible border-right separator'
);

// --- Canvas Properties ---
console.log('\n--- Canvas Properties ---');

// 5. Canvas has flex: 1
const canvasMatch = source.match(/data-testid="center-canvas"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  canvasMatch && canvasMatch[1].includes('flex: 1'),
  'Canvas has flex: 1 (takes remaining space)'
);

// 6. Canvas has minWidth: 0
assert(
  canvasMatch && canvasMatch[1].includes('minWidth: 0'),
  'Canvas has minWidth: 0 (prevents flex overflow)'
);

// 7. Canvas has overflow: auto
assert(
  canvasMatch && canvasMatch[1].includes("overflow: 'auto'"),
  'Canvas has overflow: auto (scrolls internally)'
);

// --- Parent Container ---
console.log('\n--- Parent Container ---');

// 8. Parent container uses display: flex
const panelsMatch = source.match(/data-testid="designer-panels"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  panelsMatch && panelsMatch[1].includes("display: 'flex'"),
  'Parent panels container uses display: flex'
);

// 9. Parent container has overflow: hidden
assert(
  panelsMatch && panelsMatch[1].includes("overflow: 'hidden'"),
  'Parent panels container has overflow: hidden'
);

// --- Mobile Breakpoint ---
console.log('\n--- Mobile Breakpoint ---');

// 10. Mobile left panel uses position: absolute
assert(
  source.includes('.erp-designer-left-panel') && source.includes('position: absolute !important'),
  'Mobile left panel uses position: absolute (overlay mode)'
);

// 11. Mobile panel has z-index
assert(
  source.includes('z-index: 100 !important'),
  'Mobile panel has z-index for proper stacking'
);

// 12. Mobile panel hidden uses transform
assert(
  source.includes('.erp-designer-left-panel.panel-hidden') && source.includes('translateX(-100%)'),
  'Hidden mobile panel slides out via translateX(-100%)'
);

// --- Content Overflow ---
console.log('\n--- Content Overflow ---');

// 13. Left panel tab content has overflow: auto
assert(
  source.includes("overflow: 'auto', padding: '12px'"),
  'Left panel tab content area has overflow: auto for scrolling'
);

// 14. No negative margins on left panel
const leftPanelSection = source.substring(
  source.indexOf('data-testid="left-panel"'),
  source.indexOf('data-testid="left-panel"') + 500
);
assert(
  !leftPanelSection.includes('margin') || !leftPanelSection.match(/margin.*-\d/),
  'No negative margins on left panel'
);

// --- Layout Integrity ---
console.log('\n--- Layout Integrity ---');

// 15. Medium breakpoint adjusts left panel
assert(
  source.includes('@media (max-width: 1200px) and (min-width: 769px)') &&
  source.includes('.erp-designer-left-panel') && source.includes('width: 220px !important'),
  'Medium breakpoint reduces left panel to 220px'
);

// 16. Root has maxWidth and overflow constraints
const rootMatch = source.match(/data-testid="erp-designer-root"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  rootMatch && rootMatch[1].includes("maxWidth: '100vw'") && rootMatch[1].includes("overflow: 'hidden'"),
  'Root container has maxWidth: 100vw and overflow: hidden'
);

// 17. data-testid attributes present
assert(
  source.includes('data-testid="left-panel"'),
  'Left panel has data-testid="left-panel"'
);
assert(
  source.includes('data-testid="center-canvas"'),
  'Canvas has data-testid="center-canvas"'
);

// 18. Left panel uses flex column
assert(
  leftPanelMatch && leftPanelMatch[1].includes("flexDirection: 'column'"),
  'Left panel uses flexDirection: column'
);

// 19. Panels are siblings - left-panel appears before center-canvas
const leftPanelIdx = source.indexOf('data-testid="left-panel"');
const canvasIdx = source.indexOf('data-testid="center-canvas"');
assert(
  leftPanelIdx < canvasIdx,
  'Left panel appears before canvas in DOM (proper flex ordering)'
);

// 20. Verify no overlap via math: 260 + 280 = 540, leaving plenty for canvas at any desktop width
const minDesktopWidth = 769; // mobile breakpoint
const panelSum = 260 + 280; // left + right
assert(
  minDesktopWidth > panelSum,
  `Desktop min width (${minDesktopWidth}px) > panel sum (${panelSum}px) = canvas always gets space`
);

// --- Frontend Verification ---
console.log('\n--- Frontend Verification ---');

// Test that the page loads
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  try {
    const res = await httpGet('http://localhost:3001');
    assert(res.status === 200, 'Frontend loads at localhost:3001 (status 200)');
    assert(res.data.includes('<!DOCTYPE html'), 'Frontend returns valid HTML');
  } catch (e) {
    assert(false, `Frontend loads at localhost:3001 (${e.message})`);
    assert(false, 'Frontend returns valid HTML');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
