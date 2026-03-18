/**
 * Feature #300: Modal dialogs fit viewport
 * Verifies all modals/dialogs/overlays fit within the viewport
 * at any screen size, with scrollable content and accessible close buttons.
 *
 * Modals in the designer:
 * 1. Render Progress Overlay (render-overlay / render-dialog)
 * 2. Loading Overlay for Save/Publish (operation-loading-overlay)
 * 3. Toast Notification Container (toast-container)
 * 4. Context Menu (page-context-menu)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    return true;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
    return false;
  }
}

function pass(message) {
  console.log(`  ✅ ${message}`);
  passed++;
}

function assertAndLog(condition, message) {
  if (assert(condition, message)) {
    console.log(`  ✅ ${message}`);
  }
}

const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

console.log('\n=== Feature #300: Modal dialogs fit viewport ===\n');

// ─── Render Dialog ───
console.log('--- Render Dialog ---');

// Extract render dialog styles
const renderDialogMatch = source.match(/data-testid="render-dialog"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);

assertAndLog(
  renderDialogMatch !== null,
  'Render dialog element exists'
);

assertAndLog(
  renderDialogMatch && renderDialogMatch[1].includes("minWidth: 'min(400px, 90vw)'"),
  'Render dialog minWidth uses min() for viewport safety'
);

assertAndLog(
  renderDialogMatch && renderDialogMatch[1].includes("maxWidth: 'min(480px, 94vw)'"),
  'Render dialog maxWidth uses min() for viewport safety'
);

assertAndLog(
  renderDialogMatch && renderDialogMatch[1].includes("maxHeight: '90vh'"),
  'Render dialog has maxHeight: 90vh'
);

assertAndLog(
  renderDialogMatch && renderDialogMatch[1].includes("overflowY: 'auto'"),
  'Render dialog has overflowY: auto for scrollable content'
);

// ─── Render Overlay ───
console.log('\n--- Render Overlay ---');

const renderOverlayMatch = source.match(/data-testid="render-overlay"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);

assertAndLog(
  renderOverlayMatch && renderOverlayMatch[1].includes("position: 'fixed'"),
  'Render overlay uses position: fixed'
);

assertAndLog(
  renderOverlayMatch && renderOverlayMatch[1].includes('top: 0') &&
  renderOverlayMatch[1].includes('left: 0') &&
  renderOverlayMatch[1].includes('right: 0') &&
  renderOverlayMatch[1].includes('bottom: 0'),
  'Render overlay covers full viewport (top/left/right/bottom: 0)'
);

assertAndLog(
  renderOverlayMatch && renderOverlayMatch[1].includes("alignItems: 'center'") &&
  renderOverlayMatch[1].includes("justifyContent: 'center'"),
  'Render overlay centers its content'
);

// ─── Close Button ───
console.log('\n--- Close Button Accessibility ---');

assertAndLog(
  source.includes('data-testid="render-dismiss"'),
  'Render dialog has dismiss/close button'
);

// Check close button is inside the dialog
const dismissIdx = source.indexOf('data-testid="render-dismiss"');
const renderDialogEnd = source.indexOf('</div>\n      </div>\n    )}\n\n      {/* ─── Context');
assertAndLog(
  dismissIdx > 0 && dismissIdx < source.indexOf('data-testid="page-context-menu"'),
  'Dismiss button is inside the render dialog (accessible)'
);

assertAndLog(
  source.includes('dismissRenderOverlay'),
  'Dismiss handler function exists'
);

// ─── Loading Overlay ───
console.log('\n--- Loading Overlay ---');

const loadingOverlayMatch = source.match(/data-testid="operation-loading-overlay"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);

assertAndLog(
  loadingOverlayMatch && loadingOverlayMatch[1].includes("position: 'fixed'"),
  'Loading overlay uses position: fixed'
);

assertAndLog(
  loadingOverlayMatch && loadingOverlayMatch[1].includes('top: 0') &&
  loadingOverlayMatch[1].includes('bottom: 0'),
  'Loading overlay covers full viewport height'
);

assertAndLog(
  loadingOverlayMatch && loadingOverlayMatch[1].includes("alignItems: 'center'") &&
  loadingOverlayMatch[1].includes("justifyContent: 'center'"),
  'Loading overlay centers its content'
);

// ─── Toast Container ───
console.log('\n--- Toast Container ---');

const toastMatch = source.match(/data-testid="toast-container"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);

assertAndLog(
  toastMatch && toastMatch[1].includes("position: 'fixed'"),
  'Toast container uses position: fixed'
);

assertAndLog(
  toastMatch && toastMatch[1].includes("maxWidth: 'min(400px, calc(100vw - 32px))'"),
  'Toast container maxWidth is viewport-aware'
);

assertAndLog(
  toastMatch && toastMatch[1].includes("top: '16px'") && toastMatch[1].includes("right: '16px'"),
  'Toast container positioned top-right with 16px offset'
);

// ─── Context Menu ───
console.log('\n--- Context Menu ---');

const ctxMenuMatch = source.match(/data-testid="page-context-menu"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);

assertAndLog(
  ctxMenuMatch && ctxMenuMatch[1].includes("position: 'fixed'"),
  'Context menu uses position: fixed'
);

assertAndLog(
  ctxMenuMatch && ctxMenuMatch[1].includes("minWidth: '160px'"),
  'Context menu has reasonable minWidth (160px)'
);

// ─── General Modal Properties ───
console.log('\n--- General Modal Properties ---');

// No modal uses position: absolute (which could scroll with content)
assertAndLog(
  source.includes("data-testid=\"render-overlay\"") &&
  !source.match(/render-overlay[\s\S]*?position:\s*'absolute'/),
  'Render overlay does not use position: absolute'
);

// All fixed overlays use z-index
assertAndLog(
  renderOverlayMatch && renderOverlayMatch[1].includes('zIndex:'),
  'Render overlay has z-index'
);

assertAndLog(
  loadingOverlayMatch && loadingOverlayMatch[1].includes('zIndex:'),
  'Loading overlay has z-index'
);

assertAndLog(
  toastMatch && toastMatch[1].includes('zIndex:'),
  'Toast container has z-index'
);

// Proper z-index stacking: loading > render > toast
const renderZ = parseInt((renderOverlayMatch[1].match(/zIndex:\s*(\d+)/) || [])[1] || '0');
const loadingZ = parseInt((loadingOverlayMatch[1].match(/zIndex:\s*(\d+)/) || [])[1] || '0');
const toastZ = parseInt((toastMatch[1].match(/zIndex:\s*(\d+)/) || [])[1] || '0');

assertAndLog(
  loadingZ > renderZ,
  `Loading overlay z-index (${loadingZ}) > render overlay z-index (${renderZ})`
);

assertAndLog(
  toastZ > renderZ,
  `Toast z-index (${toastZ}) > render overlay z-index (${renderZ})`
);

// ─── Frontend Verification ───
console.log('\n--- Frontend Verification ---');

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
    assertAndLog(res.status === 200, 'Frontend loads at localhost:3001 (status 200)');
  } catch (e) {
    assertAndLog(false, `Frontend loads at localhost:3001 (${e.message})`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
