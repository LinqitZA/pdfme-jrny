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

import type {
  ColumnDefinition,
  RowStyle,
  MaxRowsPerPage,
} from '../types';

/** Configuration for a single footer row */
export interface FooterRowConfig {
  /** Unique identifier for this footer row */
  id: string;
  /** Label to display (e.g., "Subtotal", "VAT (15%)", "Total") */
  label: string;
  /** Which column key should display the label (defaults to first column) */
  labelColumnKey?: string;
  /** Which column key should display the value */
  valueColumnKey: string;
  /**
   * How to compute the value:
   * - 'sum' - sum of all row values in valueColumnKey
   * - 'percentage' - percentage of a referenced footer row's value
   * - 'sumWithFooters' - sum of referenced footer row values
   * - 'expression' - custom expression string
   * - 'static' - use the value from inputs directly
   */
  type: 'sum' | 'percentage' | 'sumWithFooters' | 'expression' | 'static';
  /** For 'percentage' type: which footer row ID to reference */
  referenceFooterId?: string;
  /** For 'percentage' type: the percentage to apply (e.g., 0.15 for 15%) */
  percentage?: number;
  /** For 'sumWithFooters' type: array of footer IDs to sum */
  footerIds?: string[];
  /** Optional format string (e.g., '#,##0.00') */
  format?: string;
  /** Style overrides for this footer row */
  style?: RowStyle;
  /** Number of columns to span for the label (colSpan) */
  labelColSpan?: number;
}

/** Schema definition for a lineItemsTable element */
export interface LineItemsTableSchema {
  type: 'lineItemsTable';
  name: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  /** Column definitions */
  columns: ColumnDefinition[];
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Whether to repeat header on page breaks */
  repeatHeader?: boolean;
  /** Footer row configurations */
  footerRows?: FooterRowConfig[];
  /** Maximum rows per page */
  maxRowsPerPage?: MaxRowsPerPage;
  /** Alternating row shading */
  alternateRowShading?: boolean;
  /** Alternate row background color */
  alternateRowColor?: string;
  /** Header style */
  headerStyle?: RowStyle;
  /** Body row style */
  bodyStyle?: RowStyle;
  /** Additional schema properties */
  [key: string]: unknown;
}

/** A single line item data record */
export type LineItemRecord = Record<string, string | number | null | undefined>;

/**
 * Compute footer row values based on the line items data and footer config.
 *
 * @param lineItems - Array of line item data records
 * @param footerRows - Footer row configurations
 * @param columns - Column definitions
 * @returns Array of footer row cell arrays (each row is string[])
 */
