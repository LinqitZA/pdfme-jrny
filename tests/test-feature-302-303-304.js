/**
 * Features #302, #303, #304: Style consistency tests
 *
 * #302: Toolbar items don't wrap on standard screens (1920px+)
 * #303: Block cards have consistent sizing
 * #304: Consistent spacing and padding throughout
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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('\n=== Features #302, #303, #304: Style Consistency Tests ===\n');

  const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

  // ─── Feature #302: Toolbar no-wrap at 1920px+ ───
  console.log('--- Feature #302: Toolbar items don\'t wrap on standard screens ---\n');

  // 1. Toolbar has flexWrap: nowrap
  const toolbarStyleSection = source.substring(
    source.indexOf('data-testid="designer-toolbar"'),
    source.indexOf('data-testid="designer-toolbar"') + 400
  );
  assert(
    toolbarStyleSection.includes("flexWrap: 'nowrap'"),
    '#302: Toolbar has flexWrap: nowrap (prevents wrapping at 1920px+)'
  );

  // 2. Toolbar has overflow: hidden to prevent overflow
  assert(
    toolbarStyleSection.includes("overflow: 'hidden'"),
    '#302: Toolbar has overflow: hidden to prevent overflow'
  );

  // 3. At 768px mobile breakpoint, wrapping IS allowed
  assert(
    source.includes('flex-wrap: wrap !important'),
    '#302: Mobile breakpoint (768px) still allows flex-wrap: wrap'
  );

  // 4. No flex-wrap: wrap in the 1200px breakpoint
  const mediumBreakpoint = source.substring(
    source.indexOf('@media (max-width: 1200px)'),
    source.indexOf('@media (max-width: 768px)')
  );
  assert(
    !mediumBreakpoint.includes('flex-wrap'),
    '#302: Medium breakpoint (1200px) does not set flex-wrap (stays nowrap)'
  );

  // 5. Toolbar has consistent gap
  assert(
    toolbarStyleSection.includes("gap: '8px 12px'"),
    '#302: Toolbar has consistent gap (8px 12px)'
  );

  // 6. Toolbar has adequate padding
  assert(
    toolbarStyleSection.includes("padding: '8px 16px'"),
    '#302: Toolbar has consistent padding (8px 16px)'
  );

  // 7. Toolbar has minHeight for stable layout
  assert(
    toolbarStyleSection.includes("minHeight: '48px'"),
    '#302: Toolbar has minHeight: 48px for stable layout'
  );

  // 8. Toolbar has flexShrink: 0 to prevent collapsing
  assert(
    toolbarStyleSection.includes('flexShrink: 0'),
    '#302: Toolbar has flexShrink: 0'
  );

  // 9. Frontend loads successfully
  try {
    const res = await httpGet('http://localhost:3001');
    assert(res.status === 200, '#302: Frontend loads successfully (status 200)');
  } catch (e) {
    assert(false, '#302: Frontend loads successfully - ' + e.message);
  }

  // ─── Feature #303: Block cards consistent sizing ───
  console.log('\n--- Feature #303: Block cards have consistent sizing ---\n');

  // 10. Block cards use CSS grid for equal sizing
  assert(
    source.includes("gridTemplateColumns: '1fr 1fr'"),
    '#303: Block cards use CSS grid with 1fr 1fr (equal width columns)'
  );

  // Extract block card section (wider range from className to the closing tag)
  const blockCardStart = source.indexOf('className="block-card"');
  const blockCardSection = source.substring(blockCardStart, blockCardStart + 2000);

  // 11. Block cards have minHeight for consistent sizing
  assert(
    blockCardSection.includes("minHeight: '52px'"),
    '#303: Block cards have minHeight: 52px for uniform height'
  );

  // 12. Block cards use flexbox centering for content
  assert(
    blockCardSection.includes("display: 'flex'") && blockCardSection.includes("alignItems: 'center'"),
    '#303: Block cards use flexbox centering for content alignment'
  );

  assert(
    blockCardSection.includes("justifyContent: 'center'"),
    '#303: Block cards use justifyContent: center for vertical centering'
  );

  assert(
    blockCardSection.includes("flexDirection: 'column'"),
    '#303: Block cards use flexDirection: column for icon-above-label layout'
  );

  // 13. Block cards have consistent padding
  assert(
    blockCardSection.includes("padding: '8px'"),
    '#303: Block cards have consistent padding (8px)'
  );

  // 14. Block cards have consistent border radius
  assert(
    blockCardSection.includes("borderRadius: '6px'"),
    '#303: Block cards have consistent borderRadius (6px)'
  );

  // 15. Block cards have consistent border
  assert(
    blockCardSection.includes("border: '1px solid #e2e8f0'"),
    '#303: Block cards have consistent border color'
  );

  // 16. Block cards have consistent background
  assert(
    blockCardSection.includes("backgroundColor: '#f8fafc'"),
    '#303: Block cards have consistent background color (#f8fafc)'
  );

  // 17. Block cards have consistent font size
  assert(
    blockCardSection.includes("fontSize: '11px'"),
    '#303: Block cards have consistent font size (11px)'
  );

  // 18. Block cards have hover effect via CSS class
  assert(
    source.includes('.block-card:hover'),
    '#303: Block cards have CSS hover effect (.block-card:hover)'
  );

  // 19. Hover effect changes background
  assert(
    source.includes('.block-card:hover') && source.includes('#eef2ff'),
    '#303: Block card hover changes background to #eef2ff'
  );

  // 20. Hover effect changes border
  assert(
    source.includes('.block-card:hover') && source.includes('#c7d2fe'),
    '#303: Block card hover changes border to #c7d2fe'
  );

  // 21. Block cards have transition for smooth hover effect
  assert(
    source.includes('.block-card {') && source.includes('transition:'),
    '#303: Block cards have CSS transition for smooth hover'
  );

  // 22. Block cards have active state
  assert(
    source.includes('.block-card:active'),
    '#303: Block cards have CSS active state (.block-card:active)'
  );

  // 23. Icon sizing consistent
  assert(
    blockCardSection.includes("fontSize: '16px'"),
    '#303: Block card icons have consistent size (16px)'
  );

  // 24. All blocks defined in BLOCK_CATEGORIES
  const expectedBlocks = ['text', 'rich-text', 'calculated', 'image', 'erp-image', 'signature', 'drawn-signature', 'line-items', 'grouped-table', 'qr-barcode', 'watermark'];
  const allBlocksPresent = expectedBlocks.every(b => source.includes(`id: '${b}'`));
  assert(allBlocksPresent, '#303: All expected block types defined in BLOCK_CATEGORIES');

  // 25. Grid gap consistent
  assert(
    source.includes("gridTemplateColumns: '1fr 1fr', gap: '8px'"),
    '#303: Block grid gap is 8px (consistent with properties panel)'
  );

  // ─── Feature #304: Consistent spacing and padding throughout ───
  console.log('\n--- Feature #304: Consistent spacing and padding throughout ---\n');

  // 26. Left panel tab content padding
  assert(
    source.includes("overflow: 'auto', padding: '12px'"),
    '#304: Left panel tab content has consistent padding (12px)'
  );

  // 27. Right panel header padding
  const rightPanelHeader = source.substring(
    source.indexOf('data-testid="right-panel"'),
    source.indexOf('data-testid="right-panel"') + 500
  );
  assert(
    rightPanelHeader.includes("padding: '12px 16px'"),
    '#304: Right panel header has consistent padding (12px 16px)'
  );

  // 28. Right panel content padding
  assert(
    source.includes("data-testid=\"properties-scroll-container\"") &&
    source.includes("padding: '16px'"),
    '#304: Right panel content has consistent padding (16px)'
  );

  // 29. Section margins consistent (16px between sections)
  const sectionMargins = (source.match(/marginBottom: '16px'/g) || []).length;
  assert(
    sectionMargins >= 5,
    `#304: Multiple sections use consistent marginBottom: 16px (found ${sectionMargins})`
  );

  // 30. Label style consistent across properties
  assert(
    source.includes("fontSize: '11px'") && source.includes("fontWeight: 600") && source.includes("textTransform: 'uppercase'"),
    '#304: Label styles consistent (11px, fontWeight 600, uppercase)'
  );

  // 31. Label style has letterSpacing
  assert(
    source.includes("letterSpacing: '0.5px'"),
    '#304: Labels have consistent letterSpacing (0.5px) for readability'
  );

  // 32. Block category labels match property labels (both uppercase, both 11px)
  const blockCatLabel = source.substring(
    source.indexOf("fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase'"),
    source.indexOf("fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase'") + 100
  );
  assert(
    blockCatLabel.includes("marginBottom: '6px'"),
    '#304: Block category labels have same marginBottom as property labels (6px)'
  );

  // 33. Input style consistent
  assert(
    source.includes("const propInputStyle: React.CSSProperties"),
    '#304: Property inputs use shared propInputStyle constant'
  );

  // 34. Consistent border color (#e2e8f0)
  const borderColorMatches = (source.match(/#e2e8f0/g) || []).length;
  assert(
    borderColorMatches >= 15,
    `#304: Consistent border color #e2e8f0 used throughout (found ${borderColorMatches} times)`
  );

  // 35. Consistent text colors used
  assert(
    source.includes("color: '#334155'") && source.includes("color: '#64748b'") && source.includes("color: '#94a3b8'"),
    '#304: Consistent text color hierarchy (#334155 primary, #64748b secondary, #94a3b8 muted)'
  );

  // 36. Toolbar items spacing (gap 8px 12px)
  assert(
    source.includes("gap: '8px 12px'"),
    '#304: Toolbar item spacing consistent (8px vertical, 12px horizontal gap)'
  );

  // 37. All panel gaps standardized to 8px
  const gap8Matches = (source.match(/gap: '8px'/g) || []).length;
  assert(
    gap8Matches >= 10,
    `#304: Gap spacing standardized to 8px throughout (found ${gap8Matches} instances)`
  );

  // 38. No inconsistent 6px gaps in component styles (only in CSS media queries is OK)
  const jsGap6 = source.match(/gap: '6px'/g);
  assert(
    !jsGap6 || jsGap6.length === 0,
    '#304: No inconsistent gap: 6px in JS inline styles (all standardized to 8px)'
  );

  // 39. Border radius consistency
  assert(
    source.includes("borderRadius: '6px'") && source.includes("borderRadius: '4px'"),
    '#304: Consistent borderRadius (6px for cards/sections, 4px for inputs)'
  );

  // 40. toolbarBtnStyle defined as shared constant
  assert(
    source.includes('const toolbarBtnStyle: React.CSSProperties'),
    '#304: Toolbar buttons use shared toolbarBtnStyle constant'
  );

  // 41. Context menu style defined as shared constant
  assert(
    source.includes('const contextMenuItemStyle: React.CSSProperties'),
    '#304: Context menu items use shared style constant'
  );

  // 42. API health check
  try {
    const healthRes = await httpGet('http://localhost:3000/api/pdfme/health');
    const health = JSON.parse(healthRes.body);
    assert(health.status === 'ok', '#304: API health check passes');
  } catch (e) {
    assert(false, '#304: API health check - ' + e.message);
  }

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
