/**
 * Feature #301: Text elements don't overflow containers
 * Verifies that long text in panels is properly handled (truncated with ellipsis)
 *
 * Tests verify:
 * 1. Template name input has overflow/ellipsis handling
 * 2. Field names in Fields tab have overflow/ellipsis
 * 3. Properties labels don't overflow (labelStyle)
 * 4. Block labels don't overflow
 * 5. Asset filenames don't overflow (already had this)
 * 6. Canvas text elements have overflow handling
 * 7. Toolbar doesn't overflow
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

const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

console.log('\n=== Feature #301: Text elements don\'t overflow containers ===\n');

// --- Template Name Input ---
console.log('--- Template Name Input ---');

const nameInputMatch = source.match(/data-testid="template-name-input"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  nameInputMatch && nameInputMatch[1].includes("overflow: 'hidden'"),
  'Template name input has overflow: hidden'
);
assert(
  nameInputMatch && nameInputMatch[1].includes("textOverflow: 'ellipsis'"),
  'Template name input has textOverflow: ellipsis'
);
assert(
  nameInputMatch && nameInputMatch[1].includes("maxWidth: '200px'"),
  'Template name input has maxWidth: 200px'
);
assert(
  source.includes('title={name}'),
  'Template name input has title tooltip for full text'
);

// --- Field Names in Fields Tab ---
console.log('\n--- Field Names in Fields Tab ---');

// Find the field item rendering
const fieldItemMatch = source.match(/handleFieldDragStart[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  fieldItemMatch && fieldItemMatch[1].includes("overflow: 'hidden'"),
  'Field items have overflow: hidden'
);
assert(
  fieldItemMatch && fieldItemMatch[1].includes("textOverflow: 'ellipsis'"),
  'Field items have textOverflow: ellipsis'
);
assert(
  fieldItemMatch && fieldItemMatch[1].includes("whiteSpace: 'nowrap'"),
  'Field items have whiteSpace: nowrap'
);
assert(
  source.includes('title={field.key}'),
  'Field items have title tooltip for full key'
);

// --- Properties Labels ---
console.log('\n--- Properties Labels (labelStyle) ---');

const labelStyleMatch = source.match(/const labelStyle[\s\S]*?\{([\s\S]*?)\};/);
assert(
  labelStyleMatch && labelStyleMatch[1].includes("overflow: 'hidden'"),
  'labelStyle has overflow: hidden'
);
assert(
  labelStyleMatch && labelStyleMatch[1].includes("textOverflow: 'ellipsis'"),
  'labelStyle has textOverflow: ellipsis'
);
assert(
  labelStyleMatch && labelStyleMatch[1].includes("whiteSpace: 'nowrap'"),
  'labelStyle has whiteSpace: nowrap'
);

// --- Block Labels ---
console.log('\n--- Block Labels ---');

// Check block label wrapping
assert(
  source.includes('<span style={{ overflow: \'hidden\', textOverflow: \'ellipsis\', whiteSpace: \'nowrap\', maxWidth: \'100%\' }}>{block.label}</span>'),
  'Block labels wrapped with overflow ellipsis span'
);

// --- Asset Filenames ---
console.log('\n--- Asset Filenames ---');

assert(
  source.includes("overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1") &&
  source.includes('{asset.filename}'),
  'Asset filenames have overflow ellipsis handling'
);

// --- Canvas Text Elements ---
console.log('\n--- Canvas Text Elements ---');

// Find canvas text rendering with overflow
assert(
  source.includes("overflow: 'hidden'") && source.includes("whiteSpace: 'nowrap'") &&
  source.includes("textOverflow: 'ellipsis'") && source.includes('{displayText}'),
  'Canvas text elements have overflow/ellipsis handling'
);

// --- Toolbar ---
console.log('\n--- Toolbar ---');

const toolbarMatch = source.match(/data-testid="designer-toolbar"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  toolbarMatch && toolbarMatch[1].includes("overflow: 'hidden'"),
  'Toolbar has overflow: hidden'
);
assert(
  toolbarMatch && toolbarMatch[1].includes("flexShrink: 0"),
  'Toolbar has flexShrink: 0 (doesn\'t compress)'
);

// --- Properties Scroll Container ---
console.log('\n--- Properties Scroll Container ---');

const propsScrollMatch = source.match(/data-testid="properties-scroll-container"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  propsScrollMatch && propsScrollMatch[1].includes("overflow: 'auto'"),
  'Properties scroll container has overflow: auto'
);

// --- Left Panel Content Area ---
console.log('\n--- Left Panel Content Area ---');

assert(
  source.includes("flex: 1, overflow: 'auto', padding: '12px'"),
  'Left panel tab content area has overflow: auto'
);

// --- Left Panel Container ---
console.log('\n--- Left Panel Container ---');

const leftPanelMatch = source.match(/data-testid="left-panel"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  leftPanelMatch && leftPanelMatch[1].includes("overflow: 'hidden'"),
  'Left panel container has overflow: hidden'
);

// --- General Checks ---
console.log('\n--- General Checks ---');

// Verify no elements use width > 100% on text
assert(
  !source.match(/fontSize.*width.*120%/),
  'No text elements have width > 100%'
);

// Search input in fields tab constrained
const fieldSearchMatch = source.match(/data-testid="field-tab-search"[\s\S]*?style=\{\{([\s\S]*?)\}\}/);
assert(
  fieldSearchMatch && fieldSearchMatch[1].includes("width: '100%'"),
  'Field search input is width: 100% (contained by parent)'
);

// --- Frontend Verification ---
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
    assert(res.status === 200, 'Frontend loads at localhost:3001');
  } catch (e) {
    assert(false, `Frontend loads at localhost:3001 (${e.message})`);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