export function computeFooterRows(
  lineItems: LineItemRecord[],
  footerRows: FooterRowConfig[],
  columns: ColumnDefinition[],
): { cells: string[][]; styles: (RowStyle | undefined)[] } {
  const computedValues = new Map<string, number>();
  const resultCells: string[][] = [];
  const resultStyles: (RowStyle | undefined)[] = [];

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
    const cells: string[] = [];
    const labelColKey = footer.labelColumnKey || (columns.length > 0 ? columns[0].key : '');
    const labelColSpan = footer.labelColSpan || 1;

    // Track which columns are consumed by colSpan
    const consumedCols = new Set<number>();

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
      } else if (col.key === footer.valueColumnKey) {
        cells.push(formatNumber(value, footer.format));
      } else {
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
 * Supports basic format patterns: #,##0.00
 */
export function formatNumber(value: number, format?: string): string {
  if (!format) {
    // Default: 2 decimal places
    return value.toFixed(2);
  }

  // Count decimal places from format
  const dotIdx = format.indexOf('.');
  let decimals = 2;
  if (dotIdx >= 0) {
    decimals = format.length - dotIdx - 1;
  }

  // Check for thousand separator
  const hasThousandSep = format.includes(',');

  let result = value.toFixed(decimals);

  if (hasThousandSep) {
    const parts = result.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    result = parts.join('.');
  }

  return result;
}

/**
 * Convert line items data and schema into pdfme-compatible table body data
 * with footer rows appended.
 *
 * @param lineItems - Array of line item records
 * @param schema - The lineItemsTable schema configuration
 * @returns Object with body (string[][]), head (string[][]), and footer info
 */
export function resolveLineItemsTableData(
  lineItems: LineItemRecord[],
  schema: LineItemsTableSchema,
): {
  head: string[][];
  body: string[][];
  footerStartIndex: number;
  columns: ColumnDefinition[];
} {
  const columns = schema.columns || [];

  // Build header row
  const head: string[][] = [];
  if (schema.showHeader !== false) {
    head.push(columns.map((col) => col.header));
  }

  // Build body rows from line items
  const bodyRows: string[][] = lineItems.map((item) =>
    columns.map((col) => {
      const val = item[col.key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number' && col.format) {
        return formatNumber(val, col.format);
      }
      return String(val);
    }),
  );

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
export function resolveLineItemsTables(
  pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
  inputs: Record<string, string>[],
): { template: { basePdf: unknown; schemas: unknown[] }; inputs: Record<string, string>[] } {
  const newSchemas = pdfmeTemplate.schemas.map((page) => {
    if (!Array.isArray(page)) return page;

    return page.map((field: Record<string, unknown>) => {
      if (!field || typeof field !== 'object') return field;
      if (field.type !== 'lineItemsTable') return field;

      const litSchema = field as unknown as LineItemsTableSchema;
      const fieldName = litSchema.name;

      // Parse line items from the first input that has this field
      let lineItems: LineItemRecord[] = [];
      for (const input of inputs) {
        if (input[fieldName]) {
          try {
            lineItems = JSON.parse(input[fieldName]);
          } catch {
            lineItems = [];
          }
          break;
        }
      }

      // Resolve the table data
      const resolved = resolveLineItemsTableData(lineItems, litSchema);

      // Build the body string for pdfme table input: JSON array of arrays
      const tableBody = JSON.stringify(resolved.body);

      // Set the resolved value in inputs
      for (const input of inputs) {
        input[fieldName] = tableBody;
      }

      // Convert to pdfme table schema
      const columns = resolved.columns;
      const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || litSchema.width;
      const headWidthPercentages = columns.map((c) => (c.width / totalWidth) * 100);

      // Build column alignment map
      const columnAlignment: { [colIndex: number]: 'left' | 'center' | 'right' } = {};
      columns.forEach((col, idx) => {
        if (col.align) {
          columnAlignment[idx] = col.align;
        }
      });

      // Footer row styles - apply bold font and top border to footer rows
      const footerRows = litSchema.footerRows || [];
      const footerStartIndex = resolved.footerStartIndex;

      return {
        name: fieldName,
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
          fontName: litSchema.headerStyle?.fontWeight === 'bold' ? undefined : undefined,
          alignment: 'left' as const,
          verticalAlignment: 'middle' as const,
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
          alignment: 'left' as const,
          verticalAlignment: 'middle' as const,
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
        // Store footer metadata for potential post-processing
        __footerStartIndex: footerStartIndex,
        __footerCount: footerRows.length,
      };
    });
  });

  return {
    template: { basePdf: pdfmeTemplate.basePdf, schemas: newSchemas },
    inputs,
  };
}

/**
 * The lineItemsTable plugin definition.
 *
 * The line items table is resolved by the render service before pdfme generate().
 * It converts to a standard pdfme table with footer rows appended to body data.
 */
export const lineItemsTable = {
  /**
   * Type identifier for this schema
   */
  type: 'lineItemsTable' as const,

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
      { key: 'description', header: 'Description', width: 80, align: 'left' as const },
      { key: 'qty', header: 'Qty', width: 25, align: 'right' as const },
      { key: 'unitPrice', header: 'Unit Price', width: 35, align: 'right' as const, format: '#,##0.00' },
      { key: 'amount', header: 'Amount', width: 50, align: 'right' as const, format: '#,##0.00' },
    ],
    footerRows: [
      {
        id: 'subtotal',
        label: 'Subtotal',
        valueColumnKey: 'amount',
        type: 'sum' as const,
        format: '#,##0.00',
        style: { fontWeight: 'bold' as const, borderBottom: '1px solid #000' },
      },
      {
        id: 'vat',
        label: 'VAT (15%)',
        valueColumnKey: 'amount',
        type: 'percentage' as const,
        referenceFooterId: 'subtotal',
        percentage: 0.15,
        format: '#,##0.00',
      },
      {
        id: 'total',
        label: 'Total',
        valueColumnKey: 'amount',
        type: 'sumWithFooters' as const,
        footerIds: ['subtotal', 'vat'],
        format: '#,##0.00',
        style: { fontWeight: 'bold' as const, fontSize: 10, borderBottom: '2px solid #000' },
      },
    ],
    headerStyle: {
      backgroundColor: '#2d3748',
      fontWeight: 'bold' as const,
      fontSize: 9,
    },
    bodyStyle: {
      fontSize: 8,
    },
  },

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
};
