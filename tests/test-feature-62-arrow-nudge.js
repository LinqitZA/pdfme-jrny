/**
 * Feature #62: Canvas arrow nudge 1px and shift 10px
 * Arrow keys move elements precisely
 *
 * Steps:
 * 1. Arrow right - 1px
 * 2. Shift+arrow right - 10px
 * 3. Arrow up - 1px
 * 4. Shift+arrow up - 10px
 *
 * Tests verify source code has arrow key nudge with 1px/10px step logic.
 */
const http = require('http');
const fs = require('fs');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';

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
  console.log('Feature #62: Canvas arrow nudge 1px and shift 10px\n');

  const src = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: Arrow key detection ===
  console.log('--- Arrow Key Detection ---');

  test('ArrowUp key handler exists', () => {
    assert(src.includes("e.key === 'ArrowUp'"), 'ArrowUp handler not found');
  });

  test('ArrowDown key handler exists', () => {
    assert(src.includes("e.key === 'ArrowDown'"), 'ArrowDown handler not found');
  });

  test('ArrowLeft key handler exists', () => {
    assert(src.includes("e.key === 'ArrowLeft'"), 'ArrowLeft handler not found');
  });

  test('ArrowRight key handler exists', () => {
    assert(src.includes("e.key === 'ArrowRight'"), 'ArrowRight handler not found');
  });

  test('All four arrow keys handled in single condition', () => {
    const match = src.match(/ArrowUp.*ArrowDown.*ArrowLeft.*ArrowRight/);
    assert(match, 'All four arrow keys not in single condition');
  });

  // === SECTION 2: Step size ===
  console.log('\n--- Step Size ---');

  test('Default step is 1px', () => {
    const stepLogic = src.match(/const step\s*=\s*e\.shiftKey\s*\?\s*10\s*:\s*1/);
    assert(stepLogic, 'Step logic (shiftKey ? 10 : 1) not found');
  });

  test('Shift key increases step to 10px', () => {
    assert(src.includes('e.shiftKey ? 10 : 1'), 'Shift key 10px logic not found');
  });

  test('Step applied as dx for horizontal movement', () => {
    const dxCalc = src.match(/const dx\s*=.*ArrowLeft.*-step.*ArrowRight.*step.*0/);
    assert(dxCalc, 'dx calculation not found');
  });

  test('Step applied as dy for vertical movement', () => {
    const dyCalc = src.match(/const dy\s*=.*ArrowUp.*-step.*ArrowDown.*step.*0/);
    assert(dyCalc, 'dy calculation not found');
  });

  // === SECTION 3: Direction calculation ===
  console.log('\n--- Direction Calculation ---');

  test('ArrowLeft moves negative x (-step)', () => {
    assert(src.includes("e.key === 'ArrowLeft' ? -step"), 'ArrowLeft -step not found');
  });

  test('ArrowRight moves positive x (+step)', () => {
    assert(src.includes("e.key === 'ArrowRight' ? step"), 'ArrowRight +step not found');
  });

  test('ArrowUp moves negative y (-step)', () => {
    assert(src.includes("e.key === 'ArrowUp' ? -step"), 'ArrowUp -step not found');
  });

  test('ArrowDown moves positive y (+step)', () => {
    assert(src.includes("e.key === 'ArrowDown' ? step"), 'ArrowDown +step not found');
  });

  // === SECTION 4: Position update ===
  console.log('\n--- Position Update ---');

  test('Element position updated via updateElement', () => {
    // The arrow key handler should call updateElement with new x, y
    assert(src.includes('updateElement(id, {'), 'updateElement not called with id');
  });

  test('Position clamped to minimum 0 (no negative)', () => {
    assert(src.includes('Math.max(0,'), 'Position not clamped to 0');
  });

  test('x position uses Math.max(0, el.x + dx)', () => {
    assert(src.includes('x: Math.max(0, (el.x ?? 0) + dx)'), 'x position calculation not found');
  });

  test('y position uses Math.max(0, el.y + dy)', () => {
    assert(src.includes('y: Math.max(0, (el.y ?? 0) + dy)'), 'y position calculation not found');
  });

  // === SECTION 5: Selection requirement ===
  console.log('\n--- Selection Requirement ---');

  test('Arrow nudge requires element(s) selected', () => {
    assert(src.includes('idsToNudge.length > 0'), 'Selection check for nudge not found');
  });

  test('preventDefault called to prevent page scroll', () => {
    // In the arrow key handler, e.preventDefault() should be called
    assert(src.includes('e.preventDefault()'), 'preventDefault not found');
  });

  test('Arrow keys do not work when focused on input', () => {
    assert(src.includes('if (isInput) return'), 'Input focus check not found');
  });

  // === SECTION 6: Multi-select nudge ===
  console.log('\n--- Multi-select Nudge ---');

  test('Arrow keys nudge all selected elements in multi-select', () => {
    assert(src.includes('for (const id of idsToNudge)'), 'Multi-select nudge iteration not found');
  });

  test('Each element in multi-select gets its own position update', () => {
    // Each element should be found and updated individually
    const loopMatch = src.match(/for \(const id of idsToNudge\)[\s\S]*?const el = currentPage/);
    assert(loopMatch, 'Individual element lookup in nudge loop not found');
  });

  test('Nudge falls back to single selectedElementId', () => {
    assert(src.includes("selectedElementId ? [selectedElementId] : []"), 'Single select fallback not found');
  });

  // === SECTION 7: Keyboard handler registration ===
  console.log('\n--- Keyboard Handler ---');

  test('handleKeyDown registered on window', () => {
    assert(src.includes("window.addEventListener('keydown', handleKeyDown)"), 'keydown listener not registered');
  });

  test('handleKeyDown cleanup on unmount', () => {
    assert(src.includes("window.removeEventListener('keydown', handleKeyDown)"), 'keydown listener not cleaned up');
  });

  test('Arrow key comment documents nudge behavior', () => {
    assert(src.includes('Arrow keys nudge selected element'), 'Arrow key comment not found');
    assert(src.includes('1px default, 10px with Shift'), 'Step size comment not found');
  });

  // === SECTION 8: Integration ===
  console.log('\n--- Integration ---');

  test('updateElement function takes elementId and updates object', () => {
    assert(src.includes('updateElement = useCallback((elementId: string, updates: Partial<DesignElement>)'), 'updateElement signature not found');
  });

  test('updateElement is in useEffect dependencies', () => {
    assert(src.includes('updateElement]'), 'updateElement not in deps');
  });

  // === SECTION 9: Page load ===
  console.log('\n--- Page Load ---');

  test('Page loads successfully', () => {
    assert(html.length > 1000, 'Page HTML too short');
  });

  test('ErpDesigner component reference exists', () => {
    assert(html.includes('erp-designer'), 'erp-designer not found');
  });

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failed > 0) process.exit(1);
})();
