"use strict";
/**
 * Grouped Table schema plugin
 *
 * Hierarchical report layouts with groupBy (up to 3 levels),
 * group header/footer rows with subtotals, multi-level nesting.
 *
 * Features:
 * - #121: Basic groupBy rendering with group headers
 * - #122: Subtotals per group (SUM, COUNT, AVG, MIN, MAX)
 * - #123: Multi-level nesting (up to 3 levels)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupedTable = exports.GroupedTable = void 0;
/**
 * GroupedTable - Processes tabular data into a hierarchical grouped layout
 * suitable for rendering in reports (aged debtors, sales analysis, stock, etc.)
 */
class GroupedTable {
    config;
    constructor(config) {
        if (!config.groupBy || config.groupBy.length === 0) {
            throw new Error('groupBy must contain at least one field');
        }
        if (config.groupBy.length > 3) {
            throw new Error('Maximum 3 levels of grouping supported');
        }
        this.config = {
            ...config,
            showGroupHeaders: config.showGroupHeaders !== false,
            showGroupFooters: config.showGroupFooters !== false,
            showGrandTotal: config.showGrandTotal !== false,
            alternateRowShading: config.alternateRowShading === true,
        };
    }
    /**
     * Build the hierarchical group tree from flat data.
     */
    buildGroupTree(data) {
        const rows = data || this.config.data;
        return this.groupRecursive(rows, 0);
    }
    /**
     * Recursively group data by the groupBy fields at the specified level.
     */
    groupRecursive(rows, level) {
        if (level >= this.config.groupBy.length) {
            return [];
        }
        const groupField = this.config.groupBy[level];
        const groups = new Map();
        const groupOrder = [];
        for (const row of rows) {
            const value = this.getNestedValue(row, groupField);
            const key = String(value ?? '(blank)');
            if (!groups.has(key)) {
                groups.set(key, []);
                groupOrder.push(key);
            }
            groups.get(key).push(row);
        }
        return groupOrder.map((key) => {
            const groupRows = groups.get(key);
            const children = this.groupRecursive(groupRows, level + 1);
            const subtotals = this.calculateSubtotals(groupRows);
            return {
                key: groupField,
                value: key === '(blank)' ? null : key,
                level,
                rows: groupRows,
                children,
                subtotals,
            };
        });
    }
    /**
     * Calculate subtotals (aggregations) for a set of rows.
     */
    calculateSubtotals(rows) {
        const subtotals = {};
        for (const col of this.config.columns) {
            if (!col.aggregation)
                continue;
            const values = rows
                .map((row) => {
                const v = this.getNestedValue(row, col.key);
                return typeof v === 'number' ? v : parseFloat(String(v));
            })
                .filter((v) => !isNaN(v));
            switch (col.aggregation) {
                case 'SUM':
                    subtotals[col.key] = values.reduce((sum, v) => sum + v, 0);
                    break;
                case 'COUNT':
                    subtotals[col.key] = values.length;
                    break;
                case 'AVG':
                    subtotals[col.key] = values.length > 0
                        ? values.reduce((sum, v) => sum + v, 0) / values.length
                        : 0;
                    break;
                case 'MIN':
                    subtotals[col.key] = values.length > 0 ? Math.min(...values) : 0;
                    break;
                case 'MAX':
                    subtotals[col.key] = values.length > 0 ? Math.max(...values) : 0;
                    break;
            }
        }
        return subtotals;
    }
    /**
     * Render the grouped table into a flat list of RenderedRows.
     * This is the main output method - produces rows that can be drawn into a PDF.
     */
    render() {
        const rows = [];
        const tree = this.buildGroupTree();
        // Column header row
        rows.push({
            type: 'columnHeader',
            cells: this.config.columns.map((col) => ({
                columnKey: col.key,
                value: col.header,
                align: col.align || 'left',
            })),
            style: this.config.headerStyle || { fontWeight: 'bold', borderBottom: '1px solid #000' },
        });
        // Render each top-level group
        for (const group of tree) {
            this.renderGroup(group, rows);
        }
        // Grand total row
        if (this.config.showGrandTotal) {
            const grandTotals = this.calculateSubtotals(this.config.data);
            const hasAggregations = this.config.columns.some((c) => c.aggregation);
            if (hasAggregations) {
                rows.push({
                    type: 'grandTotal',
                    cells: this.config.columns.map((col, i) => {
                        if (i === 0 && !col.aggregation) {
                            return {
                                columnKey: col.key,
                                value: 'Grand Total',
                                align: 'left',
                            };
                        }
                        if (col.aggregation) {
                            return {
                                columnKey: col.key,
                                value: this.formatValue(grandTotals[col.key], col),
                                align: col.align || 'right',
                            };
                        }
                        return {
                            columnKey: col.key,
                            value: '',
                            align: col.align || 'left',
                        };
                    }),
                    style: this.config.grandTotalStyle || {
                        fontWeight: 'bold',
                        borderBottom: '2px solid #000',
                        backgroundColor: '#e0e0e0',
                    },
                });
            }
        }
        return rows;
    }
    /**
     * Render a single group node and its children recursively.
     */
    renderGroup(group, rows) {
        // Group header
        if (this.config.showGroupHeaders) {
            rows.push({
                type: 'groupHeader',
                level: group.level,
                groupKey: group.key,
                groupValue: group.value,
                cells: [{
                        columnKey: '__group__',
                        value: `${group.value ?? '(blank)'}`,
                        align: 'left',
                        colSpan: this.config.columns.length,
                    }],
                style: {
                    fontWeight: 'bold',
                    backgroundColor: this.getGroupHeaderColor(group.level),
                    ...(this.config.groupHeaderStyle || {}),
                },
            });
        }
        // If this group has children (sub-groups), render them
        if (group.children.length > 0) {
            for (const child of group.children) {
                this.renderGroup(child, rows);
            }
        }
        else {
            // Leaf level - render data rows
            let rowIndex = 0;
            for (const dataRow of group.rows) {
                const bgColor = this.config.alternateRowShading && rowIndex % 2 === 1
                    ? '#f9f9f9'
                    : undefined;
                rows.push({
                    type: 'data',
                    level: group.level,
                    cells: this.config.columns.map((col) => ({
                        columnKey: col.key,
                        value: this.formatValue(this.getNestedValue(dataRow, col.key), col),
                        align: col.align || 'left',
                    })),
                    style: {
                        ...(this.config.rowStyle || {}),
                        ...(bgColor ? { backgroundColor: bgColor } : {}),
                    },
                });
                rowIndex++;
            }
        }
        // Group footer with subtotals
        if (this.config.showGroupFooters) {
            const hasAggregations = this.config.columns.some((c) => c.aggregation);
            if (hasAggregations) {
                rows.push({
                    type: 'groupFooter',
                    level: group.level,
                    groupKey: group.key,
                    groupValue: group.value,
                    cells: this.config.columns.map((col, i) => {
                        if (i === 0 && !col.aggregation) {
                            return {
                                columnKey: col.key,
                                value: `Subtotal: ${group.value ?? '(blank)'}`,
                                align: 'left',
                            };
                        }
                        if (col.aggregation) {
                            return {
                                columnKey: col.key,
                                value: this.formatValue(group.subtotals[col.key], col),
                                align: col.align || 'right',
                            };
                        }
                        return {
                            columnKey: col.key,
                            value: '',
                            align: col.align || 'left',
                        };
                    }),
                    style: {
                        fontWeight: 'bold',
                        borderBottom: '1px solid #999',
                        ...(this.config.groupFooterStyle || {}),
                    },
                });
            }
        }
    }
    /**
     * Get a color for group headers based on nesting level.
     */
    getGroupHeaderColor(level) {
        const colors = ['#d0d0d0', '#e0e0e0', '#f0f0f0'];
        return colors[Math.min(level, colors.length - 1)];
    }
    /**
     * Format a value for display, using column format if specified.
     */
    formatValue(value, col) {
        if (value === null || value === undefined)
            return '';
        if (typeof value === 'number' && col.format) {
            return this.formatNumber(value, col.format);
        }
        if (typeof value === 'number') {
            // If the column has aggregation, show 2 decimal places by default
            if (col.aggregation) {
                return value.toFixed(2);
            }
            return String(value);
        }
        return String(value);
    }
    /**
     * Format a number using a pattern like '#,##0.00'.
     */
    formatNumber(value, pattern) {
        const patternParts = pattern.split('.');
        const decPattern = patternParts.length > 1 ? patternParts[1] : '';
        const intPattern = patternParts[0];
        const decimalPlaces = decPattern.length;
        const absValue = Math.abs(value);
        const rounded = decimalPlaces > 0 ? absValue.toFixed(decimalPlaces) : Math.round(absValue).toString();
        const [intPart, decPart] = rounded.split('.');
        let formattedInt = intPart;
        if (intPattern.includes(',')) {
            formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
        let result = formattedInt;
        if (decPart !== undefined) {
            result += '.' + decPart;
        }
        if (value < 0) {
            result = '-' + result;
        }
        return result;
    }
    /**
     * Get a nested value from an object using dot notation.
     */
    getNestedValue(obj, key) {
        const parts = key.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined)
                return undefined;
            if (typeof current === 'object' && current !== null) {
                current = current[part];
            }
            else {
                return undefined;
            }
        }
        return current;
    }
    /**
     * Convert the rendered rows to a pdfme-compatible table input structure.
     * This generates the text content for a pdfme table plugin field.
     * Each row must have exactly the same number of cells as columns.
     */
    toPdfmeTableInput() {
        const rendered = this.render();
        const colCount = this.config.columns.length;
        return rendered.map((row) => {
            // If the row has a colSpan cell (groupHeader), pad to match column count
            if (row.cells.length === 1 && row.cells[0].colSpan && row.cells[0].colSpan > 1) {
                const result = [row.cells[0].value];
                for (let i = 1; i < colCount; i++) {
                    result.push('');
                }
                return result;
            }
            // Standard row - ensure all cells present
            const cells = row.cells.map((cell) => cell.value);
            while (cells.length < colCount) {
                cells.push('');
            }
            return cells;
        });
    }
    /**
     * Get summary statistics about the grouped data.
     */
    getSummary() {
        const tree = this.buildGroupTree();
        const grandTotals = this.calculateSubtotals(this.config.data);
        const groupCounts = {};
        const countGroups = (nodes, level) => {
            const key = this.config.groupBy[level];
            groupCounts[key] = (groupCounts[key] || 0) + nodes.length;
            for (const node of nodes) {
                if (node.children.length > 0) {
                    countGroups(node.children, level + 1);
                }
            }
        };
        countGroups(tree, 0);
        return {
            totalRows: this.config.data.length,
            groupLevels: this.config.groupBy.length,
            groupCounts,
            grandTotals,
        };
    }
}
exports.GroupedTable = GroupedTable;
const ui_1 = require("./ui");
const pdf_1 = require("./pdf");
const propPanel_1 = require("./propPanel");
/**
 * Grouped Table icon - layered table SVG
 */
