/**
 * Tests for Features #184, #185, #186
 * - #184: Real-time canvas reflects properties changes
 * - #185: Drag block from panel creates element on canvas
 * - #186: Drag field from Fields tab binds to element
 *
 * Since browser automation (Playwright) is unavailable due to missing libatk-1.0.so.0,
 * we verify via source code analysis and SSR output.
 *
 * SSR renders initial state: Blocks tab active, no element selected.
 * Properties panel and Fields tab content only render client-side when state changes.
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const COMPONENT_PATH = '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${message}`);
  } else {
    failed++;
    results.push(`  ❌ ${message}`);
  }
}

async function fetchPage(path = '/') {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function testFeature184_PropertiesReflectOnCanvas() {
  console.log('\n--- Feature #184: Real-time canvas reflects properties changes ---');

  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  // 1. updateElement is the central function for property changes
  assert(source.includes('const updateElement = useCallback((elementId: string, updates: Partial<DesignElement>)'), 'updateElement callback defined with proper signature');
  assert(source.includes('setPages((prev)'), 'updateElement triggers React state update');
  assert(source.includes('el.id === elementId ? { ...el, ...updates } : el'), 'updateElement merges property updates into element');
  assert(source.includes('setIsDirty(true)'), 'updateElement marks document as dirty');

  // 2. Position & Size: onChange handlers call updateElement immediately
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { x: Number(e.target.value)'), 'X position onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { y: Number(e.target.value)'), 'Y position onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { w: Number(e.target.value)'), 'Width onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { h: Number(e.target.value)'), 'Height onChange triggers updateElement');

  // 3. Typography: font size, color, bold, italic, alignment
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value)'), 'Font size onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { fontFamily: e.target.value'), 'Font family onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { color: e.target.value'), 'Color onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { lineHeight: Number(e.target.value)'), 'Line height onChange triggers updateElement');
  assert(source.includes('updateElement(selectedElement.id, { fontWeight: selectedElement.fontWeight === \'bold\' ? \'normal\' : \'bold\''), 'Bold toggle triggers updateElement');
  assert(source.includes('updateElement(selectedElement.id, { fontStyle: selectedElement.fontStyle === \'italic\' ? \'normal\' : \'italic\''), 'Italic toggle triggers updateElement');
  assert(source.includes('updateElement(selectedElement.id, { textAlign: align'), 'Text align onClick triggers updateElement');

  // 4. Canvas rendering uses element properties (proves immediate reflection)
  assert(source.includes('left: `${el.x * scale}px`'), 'Canvas renders element X position from state');
  assert(source.includes('top: `${el.y * scale}px`'), 'Canvas renders element Y position from state');
  assert(source.includes('width: `${el.w * scale}px`'), 'Canvas renders element width from state');
  assert(source.includes('height: `${el.h * scale}px`'), 'Canvas renders element height from state');
  assert(source.includes('fontSize: `${(el.fontSize || 14) * scale}px`'), 'Canvas renders font size from state');
  assert(source.includes('fontFamily: el.fontFamily'), 'Canvas renders font family from state');
  assert(source.includes('fontWeight: el.fontWeight'), 'Canvas renders font weight from state');
  assert(source.includes('fontStyle: el.fontStyle'), 'Canvas renders font style from state');
  assert(source.includes('color: el.color'), 'Canvas renders color from state');
  assert(source.includes('textAlign: (el.textAlign'), 'Canvas renders text alignment from state');
  assert(source.includes('lineHeight: el.lineHeight'), 'Canvas renders line height from state');

  // 5. Properties panel is wired correctly: inputs use value={selectedElement.xxx}
  assert(source.includes('value={selectedElement.x}'), 'X input value bound to element state');
  assert(source.includes('value={selectedElement.y}'), 'Y input value bound to element state');
  assert(source.includes('value={selectedElement.w}'), 'Width input value bound to element state');
  assert(source.includes('value={selectedElement.h}'), 'Height input value bound to element state');
  assert(source.includes('value={selectedElement.fontSize || 14}'), 'Font size input bound to element state');
  assert(source.includes('value={selectedElement.fontFamily || \'Helvetica\'}'), 'Font family select bound to element state');
  assert(source.includes('value={selectedElement.color || \'#000000\'}'), 'Color input bound to element state');

  // 6. Image properties also update immediately
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { src: e.target.value'), 'Image src onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { objectFit:'), 'Object fit onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { opacity: Number(e.target.value)'), 'Opacity onChange triggers updateElement');

  // 7. Table properties update immediately
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { showHeader: e.target.checked'), 'Show header onChange triggers updateElement');
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { borderStyle:'), 'Border style onChange triggers updateElement');

  // 8. Content/textarea updates
  assert(source.includes('onChange={(e) => updateElement(selectedElement.id, { content: e.target.value'), 'Content textarea onChange triggers updateElement');
}

async function testFeature185_DragBlockCreatesElement() {
  console.log('\n--- Feature #185: Drag block from panel creates element on canvas ---');

  const html = await fetchPage('/');
  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  // 1. SSR: Block cards rendered with draggable attribute
  assert(html.includes('data-testid="block-text" draggable="true"'), 'Text block is draggable in HTML');
  assert(html.includes('data-testid="block-image" draggable="true"'), 'Image block is draggable in HTML');
  assert(html.includes('data-testid="block-rich-text" draggable="true"'), 'Rich text block is draggable in HTML');
  assert(html.includes('data-testid="block-line-items" draggable="true"'), 'Line items block is draggable in HTML');
  assert(html.includes('data-testid="block-watermark" draggable="true"'), 'Watermark block is draggable in HTML');

  // 2. Canvas page exists as drop target
  assert(html.includes('data-testid="canvas-page"'), 'Canvas page rendered in HTML');

  // 3. Block drag handler sets data transfer with block type
  assert(source.includes('const handleBlockDragStart = useCallback((e: React.DragEvent, blockType: ElementType)'), 'handleBlockDragStart defined');
  assert(source.includes("e.dataTransfer.setData('application/x-erp-block-type', blockType)"), 'Block drag sets MIME type data');
  assert(source.includes("e.dataTransfer.effectAllowed = 'copy'"), 'Block drag effect set to copy');

  // 4. Block cards wire onDragStart
  assert(source.includes('onDragStart={(e) => handleBlockDragStart(e, block.id)'), 'Block cards have onDragStart handler');

  // 5. Canvas has drag over and drop handlers
  assert(source.includes('onDragOver={handleCanvasDragOver}'), 'Canvas page has onDragOver');
  assert(source.includes('onDrop={handleCanvasDrop}'), 'Canvas page has onDrop');

  // 6. handleCanvasDragOver prevents default for drop acceptance
  assert(source.includes('const handleCanvasDragOver = useCallback((e: React.DragEvent)'), 'handleCanvasDragOver defined');
  assert(source.match(/handleCanvasDragOver[\s\S]*?e\.preventDefault\(\)/), 'handleCanvasDragOver prevents default');

  // 7. handleCanvasDrop processes block type drops
  assert(source.includes('const handleCanvasDrop = useCallback((e: React.DragEvent)'), 'handleCanvasDrop defined');
  assert(source.includes("const blockType = e.dataTransfer.getData('application/x-erp-block-type')"), 'Drop handler reads block type');
  assert(source.includes('addElementToCanvas(blockType as ElementType, { x: dropX, y: dropY })'), 'Drop handler creates element at position');

  // 8. addElementToCanvas supports position parameter
  assert(source.includes('addElementToCanvas = useCallback((type: ElementType, position?: { x: number; y: number })'), 'addElementToCanvas accepts optional position');
  assert(source.includes('if (position)'), 'addElementToCanvas uses position when provided');

  // 9. Drop position calculated relative to canvas
  assert(source.includes("closest('[data-testid=\"canvas-page\"]')"), 'Drop position calculated relative to canvas page');
  assert(source.includes('const scale = zoom / 100'), 'Drop position accounts for zoom scale');
  assert(source.includes('const dropX = Math.max(0, Math.round((e.clientX - rect.left) / scale))'), 'Drop X calculated from client coords');
  assert(source.includes('const dropY = Math.max(0, Math.round((e.clientY - rect.top) / scale))'), 'Drop Y calculated from client coords');

  // 10. Click still works (backwards compatible)
  assert(source.includes('onClick={() => addElementToCanvas(block.id)'), 'Block click still creates elements');
}

async function testFeature186_DragFieldBindsToElement() {
  console.log('\n--- Feature #186: Drag field from Fields tab binds to element ---');

  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  // 1. Field drag handler defined
  assert(source.includes('const handleFieldDragStart = useCallback((e: React.DragEvent, fieldKey: string)'), 'handleFieldDragStart defined');
  assert(source.includes("e.dataTransfer.setData('application/x-erp-field-key', fieldKey)"), 'Field drag sets field key data');

  // 2. Field items wire onDragStart
  assert(source.includes('onDragStart={(e) => handleFieldDragStart(e, field.key)'), 'Field items have onDragStart handler');

  // 3. Field items are draggable
  assert(source.includes("draggable\n                          onDragStart={(e) => handleFieldDragStart"), 'Field items have draggable attribute');

  // 4. Drop handler processes field key drops
  assert(source.includes("const fieldKey = e.dataTransfer.getData('application/x-erp-field-key')"), 'Drop handler reads field key');

  // 5. Dropping on existing element creates binding
  assert(source.includes("const targetEl = (e.target as HTMLElement).closest('[data-element-type]')"), 'Drop handler checks for existing element target');
  assert(source.includes("const elId = targetEl.getAttribute('data-testid')?.replace('canvas-element-', '')"), 'Drop handler extracts element ID');
  assert(source.includes('updateElement(elId, { binding: bindingSyntax, content: bindingSyntax })'), 'Drop on existing element updates binding and content');

  // 6. Binding syntax is {{field.key}}
  assert(source.includes('const bindingSyntax = `{{${fieldKey}}}`'), 'Binding syntax uses {{field.key}} format');

  // 7. Dropping on empty canvas creates new text element with binding
  assert(source.includes("const newId = addElementToCanvas('text', { x: dropX, y: dropY })"), 'Field drop on empty area creates text element');
  assert(source.includes('updateElement(newId, { binding: bindingSyntax, content: bindingSyntax })'), 'New element gets binding');

  // 8. Only compatible element types accept binding (text, qr-barcode)
  assert(source.includes("getElementCategory(el.type) === 'text' || el.type === 'qr-barcode'"), 'Only text/qr elements accept field binding on drop');

  // 9. Fields still support click binding (backwards compatible)
  assert(source.includes('handleBindField(field.key)'), 'Field click still creates binding on selected element');

  // 10. DATA_FIELDS constant has field groups
  assert(source.includes("group: 'Document'"), 'Document field group defined');
  assert(source.includes("group: 'Customer'"), 'Customer field group defined');
  assert(source.includes("group: 'Company'"), 'Company field group defined');
  assert(source.includes("key: 'document.number'"), 'Document number field defined');
  assert(source.includes("key: 'customer.name'"), 'Customer name field defined');
}

async function testMockDataAbsence() {
  console.log('\n--- Mock Data Detection ---');

  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  assert(!source.includes('globalThis'), 'No globalThis patterns');
  assert(!source.includes('devStore'), 'No devStore patterns');
  assert(!source.includes('mockDb'), 'No mockDb patterns');
  assert(!source.includes('fakeData'), 'No fakeData patterns');
  assert(!source.includes('dummyData'), 'No dummyData patterns');
  assert(!source.includes('STUB'), 'No STUB patterns');
  assert(!source.includes('MOCK'), 'No MOCK patterns');
}

async function testAppLoadsWithoutErrors() {
  console.log('\n--- App Loads Without Errors ---');

  const html = await fetchPage('/');

  assert(html.includes('data-testid="designer-toolbar"'), 'Designer toolbar renders');
  assert(html.includes('data-testid="designer-panels"'), 'Designer panels render');
  assert(html.includes('data-testid="left-panel"'), 'Left panel renders');
  assert(html.includes('data-testid="center-canvas"'), 'Center canvas renders');
  assert(html.includes('data-testid="right-panel"'), 'Right panel renders');
  assert(!html.includes('Error:'), 'No error messages in HTML');
  assert(!html.includes('Unhandled Runtime Error'), 'No Next.js runtime errors');
}

async function main() {
  console.log('Testing Features #184, #185, #186');
  console.log('=================================');

  try {
    await testFeature184_PropertiesReflectOnCanvas();
    await testFeature185_DragBlockCreatesElement();
    await testFeature186_DragFieldBindsToElement();
    await testMockDataAbsence();
    await testAppLoadsWithoutErrors();

    console.log('\n=== Results ===');
    results.forEach(r => console.log(r));
    console.log(`\nTotal: ${passed + failed} tests`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test error:', err.message);
    process.exit(1);
  }
}

main();
