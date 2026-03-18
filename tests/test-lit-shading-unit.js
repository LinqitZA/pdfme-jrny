/**
 * Unit test for Line Items Table alternating group shading
 * Feature #119: Alternating row groups have shading
 */

require('@swc/register');

const { resolveLineItemsTables } = require('../packages/erp-schemas/src/line-items-table/index.ts');

let pass = 0;
let fail = 0;

function check(desc, condition) {
  if (condition) { pass++; }
  else { fail++; }
}

const lineItems = [
  { description: 'Item A', qty: 2, amount: 20 },
  { description: 'Item B', qty: 3, amount: 45 },
  { description: 'Item C', qty: 1, amount: 100 },
  { description: 'Item D', qty: 5, amount: 40 },
  { description: 'Item E', qty: 10, amount: 50 },
  { description: 'Item F', qty: 1, amount: 200 },
];

const columns = [
  { key: 'description', header: 'Description', width: 80, align: 'left' },
  { key: 'qty', header: 'Qty', width: 25, align: 'right' },
  { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' },
];

// Test 1: alternateRowShading = true
const templateWithShading = {
  basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  schemas: [[{
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 200,
    showHeader: true,
    alternateRowShading: true,
    alternateRowColor: '#f0f4ff',
    columns,
    footerRows: [],
  }]],
};

const inputs1 = [{ lineItems: JSON.stringify(lineItems) }];
const result1 = resolveLineItemsTables(templateWithShading, inputs1);
const schema1 = result1.template.schemas[0][0];

check('With shading: type is table', schema1.type === 'table');
check('With shading: alternateBackgroundColor is #f0f4ff',
  schema1.bodyStyles.alternateBackgroundColor === '#f0f4ff');

// Test 2: alternateRowShading = false
const templateNoShading = {
  basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  schemas: [[{
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 200,
    showHeader: true,
    alternateRowShading: false,
    columns,
    footerRows: [],
  }]],
};

const inputs2 = [{ lineItems: JSON.stringify(lineItems) }];
const result2 = resolveLineItemsTables(templateNoShading, inputs2);
const schema2 = result2.template.schemas[0][0];

check('Without shading: type is table', schema2.type === 'table');
check('Without shading: alternateBackgroundColor is empty',
  schema2.bodyStyles.alternateBackgroundColor === '');

// Test 3: default alternateRowColor when shading is true but no color specified
const templateDefaultColor = {
  basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
  schemas: [[{
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 200,
    showHeader: true,
    alternateRowShading: true,
    columns,
    footerRows: [],
  }]],
};

const inputs3 = [{ lineItems: JSON.stringify(lineItems) }];
const result3 = resolveLineItemsTables(templateDefaultColor, inputs3);
const schema3 = result3.template.schemas[0][0];

check('Default shading color: uses #f7fafc',
  schema3.bodyStyles.alternateBackgroundColor === '#f7fafc');

// Test 4: Verify 6 body rows are generated correctly
const body1 = JSON.parse(result1.inputs[0].lineItems);
check('6 body rows generated', body1.length === 6);
check('Row 0 is Item A', body1[0][0] === 'Item A');
check('Row 5 is Item F', body1[5][0] === 'Item F');

// Test 5: headWidthPercentages are calculated correctly
const totalWidth = 80 + 25 + 50; // 155
check('headWidthPercentages calculated', schema1.headWidthPercentages.length === 3);
const expectedPct0 = (80 / totalWidth) * 100;
check('First column percentage correct',
  Math.abs(schema1.headWidthPercentages[0] - expectedPct0) < 0.01);

// Summary
const total = pass + fail;
if (fail === 0) {
  process.exit(0);
} else {
  process.exit(1);
}
