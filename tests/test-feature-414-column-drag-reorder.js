const fs = require('fs');
const path = require('path');

const DESIGNER_URL = process.env.DESIGNER_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${message}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ ${message}\n`);
  }
}

const erpDesignerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

function testDndKitImports() {
  process.stdout.write('\n--- Test: dnd-kit imports ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes("from '@dnd-kit/core'"), 'Imports from @dnd-kit/core');
  assert(code.includes("from '@dnd-kit/sortable'"), 'Imports from @dnd-kit/sortable');
  assert(code.includes("from '@dnd-kit/utilities'"), 'Imports from @dnd-kit/utilities');
  assert(code.includes('DndContext'), 'Imports DndContext');
  assert(code.includes('SortableContext'), 'Imports SortableContext');
  assert(code.includes('useSortable'), 'Imports useSortable');
  assert(code.includes('arrayMove'), 'Imports arrayMove for reordering');
  assert(code.includes('verticalListSortingStrategy'), 'Imports verticalListSortingStrategy');
  assert(code.includes('CSS'), 'Imports CSS utility for transforms');
}

function testSortableColumnComponent() {
  process.stdout.write('\n--- Test: SortableColumnItem component ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('function SortableColumnItem'), 'SortableColumnItem component defined');
  assert(code.includes('useSortable'), 'Uses useSortable hook');
  assert(code.includes('CSS.Transform.toString(transform)'), 'Applies CSS transform for drag position');
  assert(code.includes("cursor: 'grab'"), 'Drag handle has grab cursor');
  assert(code.includes('isDragging'), 'Tracks drag state for visual feedback');
  assert(code.includes('⠿'), 'Drag handle uses ⠿ icon');
  assert(code.includes('{...attributes}'), 'Passes dnd-kit attributes to handle');
  assert(code.includes('{...listeners}'), 'Passes dnd-kit listeners to handle');
}

function testColumnProperties() {
  process.stdout.write('\n--- Test: Column property fields ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  // Key field
  assert(code.includes('prop-col-key-'), 'Column key input field present');
  // Header field
  assert(code.includes('prop-col-header-'), 'Column header input field present');
  // Width field
  assert(code.includes('prop-col-width-'), 'Column width input field present');
  // Alignment field (new)
  assert(code.includes('prop-col-align-'), 'Column alignment select field present');
  assert(code.includes("value=\"left\">Left"), 'Left alignment option');
  assert(code.includes("value=\"center\">Center"), 'Center alignment option');
  assert(code.includes("value=\"right\">Right"), 'Right alignment option');
  // Format field (new)
  assert(code.includes('prop-col-format-'), 'Column format input field present');
  assert(code.includes('#,##0.00'), 'Format placeholder shows number format example');
}

function testExpandCollapseDetails() {
  process.stdout.write('\n--- Test: Expand/collapse column details ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('prop-col-expand-'), 'Expand/collapse button present');
  assert(code.includes('isExpanded'), 'Tracks expanded state');
  assert(code.includes('onToggleExpand'), 'Toggle expand callback');
  assert(code.includes('expandedColumnIdx'), 'expandedColumnIdx state variable');
  assert(code.includes("isExpanded ? '▲' : '▼'"), 'Shows up/down arrow based on expanded state');
}

function testRemoveColumn() {
  process.stdout.write('\n--- Test: Remove column button ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('prop-col-remove-'), 'Remove column button present');
  assert(code.includes('onRemove'), 'Remove column callback');
  assert(code.includes("Remove column"), 'Remove button has aria-label');
  assert(code.includes("color: '#ef4444'"), 'Remove button is red');
}

function testAddColumn() {
  process.stdout.write('\n--- Test: Add column button ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('prop-add-column'), 'Add column button present');
  assert(code.includes('+ Add Column'), 'Add column button text');
  assert(code.includes("align: 'left'"), 'New columns default to left alignment');
}

function testDragAndDropReorder() {
  process.stdout.write('\n--- Test: Drag-and-drop reorder logic ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('onDragEnd'), 'DndContext has onDragEnd handler');
  assert(code.includes('arrayMove'), 'Uses arrayMove for reordering');
  assert(code.includes('active.id !== over.id'), 'Only reorders when position changes');
  assert(code.includes('updateElement(selectedElement.id, { columns: reordered })'), 'Persists reordered columns to schema');
  assert(code.includes('closestCenter'), 'Uses closestCenter collision detection');
  assert(code.includes('PointerSensor'), 'Uses PointerSensor for mouse drag');
  assert(code.includes('KeyboardSensor'), 'Uses KeyboardSensor for accessibility');
  assert(code.includes('distance: 5'), 'Pointer sensor has activation distance threshold');
}

function testColumnTypeDefinition() {
  process.stdout.write('\n--- Test: Column type definition ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes("interface TableColumn"), 'TableColumn interface defined');
  assert(code.includes("align?: 'left' | 'center' | 'right'"), 'TableColumn has align property');
  assert(code.includes("format?: string"), 'TableColumn has format property');

  // DesignElement columns type includes align and format
  assert(code.includes("columns?: Array<{ key: string; header: string; width: number; align?"), 'DesignElement columns include align');
}

function testCanvasRendersAlignment() {
  process.stdout.write('\n--- Test: Canvas renders column alignment ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes("textAlign: (col.align || 'left')"), 'Canvas applies column alignment to header text');
}

function testDragHandleAccessibility() {
  process.stdout.write('\n--- Test: Drag handle accessibility ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes("Drag to reorder column"), 'Drag handle has aria-label');
  assert(code.includes('prop-col-drag-'), 'Drag handle has test ID');
}

function testTableConfigForTableCategory() {
  process.stdout.write('\n--- Test: Table config shows for table category ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes("category === 'table'"), 'Table config conditional on table category');
  assert(code.includes('properties-table'), 'Table properties section has test ID');
  assert(code.includes('Table Configuration'), 'Section labeled Table Configuration');
  assert(code.includes('prop-show-header'), 'Show header checkbox present');
  assert(code.includes('prop-border-style'), 'Border style select present');
}

function testColumnListContainer() {
  process.stdout.write('\n--- Test: Column list container ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  assert(code.includes('column-list-container'), 'Column list container has test ID');
  assert(code.includes('drag ⠿ to reorder'), 'Hint text about drag to reorder');
}

function testLineItemsDefaultColumns() {
  process.stdout.write('\n--- Test: Line items default columns ---\n');
  const code = fs.readFileSync(erpDesignerPath, 'utf8');

  // Line items default has 4 columns
  assert(code.includes("key: 'description', header: 'Description'"), 'Default description column');
  assert(code.includes("key: 'qty', header: 'Qty'"), 'Default qty column');
  assert(code.includes("key: 'price', header: 'Price'"), 'Default price column');
  assert(code.includes("key: 'total', header: 'Total'"), 'Default total column');
}

async function testDesignerBuilds() {
  process.stdout.write('\n--- Test: Designer builds and serves ---\n');
  const response = await fetch(DESIGNER_URL);
  assert(response.ok, 'Designer responds with 200');
  const html = await response.text();
  assert(!html.includes('Internal Server Error'), 'No server errors');
  assert(!html.includes('Build Error'), 'No build errors');
}

async function main() {
  process.stdout.write('=== Feature #414: Line Items Table column drag reorder in properties sidebar ===\n');

  try {
    // Code verification tests
    testDndKitImports();
    testSortableColumnComponent();
    testColumnProperties();
    testExpandCollapseDetails();
    testRemoveColumn();
    testAddColumn();
    testDragAndDropReorder();
    testColumnTypeDefinition();
    testCanvasRendersAlignment();
    testDragHandleAccessibility();
    testTableConfigForTableCategory();
    testColumnListContainer();
    testLineItemsDefaultColumns();

    // Runtime tests
    await testDesignerBuilds();
  } catch (err) {
    process.stdout.write(`Test error: ${err.message}\n`);
    failed++;
  }

  process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
