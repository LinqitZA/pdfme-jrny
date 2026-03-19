/**
 * Line Items Table - Property panel definition for the designer.
 *
 * Defines the property editor schema for configuring line items table
 * elements in the pdfme Designer UI. Includes column configuration,
 * header/footer settings, and styling options.
 */

export const propPanel = {
  schema: () => ({
    showHeader: {
      title: 'Show Header',
      type: 'boolean' as const,
      widget: 'checkbox',
      span: 12,
    },
    repeatHeader: {
      title: 'Repeat Header on Pages',
      type: 'boolean' as const,
      widget: 'checkbox',
      span: 12,
    },
    alternateRowShading: {
      title: 'Alternate Row Shading',
      type: 'boolean' as const,
      widget: 'checkbox',
      span: 12,
    },
    alternateRowColor: {
      title: 'Alternate Row Color',
      type: 'string' as const,
      widget: 'color',
      props: { disabledAlpha: true },
      span: 12,
    },
    '---header-style---': { type: 'void' as const, widget: 'Divider' },
    headerStyleSection: {
      title: 'Header Style',
      type: 'object' as const,
      widget: 'Card',
      span: 24,
      properties: {
        'headerStyle.backgroundColor': {
          title: 'Background Color',
          type: 'string' as const,
          widget: 'color',
          props: { disabledAlpha: true },
        },
        'headerStyle.fontSize': {
          title: 'Font Size',
          type: 'number' as const,
          widget: 'inputNumber',
          props: { min: 6, max: 24, step: 1 },
        },
      },
    },
    '---body-style---': { type: 'void' as const, widget: 'Divider' },
    bodyStyleSection: {
      title: 'Body Style',
      type: 'object' as const,
      widget: 'Card',
      span: 24,
      properties: {
        'bodyStyle.fontSize': {
          title: 'Font Size',
          type: 'number' as const,
          widget: 'inputNumber',
          props: { min: 6, max: 24, step: 1 },
        },
      },
    },
  }),
  defaultSchema: {
    name: '',
    type: 'lineItemsTable',
    content: '[]',
    position: { x: 10, y: 60 },
    width: 190,
    height: 100,
    showHeader: true,
    repeatHeader: true,
    alternateRowShading: true,
    alternateRowColor: '#f7fafc',
    columns: [
      { key: 'description', header: 'Description', width: 80, align: 'left' as const },
      { key: 'qty', header: 'Qty', width: 25, align: 'right' as const },
      { key: 'unitPrice', header: 'Unit Price', width: 35, align: 'right' as const, format: '#,##0.00' },
      { key: 'amount', header: 'Amount', width: 50, align: 'right' as const, format: '#,##0.00' },
    ],
    footerRows: [],
    headerStyle: {
      backgroundColor: '#2d3748',
      fontWeight: 'bold' as const,
      fontSize: 9,
    },
    bodyStyle: {
      fontSize: 8,
    },
  },
};
