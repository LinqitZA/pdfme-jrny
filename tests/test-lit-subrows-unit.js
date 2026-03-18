/**
 * Unit test for Line Items Table conditional sub-rows
 * Feature #120: Sub-rows appear based on RowCondition
 */

require('@swc/register');

const {
  evaluateRowCondition,
  buildSubRowCells,
  resolveLineItemsTableData,
  resolveLineItemsTables,
} = require('../packages/erp-schemas/src/line-items-table/index.ts');

let pass = 0;
let fail = 0;

function check(desc, condition) {
  if (condition) { pass++; }
  else { fail++; }
}

// --- Test evaluateRowCondition ---

// fieldNonEmpty condition
check('fieldNonEmpty: true for non-empty string',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'notes' }, { notes: 'Has notes' }) === true);

check('fieldNonEmpty: false for empty string',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'notes' }, { notes: '' }) === false);

check('fieldNonEmpty: false for null',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'notes' }, { notes: null }) === false);

check('fieldNonEmpty: false for undefined',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'notes' }, {}) === false);

check('fieldNonEmpty: true for number',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'discount' }, { discount: 10 }) === true);

check('fieldNonEmpty: false for whitespace only',
  evaluateRowCondition({ type: 'fieldNonEmpty', field: 'notes' }, { notes: '   ' }) === false);

// expression condition
check('expression: field > 0 true',
  evaluateRowCondition({ type: 'expression', expression: 'discount > 0' }, { discount: 10 }) === true);

check('expression: field > 0 false',
  evaluateRowCondition({ type: 'expression', expression: 'discount > 0' }, { discount: 0 }) === false);

check('expression: field != "" true',
  evaluateRowCondition({ type: 'expression', expression: "notes != ''" }, { notes: 'hello' }) === true);

check('expression: field != "" false',
  evaluateRowCondition({ type: 'expression', expression: "notes != ''" }, { notes: '' }) === false);

check('expression: field == value',
  evaluateRowCondition({ type: 'expression', expression: "status == 'active'" }, { status: 'active' }) === true);

check('expression: field == value false',
  evaluateRowCondition({ type: 'expression', expression: "status == 'active'" }, { status: 'inactive' }) === false);

// --- Test buildSubRowCells ---

const columns = [
  { key: 'description', header: 'Description', width: 80, align: 'left' },
  { key: 'qty', header: 'Qty', width: 25, align: 'right' },
  { key: 'amount', header: 'Amount', width: 50, align: 'right' },
];

const subRowConfig = {
  id: 'notes-row',
  condition: { type: 'fieldNonEmpty', field: 'notes' },
  cells: {
    description: '  Note: {{notes}}',
  },
};

const itemWithNotes = { description: 'Widget A', qty: 10, amount: 100, notes: 'Special handling required' };
const cells = buildSubRowCells(itemWithNotes, subRowConfig, columns);

check('Sub-row cell 0 resolves binding', cells[0] === '  Note: Special handling required');
check('Sub-row cell 1 is empty (no mapping)', cells[1] === '');
check('Sub-row cell 2 is empty (no mapping)', cells[2] === '');

// --- Test resolveLineItemsTableData with sub-rows ---

const lineItems = [
  { description: 'Widget A', qty: 10, amount: 100, notes: 'Rush order' },
  { description: 'Widget B', qty: 5, amount: 50, notes: '' },
  { description: 'Service C', qty: 1, amount: 200, notes: 'Monthly retainer' },
];

const schema = {
  type: 'lineItemsTable',
  name: 'lineItems',
  position: { x: 10, y: 30 },
  width: 190,
  height: 200,
  showHeader: true,
  columns,
  subRows: [
    {
      id: 'notes-row',
      condition: { type: 'fieldNonEmpty', field: 'notes' },
      cells: { description: '  Note: {{notes}}' },
    },
  ],
  footerRows: [
    { id: 'total', label: 'Total', valueColumnKey: 'amount', type: 'sum', format: '#,##0.00' },
  ],
};

const tableData = resolveLineItemsTableData(lineItems, schema);

// Expected body:
// Row 0: Widget A (primary)
// Row 1: Note: Rush order (sub-row)
// Row 2: Widget B (primary) - no sub-row because notes is empty
// Row 3: Service C (primary)
// Row 4: Note: Monthly retainer (sub-row)
// Row 5: Total (footer)

