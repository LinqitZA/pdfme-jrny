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
  ColumnFontStyle,
  RowCondition,
  RowStyle,
  MaxRowsPerPage,
  SerialDetail,
  LotDetail,
  TrackingDetailStyle,
} from '../types';
import { ExpressionEngine } from '../expression-engine';
import { formatNumber, type CarriedSubtotalConfig, type ResolvedFooterRow } from './rowHeights';

// Re-exported for backward compatibility: formatNumber used to be defined
// directly in this file; it now lives in ./rowHeights.ts (single source of
// truth shared with pdf.ts's carried-forward subtotal row), but any existing
// `import { formatNumber } from '.../line-items-table'` call sites still work.
export { formatNumber };

/** Lazily-created expression engine singleton (one per process) */
let _exprEngine: ExpressionEngine | null = null;
function getExpressionEngine(): ExpressionEngine {
  if (!_exprEngine) {
    _exprEngine = new ExpressionEngine({ onError: '#ERROR' });
  }
  return _exprEngine;
}

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

/** Configuration for a conditional sub-row that appears beneath a primary row */
export interface SubRowConfig {
  /** Unique identifier for this sub-row template */
  id: string;
  /** Condition that must be met for this sub-row to render */
  condition: RowCondition;
  /**
   * Cell definitions for the sub-row.
   * Maps column keys to content strings (may contain {{field.key}} bindings).
   * Columns not specified will be empty.
   */
  cells: Record<string, string>;
  /** Optional style for the sub-row */
  style?: RowStyle;
  /** Number of columns to span for the content (colSpan) */
  colSpan?: number;
  /** Which column key to start the colSpan from */
  startColumnKey?: string;
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
  /** Sub-row templates that render conditionally beneath each line item */
  subRows?: SubRowConfig[];
  /** Maximum rows per page */
  maxRowsPerPage?: MaxRowsPerPage;
  /**
   * Hard cap on body rows rendered per page via the getDynamicHeights
   * pagination path (independent of remaining page height — e.g. force
   * exactly 15 lines per page). Clamped to >= 1 at use. Unset preserves
   * pure height-fit pagination. Distinct from maxRowsPerPage, which drives
   * a separate pre-resolve page-splitting path (resolveLineItemsTables).
   */
  linesPerPage?: number;
  /**
   * Carried-forward subtotal row: on every non-final page, draws a row
   * summing `amountColumn` across all body rows rendered so far (rows 0
   * through the end of that page). The final page never shows it — see
   * ./rowHeights.ts's CarriedSubtotalConfig and ./pdf.ts's render logic.
   */
  carriedSubtotal?: CarriedSubtotalConfig;
  /** Alternating row shading */
  alternateRowShading?: boolean;
  /** Alternate row background color */
  alternateRowColor?: string;
  /** Header style */
  headerStyle?: RowStyle;
  /** Body row style */
  bodyStyle?: RowStyle;
  /** Whether to show serial/lot tracking detail sub-rows */
  showTrackingDetails?: boolean;
  /** Which serial detail fields to display (default: ['serialNo', 'status']) */
  trackingSerialFields?: string[];
  /** Which lot detail fields to display (default: ['lotNo', 'qty', 'expiryDate']) */
  trackingLotFields?: string[];
  /** Styling for tracking detail sub-rows */
  trackingDetailStyle?: TrackingDetailStyle;
  /** Grid line (column separator / row divider) color for body rows. Default '#cccccc'. */
  gridColor?: string;
  /** Grid line width (pt) for body rows. Default 0.25. */
  gridWidth?: number;
  /** Outer border / header divider color. Default '#000000'. */
  borderColor?: string;
  /** Outer border / header divider width (pt). Default 0.5. */
  borderWidth?: number;
  /**
   * Resolved footer rows (subtotal/VAT/total), computed by
   * resolveLineItemsTableInputs and attached to the schema before it reaches
   * generate(). Drawn ONLY on the final chunk, after the last body row.
   * Not intended to be set directly on a template — this is write-once
   * output of the data-resolution step.
   */
  __resolvedFooterRows?: ResolvedFooterRow[];
  /** Additional schema properties */
  [key: string]: unknown;
}

/** A single line item data record */
export type LineItemRecord = Record<string, string | number | null | undefined>;

