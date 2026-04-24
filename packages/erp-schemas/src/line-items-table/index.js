"use strict";
/**
 * Line Items Table schema plugin
 *
 * Dynamic table with configurable columns, automatic page break with header repeat,
 * multi-row groups, alternating group shading, footer rows, maxRowsPerPage, colSpan support.
 *
 * This plugin works as a pre-processor: it transforms lineItemsTable schema elements
 * and their associated input data into pdfme-compatible table data. The render service
 * calls resolveLineItemsTable() before passing the template to pdfme generate().
 *
 * Footer rows (subtotal, VAT, total) are appended to the table body data and styled
 * with bold text and top borders to visually distinguish them from regular rows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineItemsTable = void 0;
exports.evaluateRowCondition = evaluateRowCondition;
exports.buildSubRowCells = buildSubRowCells;
exports.computeFooterRows = computeFooterRows;
exports.formatNumber = formatNumber;
exports.resolveLineItemsTableData = resolveLineItemsTableData;
exports.resolveLineItemsTables = resolveLineItemsTables;
/**
 * Evaluate whether a RowCondition is met for a given line item.
 *
 * @param condition - The condition to evaluate
 * @param item - The line item data record
 * @returns true if the condition is met
 */
function evaluateRowCondition(condition, item) {
    switch (condition.type) {
        case 'fieldNonEmpty': {
            if (!condition.field)
                return false;
            const val = item[condition.field];
            if (val === null || val === undefined)
                return false;
            if (typeof val === 'string' && val.trim() === '')
                return false;
            return true;
        }
        case 'expression': {
            if (!condition.expression)
                return false;
            // Simple expression evaluation for common patterns
            // Supports: field > 0, field != '', field == 'value'
            const expr = condition.expression.trim();
            // Try field reference comparison: field.key > 0
            const compMatch = expr.match(/^([a-zA-Z0-9_.]+)\s*(>|<|>=|<=|==|!=)\s*(.+)$/);
            if (compMatch) {
                const [, fieldKey, op, rawRight] = compMatch;
                const leftVal = item[fieldKey];
                const rightStr = rawRight.trim().replace(/^['"]|['"]$/g, '');
                const leftNum = typeof leftVal === 'number' ? leftVal : parseFloat(String(leftVal || '0'));
                const rightNum = parseFloat(rightStr);
                if (!isNaN(leftNum) && !isNaN(rightNum)) {
                    switch (op) {
                        case '>': return leftNum > rightNum;
                        case '<': return leftNum < rightNum;
                        case '>=': return leftNum >= rightNum;
                        case '<=': return leftNum <= rightNum;
                        case '==': return leftNum === rightNum;
                        case '!=': return leftNum !== rightNum;
                    }
                }
                // String comparison
                const leftStr = String(leftVal || '');
                switch (op) {
                    case '==': return leftStr === rightStr;
                    case '!=': return leftStr !== rightStr;
                    default: return false;
                }
            }
            // Simple truthy check: just a field name
            const val = item[expr];
            return val !== null && val !== undefined && val !== '' && val !== 0;
        }
        default:
            return false;
    }
}
/**
 * Build a sub-row cell array for a given line item, using the sub-row config.
 *
 * @param item - The line item data record
 * @param subRow - The sub-row configuration
 * @param columns - The column definitions
 * @returns Array of cell strings for this sub-row
 */
function buildSubRowCells(item, subRow, columns) {
    const cells = [];
    for (const col of columns) {
        const cellTemplate = subRow.cells[col.key];
        if (cellTemplate) {
            // Resolve {{field.key}} bindings in the cell content
            const resolved = cellTemplate.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
                const val = item[key.trim()];
                if (val === null || val === undefined)
                    return '';
                return String(val);
            });
            cells.push(resolved);
        }
        else {
            cells.push('');
        }
    }
    return cells;
}
/**
 * Compute footer row values based on the line items data and footer config.
 *
 * @param lineItems - Array of line item data records
 * @param footerRows - Footer row configurations
 * @param columns - Column definitions
 * @returns Array of footer row cell arrays (each row is string[])
 */