check('Body has 6 rows (3 primary + 2 sub-rows + 1 footer)', tableData.body.length === 6);
check('Row 0: Widget A', tableData.body[0][0] === 'Widget A');
check('Row 1: sub-row with notes', tableData.body[1][0] === '  Note: Rush order');
check('Row 2: Widget B (no sub-row follows)', tableData.body[2][0] === 'Widget B');
check('Row 3: Service C', tableData.body[3][0] === 'Service C');
check('Row 4: sub-row with notes', tableData.body[4][0] === '  Note: Monthly retainer');
check('Row 5: Total footer', tableData.body[5][0] === 'Total');
check('Footer start index is 5', tableData.footerStartIndex === 5);

// --- Test with NO sub-rows matching ---

const lineItemsNoNotes = [
  { description: 'Item X', qty: 1, amount: 50, notes: '' },
  { description: 'Item Y', qty: 2, amount: 100, notes: null },
];

const tableDataNoSub = resolveLineItemsTableData(lineItemsNoNotes, schema);
// Should be: 2 primary rows + 0 sub-rows + 1 footer = 3
check('No matching sub-rows: body has 3 rows', tableDataNoSub.body.length === 3);
check('No matching: Row 0 is Item X', tableDataNoSub.body[0][0] === 'Item X');
check('No matching: Row 1 is Item Y', tableDataNoSub.body[1][0] === 'Item Y');
check('No matching: Row 2 is Total', tableDataNoSub.body[2][0] === 'Total');

// --- Test with ALL items having sub-rows ---

const lineItemsAllNotes = [
  { description: 'A', qty: 1, amount: 10, notes: 'Note A' },
  { description: 'B', qty: 2, amount: 20, notes: 'Note B' },
];

const tableDataAllSub = resolveLineItemsTableData(lineItemsAllNotes, schema);
// Should be: 2 primary + 2 sub-rows + 1 footer = 5
check('All sub-rows match: body has 5 rows', tableDataAllSub.body.length === 5);
check('All sub: Row 0 is A', tableDataAllSub.body[0][0] === 'A');
check('All sub: Row 1 is sub-row A', tableDataAllSub.body[1][0] === '  Note: Note A');
check('All sub: Row 2 is B', tableDataAllSub.body[2][0] === 'B');
check('All sub: Row 3 is sub-row B', tableDataAllSub.body[3][0] === '  Note: Note B');
check('All sub: Row 4 is Total', tableDataAllSub.body[4][0] === 'Total');

// --- Test full resolveLineItemsTables with sub-rows ---

const template = {
  basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  schemas: [[{
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 200,
    showHeader: true,
    columns,
    subRows: [{
      id: 'discount-row',
      condition: { type: 'expression', expression: 'discount > 0' },
      cells: { description: '  Discount: {{discount}}%', amount: '-{{discountAmount}}' },
    }],
    footerRows: [],
  }]],
};

const items = [
  { description: 'Product 1', qty: 1, amount: 100, discount: 10, discountAmount: 10 },
  { description: 'Product 2', qty: 2, amount: 200, discount: 0, discountAmount: 0 },
  { description: 'Product 3', qty: 1, amount: 50, discount: 5, discountAmount: 2.5 },
];

const inputs = [{ lineItems: JSON.stringify(items) }];
const resolved = resolveLineItemsTables(template, inputs);
const resolvedBody = JSON.parse(resolved.inputs[0].lineItems);

// Product 1 has discount > 0 -> sub-row
// Product 2 has discount = 0 -> no sub-row
// Product 3 has discount > 0 -> sub-row
// Total: 3 primary + 2 sub-rows = 5
check('Full resolve: 5 rows (3 primary + 2 sub-rows)', resolvedBody.length === 5);
check('Full resolve: Row 0 is Product 1', resolvedBody[0][0] === 'Product 1');
check('Full resolve: Row 1 is discount sub-row', resolvedBody[1][0] === '  Discount: 10%');
check('Full resolve: Row 1 amount shows discount', resolvedBody[1][2] === '-10');
check('Full resolve: Row 2 is Product 2 (no sub-row)', resolvedBody[2][0] === 'Product 2');
check('Full resolve: Row 3 is Product 3', resolvedBody[3][0] === 'Product 3');
check('Full resolve: Row 4 is discount sub-row', resolvedBody[4][0] === '  Discount: 5%');

// Summary
const total = pass + fail;
if (fail === 0) {
  process.exit(0);
} else {
  process.exit(1);
}
