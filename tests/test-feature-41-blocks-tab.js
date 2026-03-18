/**
 * Feature #41: Designer Blocks tab displays block cards
 * Tests that the Blocks tab shows draggable cards grouped by Content, Media, Data, Layout, ERP
 * with icons and labels.
 *
 * Verification via server-rendered HTML (no browser needed - Next.js SSR).
 */
const http = require('http');

const FRONTEND_URL = 'http://localhost:3001';

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
  console.log('Feature #41: Designer Blocks tab displays block cards\n');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  // --- Category tests ---

  test('Page renders successfully (200 OK)', () => {
    assert(html.length > 0, 'HTML should not be empty');
    assert(html.includes('data-testid="blocks-content"'), 'Should contain blocks-content testid');
  });

  test('Blocks content area exists', () => {
    assert(html.includes('data-testid="blocks-content"'), 'blocks-content testid should exist');
  });

  const expectedCategories = ['Content', 'Media', 'Data', 'Layout', 'ERP'];

  test('All 5 categories are present: Content, Media, Data, Layout, ERP', () => {
    // Categories are rendered as uppercase divs
    for (const cat of expectedCategories) {
      const regex = new RegExp(`text-transform:\\s*uppercase[^>]*>${cat}</div>`, 'i');
      assert(regex.test(html), `Category "${cat}" not found in rendered HTML`);
    }
  });

  test('Categories appear in correct order', () => {
    const positions = expectedCategories.map(cat => {
      const regex = new RegExp(`text-transform:\\s*uppercase[^>]*>${cat}</div>`, 'i');
      const match = regex.exec(html);
      return { name: cat, pos: match ? match.index : -1 };
    });
    for (const p of positions) {
      assert(p.pos >= 0, `Category "${p.name}" not found`);
    }
    for (let i = 1; i < positions.length; i++) {
      assert(
        positions[i].pos > positions[i - 1].pos,
        `Category "${positions[i].name}" (pos ${positions[i].pos}) should appear after "${positions[i - 1].name}" (pos ${positions[i - 1].pos})`
      );
    }
  });

  // --- Block card tests ---

  const expectedBlocks = [
    { id: 'text', label: 'Text', icon: 'T', category: 'Content' },
    { id: 'rich-text', label: 'Rich Text', icon: 'Rt', category: 'Content' },
    { id: 'image', label: 'Image', icon: 'Img', category: 'Media' },
    { id: 'qr-barcode', label: 'QR/Barcode', icon: 'QR', category: 'Media' },
    { id: 'line-items', label: 'Line Items Table', icon: 'LI', category: 'Data' },
    { id: 'grouped-table', label: 'Grouped Table', icon: 'GT', category: 'Data' },
    { id: 'calculated', label: 'Calculated Field', icon: 'fx', category: 'Data' },
    { id: 'watermark', label: 'Watermark', icon: 'Wm', category: 'Layout' },
    { id: 'erp-image', label: 'ERP Image', icon: 'EI', category: 'ERP' },
    { id: 'signature', label: 'Signature Block', icon: 'Sig', category: 'ERP' },
    { id: 'drawn-signature', label: 'Drawn Signature', icon: 'DS', category: 'ERP' },
  ];

  test(`Total of ${expectedBlocks.length} block cards rendered`, () => {
    const matches = html.match(/data-testid="block-[^"]+"/g) || [];
    assert(
      matches.length === expectedBlocks.length,
      `Expected ${expectedBlocks.length} block cards, found ${matches.length}: ${matches.join(', ')}`
    );
  });

  // Test each block exists with correct attributes
  for (const block of expectedBlocks) {
    test(`Block "${block.label}" (${block.id}) exists with icon "${block.icon}"`, () => {
      const testId = `data-testid="block-${block.id}"`;
      assert(html.includes(testId), `Block testid "${testId}" not found`);

      // Check icon is present near the block
      const blockIdx = html.indexOf(testId);
      const blockSection = html.substring(blockIdx, blockIdx + 800);
      assert(blockSection.includes(`>${block.icon}</`), `Icon "${block.icon}" not found near block "${block.id}"`);
      assert(blockSection.includes(`>${block.label}</`), `Label "${block.label}" not found near block "${block.id}"`);
    });
  }

  // Test draggable attribute
  test('All block cards have draggable="true"', () => {
    const blockMatches = html.match(/class="block-card"[^>]*/g) || [];
    for (const match of blockMatches) {
      assert(match.includes('draggable="true"'), `Block card missing draggable: ${match.substring(0, 80)}`);
    }
  });

  // Test role="button"
  test('All block cards have role="button"', () => {
    const blockMatches = html.match(/class="block-card"[^>]*/g) || [];
    for (const match of blockMatches) {
      assert(match.includes('role="button"'), `Block card missing role="button": ${match.substring(0, 80)}`);
    }
  });

  // Test aria-label
  test('All block cards have aria-label starting with "Add"', () => {
    const ariaLabels = html.match(/aria-label="Add [^"]+block"/g) || [];
    assert(
      ariaLabels.length === expectedBlocks.length,
      `Expected ${expectedBlocks.length} aria-labels, found ${ariaLabels.length}`
    );
  });

  // Test tabindex for keyboard accessibility
  test('All block cards have tabindex="0"', () => {
    const blockMatches = html.match(/class="block-card"[^>]*/g) || [];
    for (const match of blockMatches) {
      assert(match.includes('tabindex="0"'), `Block card missing tabindex="0"`);
    }
  });

  // Test Blocks tab button exists
  test('Blocks tab button exists in left panel tabs', () => {
    assert(html.includes('data-testid="left-panel-tabs"'), 'Left panel tabs should exist');
    // The blocks tab should have aria-selected="true" (default tab)
    const tabSection = html.substring(
      html.indexOf('data-testid="left-panel-tabs"'),
      html.indexOf('data-testid="left-panel-tabs"') + 2000
    );
    assert(tabSection.includes('aria-selected="true"'), 'Blocks tab should be selected by default');
  });

  // Test grid layout (2-column grid)
  test('Block cards displayed in 2-column grid layout', () => {
    const gridMatches = html.match(/grid-template-columns:\s*1fr\s+1fr/g) || [];
    assert(gridMatches.length >= 5, `Expected 5 grid containers (one per category), found ${gridMatches.length}`);
  });

  // Test Content category has exactly 2 blocks
  test('Content category has exactly 2 blocks (Text, Rich Text)', () => {
    // Find the Content header and the next category header (Media)
    const contentIdx = html.indexOf('>Content</div>');
    const mediaIdx = html.indexOf('>Media</div>');
    assert(contentIdx >= 0, 'Content header not found');
    assert(mediaIdx > contentIdx, 'Media header should come after Content');
    const contentSection = html.substring(contentIdx, mediaIdx);
    const blocks = contentSection.match(/class="block-card"/g) || [];
    assert(blocks.length === 2, `Content should have 2 blocks, found ${blocks.length}`);
  });

  // Test Media category has exactly 2 blocks
  test('Media category has exactly 2 blocks (Image, QR/Barcode)', () => {
    const mediaIdx = html.indexOf('>Media</div>');
    const dataIdx = html.indexOf('>Data</div>');
    assert(mediaIdx >= 0, 'Media header not found');
    assert(dataIdx > mediaIdx, 'Data header should come after Media');
    const mediaSection = html.substring(mediaIdx, dataIdx);
    const blocks = mediaSection.match(/class="block-card"/g) || [];
    assert(blocks.length === 2, `Media should have 2 blocks, found ${blocks.length}`);
  });

  // Test Data category has exactly 3 blocks
  test('Data category has exactly 3 blocks (Line Items, Grouped Table, Calculated)', () => {
    const dataIdx = html.indexOf('>Data</div>');
    const layoutIdx = html.indexOf('>Layout</div>');
    assert(dataIdx >= 0, 'Data header not found');
    assert(layoutIdx > dataIdx, 'Layout header should come after Data');
    const dataSection = html.substring(dataIdx, layoutIdx);
    const blocks = dataSection.match(/class="block-card"/g) || [];
    assert(blocks.length === 3, `Data should have 3 blocks, found ${blocks.length}`);
  });

  // Test Layout category has exactly 1 block
  test('Layout category has exactly 1 block (Watermark)', () => {
    const layoutIdx = html.indexOf('>Layout</div>');
    const erpIdx = html.indexOf('>ERP</div>');
    assert(layoutIdx >= 0, 'Layout header not found');
    assert(erpIdx > layoutIdx, 'ERP header should come after Layout');
    const layoutSection = html.substring(layoutIdx, erpIdx);
    const blocks = layoutSection.match(/class="block-card"/g) || [];
    assert(blocks.length === 1, `Layout should have 1 block, found ${blocks.length}`);
  });

  // Test ERP category has exactly 3 blocks
  test('ERP category has exactly 3 blocks (ERP Image, Signature, Drawn Signature)', () => {
    const erpIdx = html.indexOf('>ERP</div>');
    assert(erpIdx >= 0, 'ERP header not found');
    // ERP is the last category, so go to end of blocks-content
    const erpSection = html.substring(erpIdx, erpIdx + 3000);
    const blocks = erpSection.match(/class="block-card"/g) || [];
    assert(blocks.length === 3, `ERP should have 3 blocks, found ${blocks.length}`);
  });

  // Test block card styling
  test('Block cards have proper styling (border, background, cursor)', () => {
    const firstCard = html.match(/class="block-card"[^>]*style="([^"]*)"/);
    assert(firstCard, 'Should find block card with style');
    const style = firstCard[1];
    assert(style.includes('border'), 'Block card should have border');
    assert(style.includes('cursor:grab'), 'Block card should have cursor:grab');
    assert(style.includes('border-radius'), 'Block card should have border-radius');
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
})();
