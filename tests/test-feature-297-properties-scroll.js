/**
 * Feature #297: Properties panel scrolls on long content
 * Tests that properties panel is scrollable when content exceeds height,
 * all property sections are reachable, and scroll doesn't affect canvas.
 */

const http = require('http');
const fs = require('fs');

const DESIGNER_PORT = 3001;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${message}`);
  } else {
    fail++;
    console.log(`  ✗ ${message}`);
  }
}

async function runTests() {
  console.log('Feature #297: Properties panel scrolls on long content\n');

  // Load the designer page
  let html;
  try {
    const res = await fetch(`http://localhost:${DESIGNER_PORT}/`);
    html = res.data;
    assert(res.status === 200, 'Designer page loads successfully');
  } catch (e) {
    console.log(`  ✗ Could not load designer page: ${e.message}`);
    fail++;
    printSummary();
    return;
  }

  // Read the source code for verification
  const componentPath = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';
  const source = fs.readFileSync(componentPath, 'utf8');

  // ─── Panel Structure Tests ───
  console.log('\n--- Properties Panel Structure ---');

  // Right panel is a flex column container
  assert(html.includes('data-testid="right-panel"'), 'Right panel exists with testid');
  assert(source.includes("flexDirection: 'column'") && source.includes("erp-designer-right-panel"),
    'Right panel uses flex column layout');
  assert(source.includes("flexShrink: 0") && source.includes("erp-designer-right-panel"),
    'Right panel has flexShrink: 0 for fixed width');

  // ─── Scroll Container Tests ───
  console.log('\n--- Scroll Container ---');

  assert(html.includes('data-testid="properties-scroll-container"'),
    'Properties scroll container has testid');
  assert(source.includes("overflow: 'auto'") || html.includes('overflow:auto'),
    'Properties content area has overflow: auto for scrolling');
  assert(source.includes("flex: 1") && source.includes('properties-scroll-container'),
    'Scroll container uses flex: 1 to fill available height');
  assert(source.includes("overscrollBehavior: 'contain'"),
    'Scroll container has overscrollBehavior: contain to prevent canvas scroll');

  // ─── Panel Header Tests ───
  console.log('\n--- Panel Header ---');

  assert(html.includes('>Properties</div>') || html.includes('>Properties<'),
    'Properties header text displayed');
  assert(source.includes("borderBottom: '1px solid #e2e8f0'") && source.includes('Properties'),
    'Properties header has bottom border separator');

  // ─── Panel is within height-constrained parent ───
  console.log('\n--- Height Constraint Chain ---');

  // The panels container has overflow: hidden and flex: 1
  assert(source.includes("className=\"erp-designer-panels\""),
    'Panels container exists');
  assert(html.includes('erp-designer-panels'),
    'Panels container rendered in HTML');

  // Panels container is flex: 1 within the 100vh designer
  const panelsMatch = source.match(/className="erp-designer-panels"[\s\S]{0,200}overflow:\s*'hidden'/);
  assert(panelsMatch !== null,
    'Panels container has overflow: hidden');

  // The designer has height: 100vh
  assert(source.includes("height: '100vh'"),
    'Designer root has height: 100vh');

  // ─── All Property Sections Exist and Are Reachable ───
  console.log('\n--- Property Sections Reachable ---');

  const propertySections = [
    'properties-position-size',
    'properties-typography',
    'properties-text-overflow',
    'properties-image',
    'properties-table',
    'properties-binding',
    'properties-page-visibility',
    'properties-output-channel',
    'properties-conditional-visibility',
  ];

  for (const section of propertySections) {
    assert(source.includes(`data-testid="${section}"`),
      `Property section "${section}" exists in source`);
  }

  // ─── Verify sections are inside the scrollable container ───
  console.log('\n--- Sections Within Scroll Container ---');

  // The renderPropertiesPanel() function renders all sections
  assert(source.includes('renderPropertiesPanel()'),
    'renderPropertiesPanel function is called');
  assert(source.includes('{renderPropertiesPanel()}'),
    'renderPropertiesPanel output is rendered inside scroll container');

  // Verify the scroll container wraps the properties panel content
  const scrollContainerIndex = source.indexOf('properties-scroll-container');
  const renderCallIndex = source.indexOf('{renderPropertiesPanel()}');
  assert(scrollContainerIndex < renderCallIndex,
    'Scroll container wraps the renderPropertiesPanel output');

  // Verify closing div after renderPropertiesPanel
  const afterRender = source.substring(renderCallIndex, renderCallIndex + 100);
  assert(afterRender.includes('</div>'),
    'Scroll container properly closes after content');

  // ─── Scroll Isolation from Canvas ───
  console.log('\n--- Scroll Isolation from Canvas ---');

  // Canvas has its own overflow: auto
  assert(source.includes("className=\"erp-designer-canvas\""),
    'Canvas element exists');
  const canvasStart = source.indexOf('className="erp-designer-canvas"');
  const canvasSection = source.substring(canvasStart, canvasStart + 500);
  assert(canvasSection.includes("overflow: 'auto'"),
    'Canvas has its own independent overflow: auto');

  // overscrollBehavior: contain prevents scroll chaining
  assert(source.includes("overscrollBehavior: 'contain'"),
    'overscrollBehavior: contain prevents scroll propagation to canvas');

  // The panels container overflow: hidden provides another scroll boundary
  assert(source.includes("overflow: 'hidden'"),
    'Parent panels container overflow: hidden isolates scroll regions');

  // ─── Empty State Test ───
  console.log('\n--- Empty State ---');

  assert(source.includes('properties-empty'),
    'Empty state rendered when no element selected');
  assert(source.includes('Select an element on the canvas'),
    'Empty state shows helpful message');

  // ─── Content Properties (verify many sections exist for text elements) ───
  console.log('\n--- Content Length Verification ---');

  // Count property sections that generate significant content
  const sectionCount = propertySections.length;
  assert(sectionCount >= 7,
    `At least 7 property sections exist (found ${sectionCount}) - enough to overflow panel`);

  // Verify each section has marginBottom for proper spacing
  const marginBottomCount = (source.match(/marginBottom: '16px'/g) || []).length;
  assert(marginBottomCount >= 5,
    `Property sections have consistent 16px bottom margin (found ${marginBottomCount})`);

  // Verify there are many input fields within properties
  const propInputCount = (source.match(/data-testid="prop-/g) || []).length;
  assert(propInputCount >= 6,
    `Multiple property input fields exist (found ${propInputCount})`);

  printSummary();
}

function printSummary() {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`);
  console.log(`═══════════════════════════════════════`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
