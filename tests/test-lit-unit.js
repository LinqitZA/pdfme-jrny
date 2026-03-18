/**
 * Unit test for Line Items Table footer row computation
 * Feature #118: Subtotal/VAT/total footer rows render
 */

// Use ts-node to require TypeScript modules
require('@swc/register');

const {
  computeFooterRows,
  formatNumber,
  resolveLineItemsTableData,
  resolveLineItemsTables,
} = require('../packages/erp-schemas/src/line-items-table/index.ts');

let pass = 0;
let fail = 0;

function check(desc, condition) {
  if (condition) {
    pass++;
  } else {
    fail++;
  }
}

// Test data: 3 line items
const lineItems = [
  { description: 'Widget A', qty: 10, unitPrice: 25.00, amount: 250.00 },
  { description: 'Widget B', qty: 5, unitPrice: 50.00, amount: 250.00 },
  { description: 'Service C', qty: 1, unitPrice: 500.00, amount: 500.00 },
];

const columns = [
  { key: 'description', header: 'Description', width: 80, align: 'left' },
  { key: 'qty', header: 'Qty', width: 25, align: 'right' },
  { key: 'unitPrice', header: 'Unit Price', width: 35, align: 'right', format: '#,##0.00' },
  { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' },
];

const footerRows = [
  {
    id: 'subtotal',
    label: 'Subtotal',
    valueColumnKey: 'amount',
    type: 'sum',
    format: '#,##0.00',
    style: { fontWeight: 'bold' },
  },
  {
    id: 'vat',
    label: 'VAT (15%)',
    valueColumnKey: 'amount',
    type: 'percentage',
    referenceFooterId: 'subtotal',
    percentage: 0.15,
    format: '#,##0.00',
  },
  {
    id: 'total',
    label: 'Total',
    valueColumnKey: 'amount',
    type: 'sumWithFooters',
    footerIds: ['subtotal', 'vat'],
    format: '#,##0.00',
    style: { fontWeight: 'bold', fontSize: 10 },
  },
];

// Test 1: formatNumber
check('formatNumber basic', formatNumber(1000, '#,##0.00') === '1,000.00');
check('formatNumber no format', formatNumber(250).length > 0);
check('formatNumber zero', formatNumber(0, '#,##0.00') === '0.00');
check('formatNumber large', formatNumber(12345.67, '#,##0.00') === '12,345.67');

// Test 2: computeFooterRows - subtotal
const result = computeFooterRows(lineItems, footerRows, columns);
check('Footer has 3 rows', result.cells.length === 3);

// Subtotal row: sum of amounts = 250+250+500 = 1000
const subtotalRow = result.cells[0];
check('Subtotal label in first column', subtotalRow[0] === 'Subtotal');
check('Subtotal value correct (1,000.00)', subtotalRow[3] === '1,000.00');
check('Subtotal empty qty column', subtotalRow[1] === '');
check('Subtotal empty unitPrice column', subtotalRow[2] === '');

// VAT row: 15% of 1000 = 150
const vatRow = result.cells[1];
check('VAT label correct', vatRow[0] === 'VAT (15%)');
check('VAT value correct (150.00)', vatRow[3] === '150.00');

// Total row: subtotal + vat = 1000 + 150 = 1150
const totalRow = result.cells[2];
check('Total label correct', totalRow[0] === 'Total');
check('Total value correct (1,150.00)', totalRow[3] === '1,150.00');

// Test 3: resolveLineItemsTableData
const schema = {
  type: 'lineItemsTable',
  name: 'lineItems',
  position: { x: 10, y: 30 },
  width: 190,
  height: 150,
  showHeader: true,
  columns,
  footerRows,
};

const tableData = resolveLineItemsTableData(lineItems, schema);
check('Head has 1 row', tableData.head.length === 1);
check('Head has correct headers', tableData.head[0][0] === 'Description');
check('Body has 6 rows (3 data + 3 footer)', tableData.body.length === 6);
check('Footer starts at index 3', tableData.footerStartIndex === 3);
check('Body row 0 is Widget A', tableData.body[0][0] === 'Widget A');
check('Body row 3 is Subtotal', tableData.body[3][0] === 'Subtotal');
check('Body row 4 is VAT', tableData.body[4][0] === 'VAT (15%)');
check('Body row 5 is Total', tableData.body[5][0] === 'Total');
check('Total value in body', tableData.body[5][3] === '1,150.00');

// Test 4: resolveLineItemsTables (full template transformation)
const template = {
  basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  schemas: [[{
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 150,
    showHeader: true,
    columns,
    footerRows,
  }]],
};

const inputs = [{ lineItems: JSON.stringify(lineItems) }];
const resolved = resolveLineItemsTables(template, inputs);

// The schema should be converted to type 'table'
const resolvedSchema = resolved.template.schemas[0][0];
check('Schema type converted to table', resolvedSchema.type === 'table');
check('Schema has head headers', resolvedSchema.head.length === 4);
check('Schema has headWidthPercentages', resolvedSchema.headWidthPercentages.length === 4);
check('Schema showHead is true', resolvedSchema.showHead === true);

// The input should be transformed to JSON table body
const resolvedInput = resolved.inputs[0].lineItems;
const parsedBody = JSON.parse(resolvedInput);
check('Resolved input is valid JSON array', Array.isArray(parsedBody));
check('Resolved body has 6 rows', parsedBody.length === 6);
check('Resolved body row 3 is Subtotal', parsedBody[3][0] === 'Subtotal');
check('Resolved body Total = 1,150.00', parsedBody[5][3] === '1,150.00');

// Test 5: Edge cases
// Empty line items
const emptyResult = computeFooterRows([], footerRows, columns);
check('Empty items: subtotal is 0.00', emptyResult.cells[0][3] === '0.00');
check('Empty items: VAT is 0.00', emptyResult.cells[1][3] === '0.00');
check('Empty items: total is 0.00', emptyResult.cells[2][3] === '0.00');

// Single item
const singleItem = [{ description: 'Only Item', qty: 1, unitPrice: 100, amount: 100 }];
const singleResult = computeFooterRows(singleItem, footerRows, columns);
check('Single item: subtotal is 100.00', singleResult.cells[0][3] === '100.00');
check('Single item: VAT is 15.00', singleResult.cells[1][3] === '15.00');
check('Single item: total is 115.00', singleResult.cells[2][3] === '115.00');

// Summary
const total = pass + fail;
if (fail === 0) {
  process.exit(0);
} else {
  process.exit(1);
}
