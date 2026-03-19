/**
 * Feature #423: Implement missing Plugin interface members for Line Items Table and Grouped Table
 *
 * Tests that both lineItemsTable and groupedTable schema plugins implement the full
 * pdfme Plugin interface (pdf, ui, propPanel) and can be used without crashing.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItNDIzIiwib3JnSWQiOiJ0ZXN0LW9yZy00MjMiLCJyb2xlcyI6WyJhZG1pbiJdLCJpYXQiOjE3MTAwMDAwMDAsImV4cCI6MTc0MTYyMjQwMH0';

// Generate JWT for test org
function makeJwt() {
  // Use the dev secret to sign a valid token
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'test-user-423',
    orgId: 'test-org-423',
    roles: ['admin', 'template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', 'pdfme-dev-secret')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const JWT = makeJwt();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(`  PASS: ${message}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${message}\n`);
  }
}

async function fetchApi(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${JWT}`,
    ...options.headers,
  };
  const resp = await fetch(url, { ...options, headers });
  return resp;
}

async function testLineItemsTablePlugin() {
  process.stdout.write('\n=== Line Items Table Plugin Interface ===\n');

  const { lineItemsTable } = require('../packages/erp-schemas/dist/line-items-table');

  // Test type
  assert(lineItemsTable.type === 'lineItemsTable', 'lineItemsTable has type property');

  // Test defaultSchema
  assert(typeof lineItemsTable.defaultSchema === 'object', 'lineItemsTable has defaultSchema');
  assert(lineItemsTable.defaultSchema.type === 'lineItemsTable', 'defaultSchema has correct type');
  assert(lineItemsTable.defaultSchema.position !== undefined, 'defaultSchema has position');
  assert(lineItemsTable.defaultSchema.width > 0, 'defaultSchema has width');
  assert(lineItemsTable.defaultSchema.height > 0, 'defaultSchema has height');
  assert(Array.isArray(lineItemsTable.defaultSchema.columns), 'defaultSchema has columns array');
  assert(lineItemsTable.defaultSchema.columns.length > 0, 'defaultSchema has at least one column');

  // Test pdf function
  assert(typeof lineItemsTable.pdf === 'function', 'lineItemsTable has pdf() function');

  // Test ui function
  assert(typeof lineItemsTable.ui === 'function', 'lineItemsTable has ui() function');

  // Test propPanel
  assert(typeof lineItemsTable.propPanel === 'object', 'lineItemsTable has propPanel object');
  assert(typeof lineItemsTable.propPanel.schema === 'function', 'propPanel has schema function');
  assert(typeof lineItemsTable.propPanel.defaultSchema === 'object', 'propPanel has defaultSchema');
  assert(lineItemsTable.propPanel.defaultSchema.type === 'lineItemsTable', 'propPanel defaultSchema has correct type');

  // Test icon
  assert(typeof lineItemsTable.icon === 'string', 'lineItemsTable has icon string');
  assert(lineItemsTable.icon.includes('<svg'), 'icon is SVG markup');

  // Test propPanel.schema() returns valid form schema
  const panelSchema = lineItemsTable.propPanel.schema();
  assert(typeof panelSchema === 'object', 'propPanel.schema() returns object');
  assert(panelSchema.showHeader !== undefined, 'propPanel schema has showHeader field');
  assert(panelSchema.repeatHeader !== undefined, 'propPanel schema has repeatHeader field');
  assert(panelSchema.alternateRowShading !== undefined, 'propPanel schema has alternateRowShading field');

  // Test backward compatibility - resolve function still available
  assert(typeof lineItemsTable.resolve === 'function', 'lineItemsTable still has resolve() function');
  assert(typeof lineItemsTable.computeFooterRows === 'function', 'lineItemsTable still has computeFooterRows()');
  assert(typeof lineItemsTable.formatNumber === 'function', 'lineItemsTable still has formatNumber()');
  assert(typeof lineItemsTable.evaluateRowCondition === 'function', 'lineItemsTable still has evaluateRowCondition()');
  assert(typeof lineItemsTable.buildSubRowCells === 'function', 'lineItemsTable still has buildSubRowCells()');
  assert(typeof lineItemsTable.resolveTableData === 'function', 'lineItemsTable still has resolveTableData()');
}

async function testGroupedTablePlugin() {
  process.stdout.write('\n=== Grouped Table Plugin Interface ===\n');

  const { groupedTable } = require('../packages/erp-schemas/dist/grouped-table');

  // Test type
  assert(groupedTable.type === 'groupedTable', 'groupedTable has type property');

  // Test defaultSchema
  assert(typeof groupedTable.defaultSchema === 'object', 'groupedTable has defaultSchema');
  assert(groupedTable.defaultSchema.type === 'groupedTable', 'defaultSchema has correct type');
  assert(groupedTable.defaultSchema.position !== undefined, 'defaultSchema has position');
  assert(groupedTable.defaultSchema.width > 0, 'defaultSchema has width');
  assert(groupedTable.defaultSchema.height > 0, 'defaultSchema has height');
  assert(Array.isArray(groupedTable.defaultSchema.columns), 'defaultSchema has columns array');
  assert(groupedTable.defaultSchema.columns.length > 0, 'defaultSchema has at least one column');
  assert(Array.isArray(groupedTable.defaultSchema.groupBy), 'defaultSchema has groupBy array');

  // Test pdf function
  assert(typeof groupedTable.pdf === 'function', 'groupedTable has pdf() function');

  // Test ui function
  assert(typeof groupedTable.ui === 'function', 'groupedTable has ui() function');

  // Test propPanel
  assert(typeof groupedTable.propPanel === 'object', 'groupedTable has propPanel object');
  assert(typeof groupedTable.propPanel.schema === 'function', 'propPanel has schema function');
  assert(typeof groupedTable.propPanel.defaultSchema === 'object', 'propPanel has defaultSchema');
  assert(groupedTable.propPanel.defaultSchema.type === 'groupedTable', 'propPanel defaultSchema has correct type');

  // Test icon
  assert(typeof groupedTable.icon === 'string', 'groupedTable has icon string');
  assert(groupedTable.icon.includes('<svg'), 'icon is SVG markup');

  // Test propPanel.schema() returns valid form schema
  const panelSchema = groupedTable.propPanel.schema();
  assert(typeof panelSchema === 'object', 'propPanel.schema() returns object');
  assert(panelSchema.showGroupHeaders !== undefined, 'propPanel schema has showGroupHeaders field');
  assert(panelSchema.showGroupFooters !== undefined, 'propPanel schema has showGroupFooters field');
  assert(panelSchema.showGrandTotal !== undefined, 'propPanel schema has showGrandTotal field');
  assert(panelSchema.alternateRowShading !== undefined, 'propPanel schema has alternateRowShading field');

  // Test backward compatibility - GroupedTable class still available
  assert(typeof groupedTable.GroupedTable === 'function', 'groupedTable still has GroupedTable class');

  // Test GroupedTable class works
  const GT = groupedTable.GroupedTable;
  const gt = new GT({
    columns: [
      { key: 'cat', header: 'Category', width: 60 },
      { key: 'val', header: 'Value', width: 40, aggregation: 'SUM' },
    ],
    groupBy: ['cat'],
    data: [
      { cat: 'A', val: 10 },
      { cat: 'A', val: 20 },
      { cat: 'B', val: 30 },
    ],
  });
  const rendered = gt.render();
  assert(Array.isArray(rendered), 'GroupedTable.render() returns array');
  assert(rendered.length > 0, 'GroupedTable.render() returns rows');
  const tableInput = gt.toPdfmeTableInput();
  assert(Array.isArray(tableInput), 'GroupedTable.toPdfmeTableInput() returns array');
}

async function testMainIndexExports() {
  process.stdout.write('\n=== Main Index Exports ===\n');

  const erpSchemas = require('../packages/erp-schemas/dist/index');

  assert(typeof erpSchemas.lineItemsTable === 'object', 'Main index exports lineItemsTable');
  assert(typeof erpSchemas.lineItemsTable.pdf === 'function', 'lineItemsTable.pdf available from main index');
  assert(typeof erpSchemas.lineItemsTable.ui === 'function', 'lineItemsTable.ui available from main index');
  assert(typeof erpSchemas.lineItemsTable.propPanel === 'object', 'lineItemsTable.propPanel available from main index');

  assert(typeof erpSchemas.groupedTable === 'object', 'Main index exports groupedTable');
  assert(typeof erpSchemas.groupedTable.pdf === 'function', 'groupedTable.pdf available from main index');
  assert(typeof erpSchemas.groupedTable.ui === 'function', 'groupedTable.ui available from main index');
  assert(typeof erpSchemas.groupedTable.propPanel === 'object', 'groupedTable.propPanel available from main index');

  assert(typeof erpSchemas.GroupedTable === 'function', 'Main index exports GroupedTable class');
  assert(typeof erpSchemas.resolveLineItemsTables === 'function', 'Main index exports resolveLineItemsTables');
}

async function testRenderWithLineItemsTable() {
  process.stdout.write('\n=== Render with Line Items Table (E2E) ===\n');

  // Create a template with lineItemsTable schema using pages/elements format
  const litElement = {
    name: 'lineItems',
    type: 'lineItemsTable',
    position: { x: 10, y: 30 },
    width: 190,
    height: 100,
    showHeader: true,
    columns: [
      { key: 'description', header: 'Description', width: 80, align: 'left' },
      { key: 'qty', header: 'Qty', width: 30, align: 'right' },
      { key: 'amount', header: 'Amount', width: 80, align: 'right', format: '#,##0.00' },
    ],
  };
  const templateResp = await fetchApi('/api/pdfme/templates', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test LIT Plugin 423',
      type: 'invoice',
      schema: {
        pages: [{ elements: [litElement] }],
      },
    }),
  });
  const template = await templateResp.json();
  assert(templateResp.status === 201, 'Template with lineItemsTable created (201)');
  const templateId = template.data?.id || template.id;

  // Publish the template
  if (templateId) {
    const pubResp = await fetchApi(`/api/pdfme/templates/${templateId}/publish`, {
      method: 'POST',
    });
    assert(pubResp.status === 200 || pubResp.status === 201, 'Template with lineItemsTable published successfully');

    // Render with line items data
    if (pubResp.status === 200 || pubResp.status === 201) {
      const renderResp = await fetchApi('/api/pdfme/render/now', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          entityId: 'inv-423-test',
          channel: 'print',
          inputs: {
            lineItems: JSON.stringify([
              ['Widget A', '5', '250.00'],
              ['Widget B', '10', '500.00'],
            ]),
          },
        }),
      });
      assert(renderResp.status === 200 || renderResp.status === 201, 'Render with lineItemsTable succeeds');
    }

    // Clean up template
    await fetchApi(`/api/pdfme/templates/${templateId}`, { method: 'DELETE' });
  }
}

async function testRenderWithGroupedTable() {
  process.stdout.write('\n=== Render with Grouped Table (E2E) ===\n');

  // Test grouped table render endpoint
  const gtResp = await fetchApi('/api/pdfme/grouped-table/render', {
    method: 'POST',
    body: JSON.stringify({
      columns: [
        { key: 'category', header: 'Category', width: 60 },
        { key: 'item', header: 'Item', width: 80 },
        { key: 'amount', header: 'Amount', width: 50, aggregation: 'SUM', format: '#,##0.00' },
      ],
      groupBy: ['category'],
      data: [
        { category: 'Electronics', item: 'Laptop', amount: 1500 },
        { category: 'Electronics', item: 'Phone', amount: 800 },
        { category: 'Office', item: 'Desk', amount: 300 },
      ],
    }),
  });

  if (gtResp.status === 200 || gtResp.status === 201) {
    const gtData = await gtResp.json();
    assert(true, `Grouped table render endpoint returns ${gtResp.status}`);
    assert(gtData.rows !== undefined || gtData.data !== undefined, 'Grouped table response has rows/data');
  } else {
    assert(false, `Grouped table render returned ${gtResp.status}`);
  }
}

async function testPluginInterfaceCompleteness() {
  process.stdout.write('\n=== Plugin Interface Completeness ===\n');

  const { lineItemsTable } = require('../packages/erp-schemas/dist/line-items-table');
  const { groupedTable } = require('../packages/erp-schemas/dist/grouped-table');

  // The pdfme Plugin interface requires: pdf, ui, propPanel
  // Optional: icon, uninterruptedEditMode
  const requiredMembers = ['pdf', 'ui', 'propPanel'];

  for (const member of requiredMembers) {
    assert(lineItemsTable[member] !== undefined, `lineItemsTable has required member: ${member}`);
    assert(groupedTable[member] !== undefined, `groupedTable has required member: ${member}`);
  }

  // propPanel must have defaultSchema
  assert(lineItemsTable.propPanel.defaultSchema !== undefined, 'lineItemsTable propPanel has defaultSchema');
  assert(groupedTable.propPanel.defaultSchema !== undefined, 'groupedTable propPanel has defaultSchema');

  // propPanel.schema must be a function or object
  assert(
    typeof lineItemsTable.propPanel.schema === 'function' || typeof lineItemsTable.propPanel.schema === 'object',
    'lineItemsTable propPanel.schema is function or object'
  );
  assert(
    typeof groupedTable.propPanel.schema === 'function' || typeof groupedTable.propPanel.schema === 'object',
    'groupedTable propPanel.schema is function or object'
  );

  // defaultSchema must have name, type, position, width, height
  for (const plugin of [
    { name: 'lineItemsTable', schema: lineItemsTable.propPanel.defaultSchema },
    { name: 'groupedTable', schema: groupedTable.propPanel.defaultSchema },
  ]) {
    assert(typeof plugin.schema.type === 'string', `${plugin.name} propPanel.defaultSchema has type`);
    assert(typeof plugin.schema.position === 'object', `${plugin.name} propPanel.defaultSchema has position`);
    assert(typeof plugin.schema.width === 'number', `${plugin.name} propPanel.defaultSchema has width`);
    assert(typeof plugin.schema.height === 'number', `${plugin.name} propPanel.defaultSchema has height`);
  }
}

async function main() {
  process.stdout.write('Feature #423: Plugin Interface for Line Items Table and Grouped Table\n');
  process.stdout.write('=====================================================================\n');

  await testLineItemsTablePlugin();
  await testGroupedTablePlugin();
  await testMainIndexExports();
  await testPluginInterfaceCompleteness();
  await testRenderWithLineItemsTable();
  await testRenderWithGroupedTable();

  process.stdout.write(`\n=====================================================================\n`);
  process.stdout.write(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`Test error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
