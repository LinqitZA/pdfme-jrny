const erpSchemas = require('../packages/erp-schemas/dist/index');

const results = {
  hasLineItemsTable: typeof erpSchemas.lineItemsTable === 'object',
  hasResolveLineItemsTables: typeof erpSchemas.resolveLineItemsTables === 'function',
  hasGroupedTable: typeof erpSchemas.groupedTable === 'object',
  hasGroupedTableClass: typeof erpSchemas.GroupedTable === 'function',
  litPdf: typeof erpSchemas.lineItemsTable?.pdf === 'function',
  litUi: typeof erpSchemas.lineItemsTable?.ui === 'function',
  gtPdf: typeof erpSchemas.groupedTable?.pdf === 'function',
  gtUi: typeof erpSchemas.groupedTable?.ui === 'function',
};

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