function computeFooterRows(lineItems, footerRows, columns) {
    const computedValues = new Map();
    const resultCells = [];
    const resultStyles = [];
    for (const footer of footerRows) {
        let value = 0;
        switch (footer.type) {
            case 'sum': {
                // Sum all values in the specified column across line items
                value = lineItems.reduce((acc, item) => {
                    const cellVal = item[footer.valueColumnKey];
                    const num = typeof cellVal === 'number' ? cellVal : parseFloat(String(cellVal || '0'));
                    return acc + (isNaN(num) ? 0 : num);
                }, 0);
                break;
            }
            case 'percentage': {
                // Calculate percentage of a referenced footer row's value
                const refValue = computedValues.get(footer.referenceFooterId || '');
                if (refValue !== undefined && footer.percentage !== undefined) {
                    value = refValue * footer.percentage;
                }
                break;
            }
            case 'sumWithFooters': {
                // Sum values from referenced footer rows
                if (footer.footerIds) {
                    value = footer.footerIds.reduce((acc, fid) => {
                        const fv = computedValues.get(fid);
                        return acc + (fv !== undefined ? fv : 0);
                    }, 0);
                }
                break;
            }
            case 'expression': {
                // For now, treat expression as static — expression engine integration
                // can be added later when ExpressionEngine is available at render time
                value = 0;
                break;
            }
            case 'static': {
                // Value will be taken from inputs directly, not computed here
                value = 0;
                break;
            }
        }
        // Store computed value for potential reference by subsequent footer rows
        computedValues.set(footer.id, value);
        // Build the cell array for this footer row
        const cells = [];
        const labelColKey = footer.labelColumnKey || (columns.length > 0 ? columns[0].key : '');
        const labelColSpan = footer.labelColSpan || 1;
        // Track which columns are consumed by colSpan
        const consumedCols = new Set();
        for (let i = 0; i < columns.length; i++) {
            if (consumedCols.has(i)) {
                // Skip columns consumed by a previous colSpan — add empty string
                cells.push('');
                continue;
            }
            const col = columns[i];
            if (col.key === labelColKey) {
                cells.push(footer.label);
                // Mark subsequent columns as consumed by colSpan
                for (let s = 1; s < labelColSpan && (i + s) < columns.length; s++) {
                    consumedCols.add(i + s);
                }
            }
            else if (col.key === footer.valueColumnKey) {
                cells.push(formatNumber(value, footer.format));
            }
            else {
                cells.push('');
            }
        }
        resultCells.push(cells);
        resultStyles.push(footer.style);
    }
    return { cells: resultCells, styles: resultStyles };
}
/**
 * Format a number value with optional format string.
 *
 * Supported format patterns:
 * - Number:     '#,##0', '#,##0.00', '#,##0.000', '0', '0.00'
 * - Currency:   'R #,##0.00', '$ #,##0.00', '€ #,##0.00' (prefix before number pattern)
 * - Percentage: '0%', '0.0%', '0.00%' (appends % suffix)
 * - Date:       'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY' (passthrough for string values)
 */
