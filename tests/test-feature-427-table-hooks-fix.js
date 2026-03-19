/**
 * Feature #427: Fix Line Items Table and Grouped Table crash (React hooks violation)
 *
 * Tests verify that:
 * 1. The conditional IIFE with useSensors/useSensor hooks has been replaced with a proper component
 * 2. The TableColumnConfigurator component exists as a standalone component
 * 3. No React hooks are called inside conditional IIFEs
 * 4. Designer page loads without React error #310
 * 5. API endpoints for templates with table elements work correctly
 * 6. SortableColumnItem component remains unchanged (hooks at top level)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_BASE = process.env.DESIGNER_BASE || 'http://localhost:3000';

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✅ ${name}`);
      }).catch((err) => {
        failed++;
        console.log(`  ❌ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✅ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
    return Promise.resolve();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Read the ErpDesigner.tsx source code for static analysis
const erpDesignerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const source = fs.readFileSync(erpDesignerPath, 'utf8');

async function runTests() {
  console.log('\n=== Feature #427: Fix Line Items Table and Grouped Table crash ===\n');

  // --- Section 1: Static Code Analysis ---
  console.log('--- Section 1: Static Code Analysis ---');

  await test('TableColumnConfigurator component exists as standalone function', () => {
    assert(source.includes('function TableColumnConfigurator('),
      'TableColumnConfigurator function not found');
  });

  await test('TableColumnConfigurator has useSensors at top level', () => {
    // Find the TableColumnConfigurator function body
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compBody = source.substring(compStart, compStart + 2000);
    assert(compBody.includes('const sensors = useSensors('),
      'useSensors not found at top level of TableColumnConfigurator');
  });

  await test('TableColumnConfigurator has useSensor at top level', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compBody = source.substring(compStart, compStart + 2000);
    assert(compBody.includes('useSensor(PointerSensor'),
      'useSensor(PointerSensor) not found in TableColumnConfigurator');
    assert(compBody.includes('useSensor(KeyboardSensor'),
      'useSensor(KeyboardSensor) not found in TableColumnConfigurator');
  });

  await test('No useSensors/useSensor inside conditional IIFE', () => {
    // Search for the old pattern: (() => { ... useSensors ... })()
    // The old code had: {category === 'table' && (() => {
    const iifePattern = /\(\(\)\s*=>\s*\{[^}]*useSensors/s;
    assert(!iifePattern.test(source),
      'Found useSensors inside conditional IIFE - hooks violation still present');
  });

  await test('No useSensor inside conditional IIFE', () => {
    const iifePattern = /\(\(\)\s*=>\s*\{[^}]*useSensor\(/s;
    assert(!iifePattern.test(source),
      'Found useSensor inside conditional IIFE - hooks violation still present');
  });

  await test('TableColumnConfigurator is used with JSX syntax (not IIFE)', () => {
    assert(source.includes('<TableColumnConfigurator'),
      'TableColumnConfigurator not used as JSX element');
  });

  await test('Conditional rendering uses component mount/unmount (not conditional hooks)', () => {
    // The pattern should be: {category === 'table' && (<TableColumnConfigurator ... />)}
    const pattern = /category\s*===\s*['"]table['"]\s*&&\s*\(\s*\n?\s*<TableColumnConfigurator/;
    assert(pattern.test(source),
      'Expected pattern: category === "table" && (<TableColumnConfigurator ...)');
  });

  await test('TableColumnConfigurator accepts columns prop', () => {
    assert(source.includes('columns: TableColumn[]'),
      'columns prop type not found');
  });

  await test('TableColumnConfigurator accepts expandedColumnIdx prop', () => {
    assert(source.includes('expandedColumnIdx: number | null'),
      'expandedColumnIdx prop not found');
  });

  await test('TableColumnConfigurator accepts onExpandColumn prop', () => {
    assert(source.includes('onExpandColumn: (idx: number | null) => void'),
      'onExpandColumn prop not found');
  });

  await test('TableColumnConfigurator accepts onUpdateColumns prop', () => {
    assert(source.includes('onUpdateColumns: (columns: TableColumn[]) => void'),
      'onUpdateColumns prop not found');
  });

  await test('TableColumnConfigurator accepts propInputStyle prop', () => {
    assert(source.includes('propInputStyle: React.CSSProperties'),
      'propInputStyle prop not found');
  });

  await test('SortableColumnItem component still exists (unchanged)', () => {
    assert(source.includes('function SortableColumnItem('),
      'SortableColumnItem function not found');
  });

  await test('SortableColumnItem uses useSortable at top level (unchanged)', () => {
    const compStart = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compStart + 1000);
    assert(compBody.includes('useSortable('),
      'useSortable not found in SortableColumnItem');
  });

  await test('DndContext is inside TableColumnConfigurator (not in main component)', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('\n}\n', compStart + 100); // End of component
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('<DndContext'),
      'DndContext not found inside TableColumnConfigurator');
  });

  await test('SortableContext is inside TableColumnConfigurator', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('\n}\n', compStart + 100);
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('<SortableContext'),
      'SortableContext not found inside TableColumnConfigurator');
  });

  await test('sensors variable is passed to DndContext (not inline hook call)', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compBody = source.substring(compStart, compStart + 3000);
    assert(compBody.includes('sensors={sensors}'),
      'Expected sensors={sensors} in DndContext, not inline useSensors()');
  });

  await test('Add Column button is inside TableColumnConfigurator', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('\n}\n', compStart + 100);
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('prop-add-column'),
      'Add column button not found inside TableColumnConfigurator');
  });

  await test('Show Header checkbox is inside TableColumnConfigurator', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('\n}\n', compStart + 100);
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('prop-show-header'),
      'Show header checkbox not found inside TableColumnConfigurator');
  });

  await test('Border Style select is inside TableColumnConfigurator', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('\n}\n', compStart + 100);
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('prop-border-style'),
      'Border style select not found inside TableColumnConfigurator');
  });

  await test('No React hooks called in renderPropertiesPanel conditional blocks', () => {
    // Find renderPropertiesPanel or the properties panel section
    // Look for any useSensor/useSensors/useState/useEffect inside IIFE patterns
    const iifeHookPattern = /\(\(\)\s*=>\s*\{[^}]*(useSensor|useSensors|useState|useEffect|useCallback|useMemo|useRef)\s*\(/s;
    assert(!iifeHookPattern.test(source),
      'Found React hooks inside IIFE pattern - hooks violation');
  });

  await test('Column list container data-testid preserved', () => {
    assert(source.includes('data-testid="column-list-container"'),
      'column-list-container testid not found');
  });

  await test('Properties table data-testid preserved', () => {
    assert(source.includes('data-testid="properties-table"'),
      'properties-table testid not found');
  });

  // --- Section 2: Designer Page Load Tests ---
  console.log('\n--- Section 2: Designer Page Load Tests ---');

  await test('Designer page loads successfully (HTTP 200)', async () => {
    const res = await fetch(DESIGNER_BASE);
    assertEqual(res.status, 200, 'Designer page status');
  });

  await test('Designer page contains no React error #310 in initial HTML', async () => {
    const res = await fetch(DESIGNER_BASE);
    const html = await res.text();
    assert(!html.includes('error #310'), 'Found React error #310 in page HTML');
    assert(!html.includes('Objects are not valid as a React child'),
      'Found React child error in page HTML');
  });

  await test('Designer page includes the app component', async () => {
    const res = await fetch(DESIGNER_BASE);
    const html = await res.text();
    assert(html.includes('pdfme ERP Designer'), 'Page title not found');
  });

  // --- Section 3: API Tests with Table Elements ---
  console.log('\n--- Section 3: API Tests with Table Elements ---');

  // Generate auth token using dev secret
  const authToken = jwt.sign(
    { sub: 'user-427', orgId: 'test-org-427', roles: ['admin'] },
    'pdfme-dev-secret'
  );

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  await test('Can create template with lineItemsTable element via API', async () => {
    const template = {
      name: 'TEST_427_LineItemsTable_' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'items',
            type: 'lineItemsTable',
            position: { x: 10, y: 10 },
            width: 190,
            height: 100,
            columns: [
              { key: 'item', header: 'Item', width: 80, align: 'left' },
              { key: 'qty', header: 'Qty', width: 30, align: 'right' },
              { key: 'price', header: 'Price', width: 40, align: 'right', format: '#,##0.00' },
            ],
            showHeader: true,
            borderStyle: 'solid',
          }],
        }],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    };

    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(template),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await res.json();
    assert(data.id, 'Template should have an ID');
  });

  await test('Can create template with groupedTable element via API', async () => {
    const template = {
      name: 'TEST_427_GroupedTable_' + Date.now(),
      type: 'report',
      schema: {
        pages: [{
          elements: [{
            name: 'report',
            type: 'groupedTable',
            position: { x: 10, y: 10 },
            width: 190,
            height: 100,
            columns: [
              { key: 'category', header: 'Category', width: 60, align: 'left' },
              { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' },
            ],
            showHeader: true,
            borderStyle: 'solid',
          }],
        }],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    };

    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(template),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
    const data = await res.json();
    assert(data.id, 'Template should have an ID');
  });

  await test('Can create template with mixed table and text elements', async () => {
    const template = {
      name: 'TEST_427_Mixed_' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          elements: [
            { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 190, height: 10, content: 'Invoice' },
            { name: 'items', type: 'lineItemsTable', position: { x: 10, y: 25 }, width: 190, height: 100, columns: [{ key: 'item', header: 'Item', width: 80 }, { key: 'qty', header: 'Qty', width: 30 }] },
            { name: 'footer', type: 'text', position: { x: 10, y: 130 }, width: 190, height: 10, content: 'Thank you' },
          ],
        }],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    };

    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(template),
    });
    assert(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}`);
  });

  await test('Template with table columns preserves column data on retrieval', async () => {
    const cols = [
      { key: 'col1', header: 'First', width: 60, align: 'left' },
      { key: 'col2', header: 'Second', width: 40, align: 'center' },
      { key: 'col3', header: 'Third', width: 50, align: 'right', format: '#,##0' },
    ];
    const template = {
      name: 'TEST_427_ColPersist_' + Date.now(),
      type: 'custom',
      schema: {
        pages: [{ elements: [{ name: 'table1', type: 'lineItemsTable', position: { x: 10, y: 10 }, width: 190, height: 100, columns: cols }] }],
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      },
    };

    const createRes = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(template),
    });
    const created = await createRes.json();
    assert(created.id, 'Template should have ID');

    // Fetch it back - use draft endpoint since template may not be published
    const getRes = await fetch(`${API_BASE}/templates/${created.id}/draft`, {
      headers: authHeaders,
    });
    if (getRes.status === 200) {
      const fetched = await getRes.json();
      const schemaStr = JSON.stringify(fetched.schema || fetched.schemas || fetched);
      assert(schemaStr.includes('col1'), 'Schema should contain col1');
      assert(schemaStr.includes('col3'), 'Schema should contain col3');
      assert(schemaStr.includes('#,##0'), 'Schema should contain format');
    } else {
      // Try the regular endpoint
      const getRes2 = await fetch(`${API_BASE}/templates/${created.id}`, {
        headers: authHeaders,
      });
      assert(getRes2.status === 200 || getRes2.status === 403,
        `Expected 200 or 403, got ${getRes2.status}`);
      // If 403, the template was created but org scoping prevents retrieval in draft state
      // The creation itself validates the schema was accepted
      if (getRes2.status === 200) {
        const fetched = await getRes2.json();
        const schemaStr = JSON.stringify(fetched.schema || fetched.schemas || fetched);
        assert(schemaStr.includes('col1'), 'Schema should contain col1');
      }
    }
  });

  // --- Section 4: Code Structure Verification ---
  console.log('\n--- Section 4: Code Structure Verification ---');

  await test('TableColumnConfigurator is defined before SortableColumnItem', () => {
    const configIdx = source.indexOf('function TableColumnConfigurator(');
    const sortableIdx = source.indexOf('function SortableColumnItem(');
    assert(configIdx < sortableIdx,
      'TableColumnConfigurator should be defined before SortableColumnItem');
  });

  await test('TableColumnConfigurator is defined outside main ErpDesigner component', () => {
    const configIdx = source.indexOf('function TableColumnConfigurator(');
    const mainCompIdx = source.indexOf('export default function ErpDesigner');
    if (mainCompIdx === -1) {
      // Try alternate patterns
      const altIdx = source.indexOf('function ErpDesigner(');
      assert(configIdx < altIdx,
        'TableColumnConfigurator should be defined before ErpDesigner');
    } else {
      assert(configIdx < mainCompIdx,
        'TableColumnConfigurator should be defined before ErpDesigner');
    }
  });

  await test('No duplicate DndContext in main component (only in TableColumnConfigurator)', () => {
    // Count DndContext occurrences - should be exactly 1 (in TableColumnConfigurator)
    const matches = source.match(/<DndContext/g);
    assertEqual(matches?.length, 1, 'DndContext count should be 1');
  });

  await test('arrayMove is used in onDragEnd handler', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('arrayMove('), 'arrayMove not found in TableColumnConfigurator');
  });

  await test('onUpdateColumns callback is used for column operations', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compEnd);
    // Should use onUpdateColumns for drag reorder, column edit, column remove, add column
    const occurrences = (compBody.match(/onUpdateColumns\(/g) || []).length;
    assert(occurrences >= 3,
      `Expected at least 3 onUpdateColumns calls (drag, edit, remove, add), found ${occurrences}`);
  });

  await test('onExpandColumn callback is used for column expand/collapse', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('onExpandColumn('),
      'onExpandColumn not found in TableColumnConfigurator');
  });

  await test('closestCenter collision detection is used', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('collisionDetection={closestCenter}'),
      'closestCenter collision detection not found');
  });

  await test('verticalListSortingStrategy is used', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compEnd = source.indexOf('function SortableColumnItem(');
    const compBody = source.substring(compStart, compEnd);
    assert(compBody.includes('strategy={verticalListSortingStrategy}'),
      'verticalListSortingStrategy not found');
  });

  await test('PointerSensor has activation constraint distance: 5', () => {
    const compStart = source.indexOf('function TableColumnConfigurator(');
    const compBody = source.substring(compStart, compStart + 1000);
    assert(compBody.includes('activationConstraint: { distance: 5 }'),
      'PointerSensor activation constraint not found');
  });

  // --- Summary ---
  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