const GROUPED_TABLE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/><rect x="5" y="5" width="4" height="2" rx="0.5" fill="currentColor" opacity="0.3"/></svg>';
/**
 * The groupedTable plugin definition.
 *
 * Implements the full pdfme Plugin interface with type, defaultSchema,
 * pdf(), ui(), propPanel, and icon. Also provides the GroupedTable class
 * for backward compatibility with existing code that uses it directly.
 */
exports.groupedTable = {
    /**
     * Type identifier for this schema
     */
    type: 'groupedTable',
    /**
     * Default properties for a new groupedTable element
     */
    defaultSchema: {
        type: 'groupedTable',
        content: '[]',
        position: { x: 10, y: 60 },
        width: 190,
        height: 150,
        columns: [
            { key: 'category', header: 'Category', width: 60, align: 'left' },
            { key: 'item', header: 'Item', width: 80, align: 'left' },
            { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00', aggregation: 'SUM' },
        ],
        groupBy: ['category'],
        showGroupHeaders: true,
        showGroupFooters: true,
        showGrandTotal: true,
        alternateRowShading: false,
        headerStyle: {
            fontWeight: 'bold',
            borderBottom: '1px solid #000',
        },
        groupHeaderStyle: {
            backgroundColor: '#d0d0d0',
            fontWeight: 'bold',
        },
        groupFooterStyle: {
            fontWeight: 'bold',
            borderBottom: '1px solid #999',
        },
        grandTotalStyle: {
            fontWeight: 'bold',
            borderBottom: '2px solid #000',
            backgroundColor: '#e0e0e0',
        },
    },
    /**
     * PDF renderer - renders a grouped table to the PDF page.
     */
    pdf: pdf_1.pdfRender,
    /**
     * UI renderer - renders a visual grouped table preview on the designer canvas.
     */
    ui: ui_1.uiRender,
    /**
     * Property panel - configures the property editor in the designer sidebar.
     */
    propPanel: propPanel_1.propPanel,
    /**
     * Icon for the element palette.
     */
    icon: GROUPED_TABLE_ICON,
    /**
     * The GroupedTable class for programmatic use (backward compatible).
     */
    GroupedTable,
};
//# sourceMappingURL=index.js.map