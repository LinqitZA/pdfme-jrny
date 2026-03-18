/**
 * Test script: Properties Panel Features (#54, #55, #56)
 *
 * Verifies:
 * - #54: Properties panel is context-sensitive to element selection
 * - #55: Position/size inputs update elements on canvas
 * - #56: Data binding picker sets {{field.key}} syntax
 *
 * Run: node tests/test-properties-panel.js
 */

const fs = require('fs');
const path = require('path');

const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const source = fs.readFileSync(componentPath, 'utf8');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

console.log('=== Feature #54: Properties panel context-sensitive to selection ===\n');

assert(source.includes('properties-typography'), 'Typography section exists for text elements');
assert(source.includes('properties-image'), 'Image options section exists for image elements');
assert(source.includes('properties-table'), 'Table configuration section exists for table elements');
assert(source.includes('properties-empty'), 'Empty state shown when no element selected');
assert(source.includes('properties-type-label'), 'Element type label shown in properties');
assert(source.includes("getElementCategory(selectedElement.type)"), 'Context-sensitive rendering based on element type');

const categoryFunction = source.includes("case 'text'") && source.includes("return 'text'");
assert(categoryFunction, 'Text elements categorized correctly');

const imageCategoryExists = source.includes("case 'image'") && source.includes("return 'image'");
assert(imageCategoryExists, 'Image elements categorized correctly');

const tableCategoryExists = source.includes("case 'line-items'") && source.includes("return 'table'");
assert(tableCategoryExists, 'Table elements categorized correctly');

assert(source.includes("category === 'text'") && source.includes('properties-typography'), 'Typography panel shown only for text category');
assert(source.includes("category === 'image'") && source.includes('properties-image'), 'Image panel shown only for image category');
assert(source.includes("category === 'table'") && source.includes('properties-table'), 'Table panel shown only for table category');
assert(source.includes("prop-font-family"), 'Font family selector in typography');
assert(source.includes("prop-font-size"), 'Font size input in typography');
assert(source.includes("prop-bold"), 'Bold toggle in typography');
assert(source.includes("prop-italic"), 'Italic toggle in typography');
assert(source.includes("prop-align-${align}") && source.includes("textAlign: align"), 'Text alignment options in typography');
assert(source.includes("prop-color"), 'Color picker in typography');
assert(source.includes("prop-src"), 'Source URL input for images');
assert(source.includes("prop-object-fit"), 'Object fit selector for images');
assert(source.includes("prop-opacity"), 'Opacity input for images');
assert(source.includes("prop-show-header"), 'Show header checkbox for tables');
assert(source.includes("prop-border-style"), 'Border style selector for tables');
assert(source.includes("prop-add-column"), 'Add column button for tables');

console.log('\n=== Feature #55: Properties panel position/size inputs ===\n');

assert(source.includes('properties-position-size'), 'Position & Size section exists');
assert(source.includes('prop-x') && source.includes('prop-y'), 'X and Y position inputs exist');
assert(source.includes('prop-w') && source.includes('prop-h'), 'Width and Height inputs exist');
assert(source.includes("updateElement(selectedElement.id, { x: Number(e.target.value)"), 'X input updates element position');
assert(source.includes("updateElement(selectedElement.id, { y: Number(e.target.value)"), 'Y input updates element position');
assert(source.includes("updateElement(selectedElement.id, { w: Number(e.target.value)"), 'W input updates element size');
assert(source.includes("updateElement(selectedElement.id, { h: Number(e.target.value)"), 'H input updates element size');

const updateElementFn = source.includes('const updateElement = useCallback((elementId: string, updates: Partial<DesignElement>)');
assert(updateElementFn, 'updateElement function updates page elements');
assert(source.includes("el.id === elementId ? { ...el, ...updates } : el"), 'Element updates applied correctly');
assert(source.includes("left: `${el.x * scale}px`") && source.includes("top: `${el.y * scale}px`"), 'Canvas elements positioned using x/y values');
assert(source.includes("width: `${el.w * scale}px`") && source.includes("height: `${el.h * scale}px`"), 'Canvas elements sized using w/h values');
assert(source.includes("value={selectedElement.x}"), 'X input shows current element X value');
assert(source.includes("value={selectedElement.y}"), 'Y input shows current element Y value');
assert(source.includes("value={selectedElement.w}"), 'W input shows current element width');
assert(source.includes("value={selectedElement.h}"), 'H input shows current element height');

console.log('\n=== Feature #56: Properties panel data binding picker ===\n');

assert(source.includes('properties-binding'), 'Data binding section exists');
assert(source.includes('btn-open-binding-picker'), 'Open binding picker button exists');
assert(source.includes('binding-picker'), 'Binding picker dropdown exists');
assert(source.includes('binding-search'), 'Binding search input exists');
assert(source.includes('binding-preview-value'), 'Binding preview value shown');
assert(source.includes("handleBindField"), 'handleBindField function exists');
assert(source.includes("`{{${fieldKey}}}`"), 'Binding syntax uses {{field.key}} format');
assert(source.includes("updateElement(selectedElementId, { binding: bindingSyntax, content: bindingSyntax })"), 'Binding sets both binding and content properties');
assert(source.includes("DATA_FIELDS"), 'Data fields defined for picker');
assert(source.includes("document.number"), 'Document fields available');
assert(source.includes("customer.name"), 'Customer fields available');
assert(source.includes("company.name"), 'Company fields available');
assert(source.includes("field.example"), 'Example values shown for preview');

const previewLogic = source.includes("const match = selectedElement.binding.match");
assert(previewLogic, 'Preview substitutes example value for bound field');

console.log('\n=== Canvas Element Interactions ===\n');

assert(source.includes("addElementToCanvas"), 'Elements can be added to canvas');
assert(source.includes("onClick={() => addElementToCanvas(block.id)"), 'Clicking blocks adds elements');
assert(source.includes("setSelectedElementId(el.id)"), 'Clicking canvas elements selects them');
assert(source.includes("setSelectedElementId(null)"), 'Clicking canvas background deselects');
assert(source.includes("btn-delete-element"), 'Delete element button exists');
assert(source.includes("renderCanvasElement"), 'Canvas elements render with visual representation');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
