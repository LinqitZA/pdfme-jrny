"use strict";
/**
 * Grouped Table - Property panel definition for the designer.
 *
 * Defines the property editor schema for configuring grouped table
 * elements in the pdfme Designer UI. Includes column configuration,
 * grouping settings, and styling options.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.propPanel = void 0;
exports.propPanel = {
    schema: () => ({
        showGroupHeaders: {
            title: 'Show Group Headers',
            type: 'boolean',
            widget: 'checkbox',
            span: 12,
        },
        showGroupFooters: {
            title: 'Show Group Footers',
            type: 'boolean',
            widget: 'checkbox',
            span: 12,
        },
        showGrandTotal: {
            title: 'Show Grand Total',
            type: 'boolean',
            widget: 'checkbox',
            span: 12,
        },
        alternateRowShading: {
            title: 'Alternate Row Shading',
            type: 'boolean',
            widget: 'checkbox',
            span: 12,
        },
        '---header-style---': { type: 'void', widget: 'Divider' },
        headerStyleSection: {
            title: 'Header Style',
            type: 'object',
            widget: 'Card',
            span: 24,
            properties: {
                'headerStyle.backgroundColor': {
                    title: 'Background Color',
                    type: 'string',
                    widget: 'color',
                    props: { disabledAlpha: true },
                },
                'headerStyle.fontSize': {
                    title: 'Font Size',
                    type: 'number',
                    widget: 'inputNumber',
                    props: { min: 6, max: 24, step: 1 },
                },
            },
        },
        '---group-header-style---': { type: 'void', widget: 'Divider' },
        groupHeaderStyleSection: {
            title: 'Group Header Style',
            type: 'object',
            widget: 'Card',
            span: 24,
            properties: {
                'groupHeaderStyle.backgroundColor': {
                    title: 'Background Color',
                    type: 'string',
                    widget: 'color',
                    props: { disabledAlpha: true },
                },
                'groupHeaderStyle.fontWeight': {
                    title: 'Font Weight',
                    type: 'string',
                    widget: 'select',
                    props: {
                        options: [
                            { label: 'Normal', value: 'normal' },
                            { label: 'Bold', value: 'bold' },
                        ],
                    },
                },
            },
        },
    }),
    defaultSchema: {
        name: '',
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
};
//# sourceMappingURL=propPanel.js.map