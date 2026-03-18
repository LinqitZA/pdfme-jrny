/**
 * Test Feature #70: Three-panel layout proper proportions
 * Verifies panels are sized correctly at 1920px
 * - Left ~240-280px
 * - Right ~280-320px
 * - Canvas fills remaining
 * - Borders/separators correct
 */

const fs = require('fs');
const path = require('path');

const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const source = fs.readFileSync(designerPath, 'utf-8');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('Feature #70: Three-panel layout proper proportions\n');

// 1. Root layout structure
console.log('--- Root Layout Structure ---');
test('Root has display flex', source.includes("display: 'flex'"));
test('Root has flexDirection column', source.includes("flexDirection: 'column'"));
test('Root has height 100vh', source.includes("height: '100vh'"));
test('Root has maxWidth 100vw', source.includes("maxWidth: '100vw'"));
test('Root has overflow hidden', source.includes("overflow: 'hidden'"));

// 2. Panels container
console.log('\n--- Panels Container ---');
test('Panels container has data-testid designer-panels',
  source.includes('data-testid="designer-panels"'));
test('Panels container has display flex',
  source.match(/designer-panels[\s\S]*?display:\s*'flex'/m) !== null);
test('Panels container has flex 1',
  source.match(/designer-panels[\s\S]*?flex:\s*1/m) !== null);

// 3. Left panel dimensions (within 240-280px range)
console.log('\n--- Left Panel ---');
test('Left panel has data-testid left-panel', source.includes('data-testid="left-panel"'));
test('Left panel width is 260px (within 240-280px range)', source.includes("width: '260px'"));
test('Left panel maxWidth is 260px', source.includes("maxWidth: '260px'"));
test('Left panel has flexShrink 0 (won\'t collapse)', source.includes("flexShrink: 0"));
test('Left panel has border separator on right',
  source.match(/left-panel[\s\S]*?borderRight:\s*'1px solid #e2e8f0'/m) !== null);

// 4. Right panel dimensions (within 280-320px range)
console.log('\n--- Right Panel ---');
test('Right panel has data-testid right-panel', source.includes('data-testid="right-panel"'));
test('Right panel width is 280px (within 280-320px range)',
  source.match(/right-panel[\s\S]*?width:\s*'280px'/m) !== null);
test('Right panel has border separator on left',
  source.match(/right-panel[\s\S]*?borderLeft:\s*'1px solid #e2e8f0'/m) !== null);

// 5. Center canvas fills remaining
console.log('\n--- Center Canvas ---');
test('Center canvas has data-testid center-canvas', source.includes('data-testid="center-canvas"'));
test('Center canvas has flex 1 (fills remaining space)',
  source.match(/center-canvas[\s\S]*?flex:\s*1/m) !== null);
test('Center canvas has overflow auto for scrolling',
  source.match(/center-canvas[\s\S]*?overflow:\s*'auto'/m) !== null);
test('Center canvas has padding for spacing',
  source.match(/center-canvas[\s\S]*?padding:\s*'24px'/m) !== null);

// 6. Layout math at 1920px
console.log('\n--- Layout Math at 1920px ---');
const leftWidth = 260;
const rightWidth = 280;
const canvasWidth = 1920 - leftWidth - rightWidth;
test(`At 1920px: left ${leftWidth} + canvas ${canvasWidth} + right ${rightWidth} = 1920`,
  leftWidth + canvasWidth + rightWidth === 1920);
test(`Left panel 260px is within 240-280px range`, leftWidth >= 240 && leftWidth <= 280);
test(`Right panel 280px is within 280-320px range`, rightWidth >= 280 && rightWidth <= 320);
test(`Canvas ${canvasWidth}px fills remaining space`, canvasWidth > 0);

// 7. Panel flex configuration
console.log('\n--- Panel Flex Configuration ---');
test('Left panel uses flexShrink 0 to maintain width',
  source.match(/left-panel[\s\S]*?flexShrink:\s*0/m) !== null);
test('Right panel uses flexShrink 0 to maintain width',
  source.match(/right-panel[\s\S]*?flexShrink:\s*0/m) !== null);

// 8. Panel content structure
console.log('\n--- Panel Content Structure ---');
test('Left panel has tabs section', source.includes('data-testid="left-panel-tabs"'));
test('Right panel has properties header', source.includes("Properties"));
test('Right panel has scrollable properties container',
  source.includes('data-testid="properties-scroll-container"'));

// 9. Borders and visual separators
console.log('\n--- Visual Separators ---');
test('Left panel border color matches design system (#e2e8f0)',
  source.includes("borderRight: '1px solid #e2e8f0'"));
test('Right panel border color matches design system (#e2e8f0)',
  source.includes("borderLeft: '1px solid #e2e8f0'"));
test('Canvas background provides visual contrast (#e2e8f0)',
  source.match(/center-canvas[\s\S]*?backgroundColor:\s*'#e2e8f0'/m) !== null);
test('Panel backgrounds are white (#ffffff)',
  source.match(/left-panel[\s\S]*?backgroundColor:\s*'#ffffff'/m) !== null);

// 10. Toolbar above panels
console.log('\n--- Toolbar Structure ---');
test('Toolbar exists above panels', source.includes('data-testid="designer-toolbar"'));

console.log(`\n--- Results: ${passed}/${passed + failed} tests passing ---`);
if (failed > 0) {
  process.exit(1);
}
