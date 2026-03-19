const { lineItemsTable } = require('../packages/erp-schemas/dist/line-items-table');
const { groupedTable } = require('../packages/erp-schemas/dist/grouped-table');

const results = {
  lineItemsTable: {
    keys: Object.keys(lineItemsTable),
    hasPdf: typeof lineItemsTable.pdf === 'function',
    hasUi: typeof lineItemsTable.ui === 'function',
    hasPropPanel: typeof lineItemsTable.propPanel === 'object',
    hasDefaultSchema: typeof lineItemsTable.propPanel?.defaultSchema === 'object',
    hasIcon: typeof lineItemsTable.icon === 'string',
    type: lineItemsTable.type,
  },
  groupedTable: {
    keys: Object.keys(groupedTable),
    hasPdf: typeof groupedTable.pdf === 'function',
    hasUi: typeof groupedTable.ui === 'function',
    hasPropPanel: typeof groupedTable.propPanel === 'object',
    hasDefaultSchema: typeof groupedTable.propPanel?.defaultSchema === 'object',
    hasIcon: typeof groupedTable.icon === 'string',
    type: groupedTable.type,
    hasGroupedTableClass: typeof groupedTable.GroupedTable === 'function',
  },
};

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
