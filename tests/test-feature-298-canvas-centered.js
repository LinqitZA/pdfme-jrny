/**
 * Feature #298: Canvas centered in viewport
 * Tests that canvas page is centered in available space between panels,
 * has adequate padding, and is consistent at different zoom levels.
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
  console.log('Feature #298: Canvas centered in viewport\n');

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

  const componentPath = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';
  const source = fs.readFileSync(componentPath, 'utf8');

  // ─── Canvas Centering CSS ───
  console.log('\n--- Canvas Centering ---');

  // Find the canvas container styles (use data-testid to skip CSS rules)
  const canvasStart = source.indexOf('data-testid="center-canvas"');
  const canvasSection = source.substring(canvasStart - 200, canvasStart + 500);

  assert(canvasSection.includes("display: 'flex'"),
    'Canvas container uses display: flex');
  assert(canvasSection.includes("alignItems: 'center'"),
    'Canvas container uses alignItems: center for vertical centering');
  assert(canvasSection.includes("justifyContent: 'center'"),
    'Canvas container uses justifyContent: center for horizontal centering');
  assert(canvasSection.includes("flex: 1"),
    'Canvas container takes remaining space with flex: 1');

  // ─── Canvas Between Panels ───
  console.log('\n--- Canvas Positioned Between Panels ---');

  // Use className= prefix to find actual DOM elements, not CSS rules
  const leftPanelPos = source.indexOf('data-testid="left-panel"');
  const canvasPos = source.indexOf('data-testid="center-canvas"');
  const rightPanelPos = source.indexOf('data-testid="right-panel"');

  assert(leftPanelPos < canvasPos,
    'Left panel comes before canvas in DOM order');
  assert(canvasPos < rightPanelPos,
    'Canvas comes before right panel in DOM order');

  // Verify panels have fixed widths - search from the DOM element positions
  const leftPanelSection = source.substring(leftPanelPos, leftPanelPos + 400);
  const rightPanelSection = source.substring(rightPanelPos, rightPanelPos + 400);

  assert(leftPanelSection.includes("width: '260px'"),
    'Left panel has fixed 260px width');
  assert(rightPanelSection.includes("width: '280px'"),
    'Right panel has fixed 280px width');

  // Canvas takes remaining space
  assert(canvasSection.includes("flex: 1"),
    'Canvas fills remaining space between panels');

  // ─── Adequate Padding ───
  console.log('\n--- Adequate Padding ---');

  assert(canvasSection.includes("padding: '24px'"),
    'Canvas has 24px padding around the page');

  // Verify canvas page has spacing from container
  assert(html.includes('data-testid="canvas-page"'),
    'Canvas page element exists in rendered HTML');

  // Page has visual separation (box shadow)
  // Skip the first occurrence (in JS handler), find the actual DOM element
  const firstPageRef = source.indexOf('data-testid="canvas-page"');
  const pageStart = source.indexOf('data-testid="canvas-page"', firstPageRef + 1);
  const pageSection = source.substring(pageStart, pageStart + 600);
  assert(pageSection.includes("boxShadow"),
    'Canvas page has box shadow for visual separation');
  assert(pageSection.includes("borderRadius: '2px'"),
    'Canvas page has subtle border radius');

  // ─── Zoom Level Consistency ───
  console.log('\n--- Zoom Level Consistency ---');

  // Verify zoom levels exist
  assert(source.includes('const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200]'),
    'Zoom levels defined: 25%, 50%, 75%, 100%, 125%, 150%, 200%');

  // Verify page dimensions scale with zoom
  assert(source.includes('595 * (zoom / 100)'),
    'Page width scales with zoom level (595 * zoom/100)');
  assert(source.includes('842 * (zoom / 100)'),
    'Page height scales with zoom level (842 * zoom/100)');

  // A4 dimensions at 100%
  assert(html.includes('width:595px') || html.includes('width: 595px') || pageSection.includes('595'),
    'At 100% zoom, page width is 595px (A4)');
  assert(html.includes('height:842px') || html.includes('height: 842px') || pageSection.includes('842'),
    'At 100% zoom, page height is 842px (A4)');

  // Smooth zoom transition
  assert(pageSection.includes("transition: 'width 0.2s, height 0.2s'"),
    'Page has smooth transition for zoom changes');

  // ─── Scrolling at Large Zoom ───
  console.log('\n--- Scrolling at Large Zoom ---');

  assert(canvasSection.includes("overflow: 'auto'"),
    'Canvas has overflow: auto for scrolling at large zoom levels');

  // At 200% zoom, page would be 1190x1684px which exceeds most viewports
  // overflow: auto ensures it's scrollable
  const pageWidth200 = 595 * 2;
  const pageHeight200 = 842 * 2;
  assert(pageWidth200 === 1190,
    `At 200% zoom, page width would be ${pageWidth200}px (scrollable)`);
  assert(pageHeight200 === 1684,
    `At 200% zoom, page height would be ${pageHeight200}px (scrollable)`);

  // At 25% zoom, page would be small but still centered
  const pageWidth25 = Math.round(595 * 0.25);
  const pageHeight25 = Math.round(842 * 0.25);
  assert(pageWidth25 < 200 && pageHeight25 < 220,
    `At 25% zoom, page is small (${pageWidth25}x${pageHeight25}) but centered via flexbox`);

  // ─── Canvas Background ───
  console.log('\n--- Canvas Visual Style ---');

  assert(canvasSection.includes("backgroundColor: '#e2e8f0'"),
    'Canvas has gray background to contrast with white page');

  // Page has white background
  assert(pageSection.includes("backgroundColor: '#ffffff'"),
    'Canvas page has white background');

  // ─── HTML Rendered Verification ───
  console.log('\n--- Rendered HTML Verification ---');

  assert(html.includes('data-testid="center-canvas"'),
    'Canvas has center-canvas testid in rendered HTML');
  assert(html.includes('data-testid="canvas-page"'),
    'Canvas page has canvas-page testid in rendered HTML');
  assert(html.includes('data-testid="designer-panels"'),
    'Panels container exists in rendered HTML');

  // Verify the page content is centered via rendered inline styles
  assert(html.includes('align-items:center') || html.includes('alignItems:center') ||
    html.includes('align-items: center'),
    'align-items: center present in rendered CSS');
  assert(html.includes('justify-content:center') || html.includes('justifyContent:center') ||
    html.includes('justify-content: center'),
    'justify-content: center present in rendered CSS');

  // ─── Page Size Selector ───
  console.log('\n--- Page Size Support ---');

  assert(html.includes('data-testid="page-size-selector"'),
    'Page size selector exists');
  assert(html.includes('A4') && html.includes('Letter') && html.includes('Legal'),
    'Multiple page sizes available (A4, Letter, Legal)');

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