/**
 * Evaluate whether a RowCondition is met for a given line item.
 *
 * @param condition - The condition to evaluate
 * @param item - The line item data record
 * @returns true if the condition is met
 */
export function evaluateRowCondition(
  condition: RowCondition,
  item: LineItemRecord,
): boolean {
  switch (condition.type) {
    case 'fieldNonEmpty': {
      if (!condition.field) return false;
      const val = item[condition.field];
      if (val === null || val === undefined) return false;
      if (typeof val === 'string' && val.trim() === '') return false;
      return true;
    }

    case 'expression': {
      if (!condition.expression) return false;
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
export function buildSubRowCells(
  item: LineItemRecord,
  subRow: SubRowConfig,
  columns: ColumnDefinition[],
): string[] {
  const cells: string[] = [];

  for (const col of columns) {
    const cellTemplate = subRow.cells[col.key];
    if (cellTemplate) {
      // Resolve {{field.key}} bindings in the cell content
      const resolved = cellTemplate.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
        const val = item[key.trim()];
        if (val === null || val === undefined) return '';
        return String(val);
      });
      cells.push(resolved);
    } else {
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
 * Convert a camelCase field name into a human-readable label.
 * e.g., 'serialNo' → 'Serial No', 'expiryDate' → 'Expiry Date'
 */
function humanizeFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * Default serial detail fields to display when none are configured.
 */
const DEFAULT_SERIAL_FIELDS = ['serialNo', 'status'];

/**
 * Default lot detail fields to display when none are configured.
 */
const DEFAULT_LOT_FIELDS = ['lotNo', 'qty', 'expiryDate'];

/**
 * Build tracking detail sub-rows for serial and/or lot data attached to a line item.
 *
 * Generates one sub-row per serial entry and one per lot entry, formatted as
 * indented text in the first column (other columns empty). Only generates rows
 * when the corresponding arrays are non-empty.
 *
 * @param item - The line item data record (may contain serials[] or lots[] arrays)
 * @param columns - The column definitions (used to determine row width)
 * @param serialFields - Which serial fields to display
 * @param lotFields - Which lot fields to display
 * @param indent - Number of leading spaces for indentation (default: 4)
 * @returns Array of sub-row string arrays
 */
export function buildTrackingSubRows(
  item: Record<string, unknown>,
  columns: ColumnDefinition[],
  serialFields: string[],
  lotFields: string[],
  indent = 4,
): string[][] {
  const rows: string[][] = [];
  const indentStr = ' '.repeat(indent) + '↳ ';

  // Serial detail sub-rows
  const serials = item.serials;
  if (Array.isArray(serials) && serials.length > 0) {
    for (const serial of serials as SerialDetail[]) {
      const parts: string[] = [];
      for (const field of serialFields) {
        const val = serial[field];
        if (val != null && val !== '') {
          parts.push(`${humanizeFieldName(field)}: ${String(val)}`);
        }
      }
      if (parts.length > 0) {
        const text = `${indentStr}S/N: ${parts.join(' | ')}`;
        const subRow = columns.map((_, i) => (i === 0 ? text : ''));
        rows.push(subRow);
      }
    }
  }

  // Lot detail sub-rows
  const lots = item.lots;
  if (Array.isArray(lots) && lots.length > 0) {
    for (const lot of lots as LotDetail[]) {
      const parts: string[] = [];
      for (const field of lotFields) {
        const val = lot[field];
        if (val != null && val !== '') {
          parts.push(`${humanizeFieldName(field)}: ${String(val)}`);
        }
      }
      if (parts.length > 0) {
        const text = `${indentStr}Lot: ${parts.join(' | ')}`;
        const subRow = columns.map((_, i) => (i === 0 ? text : ''));
        rows.push(subRow);
      }
    }
  }

  return rows;
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

  // Detect if any columns are calculated (need expression engine)
  const hasCalculated = columns.some((col) => col.columnType === 'calculated' && col.expression);
  const exprEngine = hasCalculated ? getExpressionEngine() : null;

  // Build body rows from line items, with conditional sub-rows
  const bodyRows: string[][] = [];
  const subRowConfigs = schema.subRows || [];

  // Enriched items: original data + computed values from calculated columns
  // This is used for footer sum calculations that reference calculated column keys
  const enrichedItems: LineItemRecord[] = [];

  for (const item of lineItems) {
    // Build context from the raw item data
    // so that calculated columns can reference other column values
    const rowContext: Record<string, unknown> = { ...item };

    // Evaluate calculated columns and resolve all cells
    const primaryRow = columns.map((col) => {
      const colType = col.columnType || 'field';

      if (colType === 'static') {
        // Static columns show the key value as fixed text in every row
        return col.key || '';
      }

      if (colType === 'calculated' && col.expression && exprEngine) {
        // Evaluate expression with row data as context
        try {
          const result = exprEngine.evaluate(col.expression, rowContext);
          // Store the computed value back into context so subsequent calculated columns can use it
          const numResult = typeof result === 'number' ? result : parseFloat(String(result));
          if (col.key) {
            rowContext[col.key] = isNaN(numResult) ? result : numResult;
          }
          // Format result
          if (typeof result === 'number' && col.format) {
            return formatNumber(result, col.format);
          }
          if (result === null || result === undefined) return '';
          return String(result);
        } catch (err) {
          // Graceful error handling: show ERR in cell, log warning
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[lineItemsTable] Expression error in column "${col.header}" (${col.key}): ${msg}`);
          return 'ERR';
        }
      }

      // Default: field column — read value from item data
      const val = item[col.key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'number' && col.format) {
        return formatNumber(val, col.format);
      }
      return String(val);
    });
    bodyRows.push(primaryRow);

    // Save enriched item (original + calculated values) for footer computation
    enrichedItems.push(rowContext as LineItemRecord);

    // Conditional sub-rows: evaluate each sub-row config against this item
    for (const subRow of subRowConfigs) {
      if (evaluateRowCondition(subRow.condition, item)) {
        const subRowCells = buildSubRowCells(item, subRow, columns);
        bodyRows.push(subRowCells);
      }
    }

    // Tracking detail sub-rows: auto-generated from serials[] and lots[] arrays
    if (schema.showTrackingDetails) {
      const serialFields = schema.trackingSerialFields || DEFAULT_SERIAL_FIELDS;
      const lotFields = schema.trackingLotFields || DEFAULT_LOT_FIELDS;
      const indent = schema.trackingDetailStyle?.indent ?? 4;
      const trackingRows = buildTrackingSubRows(
        item as Record<string, unknown>,
        columns,
        serialFields,
        lotFields,
        indent,
      );
      bodyRows.push(...trackingRows);
    }
  }

  // Compute and append footer rows (use enriched items so calculated column values are available for sums)
  const footerStartIndex = bodyRows.length;
  const footerRows = schema.footerRows || [];

  if (footerRows.length > 0) {
    const footerData = hasCalculated ? enrichedItems : lineItems;
    const { cells: footerCells } = computeFooterRows(footerData, footerRows, columns);
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
 * Convert ColumnFontStyle to partial CellStyle-compatible object for the table renderer.
 */
function fontStyleToCellStyle(
  style: ColumnFontStyle,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (style.fontName) result.fontName = style.fontName;
  if (style.fontSize != null) result.fontSize = style.fontSize;
  if (style.fontColor) result.fontColor = style.fontColor;
  return result;
}

/**
 * Build per-column body and header style objects from ColumnDefinition[] for the table renderer.
 * Returns bodyColumnStyles and headColumnStyles keyed by column index.
 */
function buildPerColumnStyles(
  columns: ColumnDefinition[],
): Record<string, unknown> {
  const bodyColumnStyles: Record<number, Record<string, unknown>> = {};
  const headColumnStyles: Record<number, Record<string, unknown>> = {};

  columns.forEach((col, idx) => {
    // Body column styles: font overrides + overflow + vertical alignment
    const bodyMapped: Record<string, unknown> = {};
    if (col.columnStyle) {
      Object.assign(bodyMapped, fontStyleToCellStyle(col.columnStyle));
    }
    if (col.overflow) {
      bodyMapped.overflow = col.overflow;
    }
    if (col.verticalAlign && col.verticalAlign !== 'middle') {
      bodyMapped.verticalAlignment = col.verticalAlign;
    }
    if (Object.keys(bodyMapped).length > 0) {
      bodyColumnStyles[idx] = bodyMapped;
    }

    // Header column styles: font overrides + alignment overrides
    const headMapped: Record<string, unknown> = {};
    if (col.headerColumnStyle) {
      Object.assign(headMapped, fontStyleToCellStyle(col.headerColumnStyle));
    }
    if (col.headerAlign) {
      headMapped.alignment = col.headerAlign;
    }
    if (col.headerVerticalAlign) {
      headMapped.verticalAlignment = col.headerVerticalAlign;
    }
    if (Object.keys(headMapped).length > 0) {
      headColumnStyles[idx] = headMapped;
    }
  });

  const result: Record<string, unknown> = {};
  if (Object.keys(bodyColumnStyles).length > 0) {
    result.bodyColumnStyles = bodyColumnStyles;
  }
  if (Object.keys(headColumnStyles).length > 0) {
    result.headColumnStyles = headColumnStyles;
  }
  return result;
}

/**
 * Build a pdfme table schema object from a lineItemsTable schema and column definitions.
 */
function buildTableSchema(
  litSchema: LineItemsTableSchema,
  columns: ColumnDefinition[],
  footerStartIndex: number,
): Record<string, unknown> {
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0) || litSchema.width;
  const headWidthPercentages = columns.map((c) => (c.width / totalWidth) * 100);

  const columnAlignment: { [colIndex: number]: 'left' | 'center' | 'right' } = {};
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
    // Per-column body font style overrides
    ...buildPerColumnStyles(columns),
    __footerStartIndex: footerStartIndex,
    __footerCount: footerRows.length,
  };
}

/**
 * Get the max rows for a given page index from MaxRowsPerPage config.
 */
function getMaxRowsForPage(
  config: MaxRowsPerPage,
  pageIndex: number,
  totalPages: number,
): number {
  if (typeof config === 'number') return config;
  if (pageIndex === 0) return config.first;
  if (pageIndex === totalPages - 1) return config.last;
  return config.middle;
}

export function resolveLineItemsTables(
  pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
  inputs: Record<string, string>[],
): { template: { basePdf: unknown; schemas: unknown[] }; inputs: Record<string, string>[] } {
  // Collect extra pages created by maxRowsPerPage splitting
  const extraPages: unknown[][] = [];
  const extraInputKeys: { fieldName: string; pageIndex: number; body: string }[] = [];

  const newSchemas = pdfmeTemplate.schemas.map((page) => {
    if (!Array.isArray(page)) return page;

    return page.map((field: Record<string, unknown>) => {
      if (!field || typeof field !== 'object') return field;
      if (field.type !== 'lineItemsTable') return field;

      const litSchema = field as unknown as LineItemsTableSchema;
      const fieldName = litSchema.name;
      // Feature #432: Use dataSource property as primary data key, fall back to field name
      const dataSourceKey = (field as Record<string, unknown>).dataSource as string | undefined;

      // Parse line items from the first input that has this field
      let lineItems: LineItemRecord[] = [];
      for (const input of inputs) {
        // Try dataSource key first (e.g., 'lineItems'), then fall back to field name
        const rawData = (dataSourceKey && input[dataSourceKey]) || input[fieldName];
        if (rawData) {
          try {
            lineItems = JSON.parse(rawData);
          } catch {
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
        const chunks: string[][][] = [];
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

/**
 * Resolve lineItemsTable DATA — parse each table's raw line-item input via
 * resolveLineItemsTableData (flattened body rows, calculated columns,
 * per-cell number/currency formatting, sub-rows, tracking rows, and footer
 * row values), then write the resolved body rows back onto `inputs` and
 * attach the resolved footer rows to the schema — WITHOUT converting the
 * element's type away from `'lineItemsTable'`.
 *
 * This is the native-render counterpart to resolveLineItemsTables(): that
 * function rewrites the element to `type: 'table'` so @pdfme/generator
 * dispatches to the upstream `table` plugin's own (fixed-height /
 * maxRowsPerPage) pagination. This function keeps `type: 'lineItemsTable'`
 * so generate() dispatches to THIS plugin's own pdf()/getDynamicHeights —
 * enabling linesPerPage/carriedSubtotal/height-fit pagination (see
 * ./dynamicHeights.ts, ./pdf.ts). There is deliberately no maxRowsPerPage
 * pre-split here: per-page row counts are governed entirely by
 * getDynamicHeights + the generator's own page-fit chunker.
 *
 * Footer rows are excluded from the paginated body (never counted as body
 * rows, never subject to linesPerPage/height-fit splitting) and instead
 * stored on `__resolvedFooterRows`, one entry per `schema.footerRows` config
 * (same index), so pdf.ts can draw them only on the final chunk and
 * dynamicHeights.ts can reserve space for them on the last page.
 *
 * Should be called by the render service INSTEAD OF resolveLineItemsTables()
 * before passing the template to pdfme generate(), with `lineItemsTable`
 * registered in the plugins map passed to generate().
 */
export function resolveLineItemsTableInputs(
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
      // Feature #432: Use dataSource property as primary data key, fall back to field name
      const dataSourceKey = (field as Record<string, unknown>).dataSource as string | undefined;

      // Parse line items from the first input that has this field
      let lineItems: LineItemRecord[] = [];
      for (const input of inputs) {
        const rawData = (dataSourceKey && input[dataSourceKey]) || input[fieldName];
        if (rawData) {
          try {
            lineItems = JSON.parse(rawData);
          } catch {
            lineItems = [];
          }
          break;
        }
      }

      // Resolve the table data (body rows + footer rows, in one array —
      // footerStartIndex is the boundary between the two).
      const resolved = resolveLineItemsTableData(lineItems, litSchema);
      const bodyOnly = resolved.body.slice(0, resolved.footerStartIndex);
      const footerCellRows = resolved.body.slice(resolved.footerStartIndex);
      const footerConfigs = litSchema.footerRows || [];

      // Write the resolved (non-footer) body rows back onto every input
      // record that carries this field, matching the JSON shape pdf.ts /
      // getLineItemsTableDynamicHeights already parse via JSON.parse(value).
      const bodyJson = JSON.stringify(bodyOnly);
      for (const input of inputs) {
        input[fieldName] = bodyJson;
      }

      const resolvedFooterRows: ResolvedFooterRow[] = footerCellRows.map((cells, i) => ({
        cells,
        style: footerConfigs[i]?.style,
      }));

      // Keep type: 'lineItemsTable' unchanged — only attach the resolved
      // footer data as extra (internal) schema properties.
      return {
        ...field,
        __resolvedFooterRows: resolvedFooterRows,
      };
    });
  });

  return {
    template: { basePdf: pdfmeTemplate.basePdf, schemas: newSchemas },
    inputs,
  };
}

import { uiRender } from './ui';
import { pdfRender } from './pdf';
import { propPanel } from './propPanel';
import { getLineItemsTableDynamicHeights } from './dynamicHeights';

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
   * PDF renderer - renders a table directly to the PDF page.
   * Normally lineItemsTable is pre-resolved to a standard table by the render service,
   * but this serves as a fallback if the element reaches the generator unresolved.
   */
  pdf: pdfRender,

  /**
   * UI renderer - renders a visual table preview on the designer canvas.
   */
  ui: uiRender,

  /**
   * Property panel - configures the property editor in the designer sidebar.
   */
  propPanel,

  /**
   * Icon for the element palette.
   */
  icon: LINE_ITEMS_TABLE_ICON,

  /**
   * Resolve line items tables in a template by converting them to standard
   * `table` elements (legacy path — no longer called by RenderService; kept
   * for backward compatibility / other consumers).
   */
  resolve: resolveLineItemsTables,

  /**
   * Resolve line items table DATA in place, keeping type: 'lineItemsTable'
   * so generate() dispatches to this plugin's own pdf()/getDynamicHeights
   * for native pagination. Called by the render service before pdfme
   * generate().
   */
  resolveInputs: resolveLineItemsTableInputs,

  /**
   * Compute per-row dynamic heights for pagination. Dispatched to by
   * @pdfme/generator (see generate.ts's pluginRegistry(...).findByType(...)
   * lookup) instead of the built-in single-fixed-height path, so an
   * unresolved lineItemsTable schema paginates across pages — splitting
   * rows and repeating the header — exactly like the base `table` plugin.
   * See ./dynamicHeights.ts for the implementation and ./rowHeights.ts for
   * the row-height math shared with the pdf() renderer above.
   */
  getDynamicHeights: getLineItemsTableDynamicHeights,

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