function formatNumber(value, format) {
    if (!format) {
        // Default: 2 decimal places
        return value.toFixed(2);
    }
    // Check for percentage suffix
    const isPercentage = format.endsWith('%');
    let numberFormat = isPercentage ? format.slice(0, -1) : format;
    // Extract prefix (everything before the first '#' or '0')
    let prefix = '';
    const firstFormatChar = numberFormat.search(/[#0]/);
    if (firstFormatChar > 0) {
        prefix = numberFormat.slice(0, firstFormatChar);
        numberFormat = numberFormat.slice(firstFormatChar);
    } else if (firstFormatChar < 0) {
        // No numeric format characters found — return raw value with 2 decimals
        return value.toFixed(2);
    }
    // Count decimal places from the number-pattern portion
    const dotIdx = numberFormat.indexOf('.');
    let decimals = 0;
    if (dotIdx >= 0) {
        decimals = numberFormat.length - dotIdx - 1;
    }
    // Check for thousand separator in number-pattern
    const hasThousandSep = numberFormat.includes(',');
    // Handle negative values: format the absolute value, prepend minus to prefix
    const isNegative = value < 0;
    let result = Math.abs(value).toFixed(decimals);
    if (hasThousandSep) {
        const parts = result.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        result = parts.join('.');
    }
    const sign = isNegative ? '-' : '';
    return sign + prefix + result + (isPercentage ? '%' : '');
}
/**
 * Convert line items data and schema into pdfme-compatible table body data
 * with footer rows appended.
 *
 * @param lineItems - Array of line item records
 * @param schema - The lineItemsTable schema configuration
 * @returns Object with body (string[][]), head (string[][]), and footer info
 */
function resolveLineItemsTableData(lineItems, schema) {
    const columns = schema.columns || [];
    // Build header row
    const head = [];
    if (schema.showHeader !== false) {
        head.push(columns.map((col) => col.header));
    }
    // Build body rows from line items, with conditional sub-rows
    const bodyRows = [];
    const subRowConfigs = schema.subRows || [];
    for (const item of lineItems) {
        // Primary row
        const primaryRow = columns.map((col) => {
            const val = item[col.key];
            if (val === null || val === undefined)
                return '';
            if (typeof val === 'number' && col.format) {
                return formatNumber(val, col.format);
            }
            return String(val);
        });
        bodyRows.push(primaryRow);
        // Conditional sub-rows: evaluate each sub-row config against this item
        for (const subRow of subRowConfigs) {
            if (evaluateRowCondition(subRow.condition, item)) {
                const subRowCells = buildSubRowCells(item, subRow, columns);
                bodyRows.push(subRowCells);
            }
        }
    }
    // Compute and append footer rows
    const footerStartIndex = bodyRows.length;
    const footerRows = schema.footerRows || [];
    if (footerRows.length > 0) {
        const { cells: footerCells } = computeFooterRows(lineItems, footerRows, columns);
        bodyRows.push(...footerCells);
    }
    return {
        head,
        body: bodyRows,
        footerStartIndex,
        columns,
    };
}
/**
 * Pre-process a pdfme template to resolve lineItemsTable elements.
 * Converts lineItemsTable schemas into standard table schemas with footer rows
 * included in the body data.
 *
 * This should be called by the render service before passing to pdfme generate().
 *
 * @param pdfmeTemplate - The pdfme template object
 * @param inputs - The input data records
 * @returns Modified template and inputs with lineItemsTable resolved to table
 */
/**
 * Build a pdfme table schema object from a lineItemsTable schema and column definitions.
 */
function buildTableSchema(litSchema, columns, footerStartIndex) {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || litSchema.width;
    const headWidthPercentages = columns.map((c) => (c.width / totalWidth) * 100);
    const columnAlignment = {};
    columns.forEach((col, idx) => {
        if (col.align) {
            columnAlignment[idx] = col.align;
        }
    });
    const footerRows = litSchema.footerRows || [];
    return {
        type: 'table',
        position: litSchema.position,
        width: litSchema.width,
        height: litSchema.height,
        showHead: litSchema.showHeader !== false,
        head: columns.map((c) => c.header),
        headWidthPercentages,
        repeatHead: litSchema.repeatHeader !== false,
        tableStyles: {
            borderColor: '#000000',
            borderWidth: 0.5,
        },
        headStyles: {
            fontName: undefined,
            alignment: 'left',
            verticalAlignment: 'middle',
            fontSize: litSchema.headerStyle?.fontSize || 9,
            lineHeight: 1.2,
            characterSpacing: 0,
            fontColor: '#ffffff',
            backgroundColor: litSchema.headerStyle?.backgroundColor || '#2d3748',
            borderColor: '#000000',
            borderWidth: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
            padding: { top: 4, right: 4, bottom: 4, left: 4 },
        },
        bodyStyles: {
            fontName: undefined,
            alignment: 'left',
            verticalAlignment: 'middle',
            fontSize: litSchema.bodyStyle?.fontSize || 8,
            lineHeight: 1.2,
            characterSpacing: 0,
            fontColor: '#000000',
            backgroundColor: '#ffffff',
            borderColor: '#cccccc',
            borderWidth: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 },
            padding: { top: 3, right: 4, bottom: 3, left: 4 },
            alternateBackgroundColor: litSchema.alternateRowShading ? (litSchema.alternateRowColor || '#f7fafc') : '',
        },
        columnStyles: {
            alignment: columnAlignment,
        },
        __footerStartIndex: footerStartIndex,
        __footerCount: footerRows.length,
    };
}
/**
 * Get the max rows for a given page index from MaxRowsPerPage config.
 */
function getMaxRowsForPage(config, pageIndex, totalPages) {
    if (typeof config === 'number')
        return config;
    if (pageIndex === 0)
        return config.first;
    if (pageIndex === totalPages - 1)
        return config.last;
    return config.middle;
}
function resolveLineItemsTables(pdfmeTemplate, inputs) {
    // Collect extra pages created by maxRowsPerPage splitting
    const extraPages = [];
    const extraInputKeys = [];
    const newSchemas = pdfmeTemplate.schemas.map((page) => {
        if (!Array.isArray(page))
            return page;
        return page.map((field) => {
            if (!field || typeof field !== 'object')
                return field;
            if (field.type !== 'lineItemsTable')
                return field;
            const litSchema = field;
            const fieldName = litSchema.name;
            // Parse line items from the first input that has this field
            let lineItems = [];
            for (const input of inputs) {
                if (input[fieldName]) {
                    try {
                        lineItems = JSON.parse(input[fieldName]);
                    }
                    catch {
                        lineItems = [];
                    }
                    break;
                }
            }
            // Resolve the table data (body rows + footer rows)
            const resolved = resolveLineItemsTableData(lineItems, litSchema);
            const columns = resolved.columns;
            // Check for maxRowsPerPage: split data across multiple pages if needed
            if (litSchema.maxRowsPerPage && resolved.body.length > 0) {
                const maxRows = litSchema.maxRowsPerPage;
                // Only split the data rows (before footer), keep footer on last page
                const dataRows = resolved.body.slice(0, resolved.footerStartIndex);
                const footerRowsData = resolved.body.slice(resolved.footerStartIndex);
                // Calculate number of pages needed
                const firstPageMax = typeof maxRows === 'number' ? maxRows : maxRows.first;
                const middlePageMax = typeof maxRows === 'number' ? maxRows : maxRows.middle;
                const lastPageMax = typeof maxRows === 'number' ? maxRows : maxRows.last;
                // Chunk the data rows (first pass: use first/middle limits)
                const chunks = [];
                let remaining = dataRows;
                let pageIdx = 0;
                while (remaining.length > 0) {
                    const limit = pageIdx === 0 ? firstPageMax : middlePageMax;
                    chunks.push(remaining.slice(0, limit));
                    remaining = remaining.slice(limit);
                    pageIdx++;
                }
                // Second pass: enforce last page limit if different from middle
                // If the last chunk exceeds lastPageMax, redistribute rows
                if (chunks.length > 1 && typeof maxRows !== 'number' && lastPageMax !== middlePageMax) {
                    const lastChunk = chunks[chunks.length - 1];
                    if (lastChunk.length > lastPageMax) {
                        // Move excess rows from last chunk to a new penultimate chunk
                        const excess = lastChunk.length - lastPageMax;
                        const spillOver = lastChunk.splice(0, excess);
                        // Insert the spill-over before the last chunk
                        chunks.splice(chunks.length - 1, 0, spillOver);
                    }
                }
                // If we have footer rows, append them to the last chunk
                if (footerRowsData.length > 0 && chunks.length > 0) {
                    chunks[chunks.length - 1].push(...footerRowsData);
                }
                if (chunks.length <= 1) {
                    // No splitting needed — single page
                    const tableBody = JSON.stringify(resolved.body);
                    for (const input of inputs) {
                        input[fieldName] = tableBody;
                    }
                    return { name: fieldName, ...buildTableSchema(litSchema, columns, resolved.footerStartIndex) };
                }
                // Multiple pages: first chunk goes on current page
                const firstChunkBody = JSON.stringify(chunks[0]);
                for (const input of inputs) {
                    input[fieldName] = firstChunkBody;
                }
                // Additional chunks: create extra pages
                for (let ci = 1; ci < chunks.length; ci++) {
                    const chunkFieldName = `${fieldName}__page${ci + 1}`;
                    const isLastChunk = ci === chunks.length - 1;
                    const footerStart = isLastChunk ? chunks[ci].length - footerRowsData.length : chunks[ci].length;
                    const pageTableSchema = {
                        name: chunkFieldName,
                        ...buildTableSchema(litSchema, columns, footerStart),
                    };
                    extraPages.push([pageTableSchema]);
                    extraInputKeys.push({
                        fieldName: chunkFieldName,
                        pageIndex: ci,
                        body: JSON.stringify(chunks[ci]),
                    });
                }
                return { name: fieldName, ...buildTableSchema(litSchema, columns, chunks[0].length) };
            }
            // No maxRowsPerPage — single table with all data
            const tableBody = JSON.stringify(resolved.body);
            for (const input of inputs) {
                input[fieldName] = tableBody;
            }
            return { name: fieldName, ...buildTableSchema(litSchema, columns, resolved.footerStartIndex) };
        });
    });
    // Add extra page inputs
    for (const extra of extraInputKeys) {
        for (const input of inputs) {
            input[extra.fieldName] = extra.body;
        }
    }
    // Combine original pages with extra pages from maxRowsPerPage splitting
    const allSchemas = [...newSchemas, ...extraPages];
    return {
        template: { basePdf: pdfmeTemplate.basePdf, schemas: allSchemas },
        inputs,
    };
}
const ui_1 = require("./ui");
const pdf_1 = require("./pdf");
const propPanel_1 = require("./propPanel");
/**
 * Line Items Table icon - table grid SVG
 */
const LINE_ITEMS_TABLE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>';
/**
 * The lineItemsTable plugin definition.
 *
 * Implements the full pdfme Plugin interface with pdf(), ui(), and propPanel
 * members. The line items table is typically pre-resolved by the render service
 * before pdfme generate(), but this Plugin implementation ensures the designer
 * can render previews and configure properties without crashing.
 */
exports.lineItemsTable = {
    /**
     * Type identifier for this schema
     */
    type: 'lineItemsTable',
    /**
     * Default properties for a new lineItemsTable element
     */
    defaultSchema: {
        type: 'lineItemsTable',
        position: { x: 10, y: 60 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        alternateRowShading: true,
        alternateRowColor: '#f7fafc',
        columns: [
            { key: 'description', header: 'Description', width: 80, align: 'left' },
            { key: 'qty', header: 'Qty', width: 25, align: 'right' },
            { key: 'unitPrice', header: 'Unit Price', width: 35, align: 'right', format: '#,##0.00' },
            { key: 'amount', header: 'Amount', width: 50, align: 'right', format: '#,##0.00' },
        ],
        footerRows: [
            {
                id: 'subtotal',
                label: 'Subtotal',
                valueColumnKey: 'amount',
                type: 'sum',
                format: '#,##0.00',
                style: { fontWeight: 'bold', borderBottom: '1px solid #000' },
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
                style: { fontWeight: 'bold', fontSize: 10, borderBottom: '2px solid #000' },
            },
        ],
        headerStyle: {
            backgroundColor: '#2d3748',
            fontWeight: 'bold',
            fontSize: 9,
        },
        bodyStyle: {
            fontSize: 8,
        },
    },
    /**
     * PDF renderer - renders a table directly to the PDF page.
     * Normally lineItemsTable is pre-resolved to a standard table by the render service,
     * but this serves as a fallback if the element reaches the generator unresolved.
     */
    pdf: pdf_1.pdfRender,
    /**
     * UI renderer - renders a visual table preview on the designer canvas.
     */
    ui: ui_1.uiRender,
    /**
     * Property panel - configures the property editor in the designer sidebar.
     */
    propPanel: propPanel_1.propPanel,
    /**
     * Icon for the element palette.
     */
    icon: LINE_ITEMS_TABLE_ICON,
    /**
     * Resolve line items tables in a template.
     * Called by the render service before pdfme generate().
     */
    resolve: resolveLineItemsTables,
    /**
     * Compute footer row values from line items data.
     */
    computeFooterRows,
    /**
     * Resolve table data (head, body with footers) from line items and schema.
     */
    resolveTableData: resolveLineItemsTableData,
    /**
     * Format a number with an optional format string.
     */
    formatNumber,
    /**
     * Evaluate a row condition against a line item.
     */
    evaluateRowCondition,
    /**
     * Build sub-row cells from a sub-row config and line item data.
     */
    buildSubRowCells,
};
//# sourceMappingURL=index.js.map