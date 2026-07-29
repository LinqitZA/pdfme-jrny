/**
 * Line Items Table — shared row/header height computation.
 *
 * This module is the single source of truth for line-items-table row and
 * header heights (in pt). It backs BOTH:
 *  - pdf.ts's drawing loop (actual rendering positions), and
 *  - dynamicHeights.ts's getLineItemsTableDynamicHeights (the
 *    Plugin.getDynamicHeights hook @pdfme/generator dispatches to for
 *    pagination — see @pdfme/common's getDynamicTemplate).
 *
 * Keeping the wrap/height math in exactly one place means the heights the
 * generator uses to decide page breaks can never drift from what pdf.ts
 * actually draws.
 */

/** mm -> pt conversion factor used throughout this plugin's PDF fallback renderer. */
export const MM_TO_PT = 2.835;

/** Horizontal cell padding, in pt, used both for wrap-width measurement and drawing. */
export const CELL_PADDING_PT = 2;

/** Line height multiplier applied to the draw font size. */
export const LINE_HEIGHT_MULTIPLIER = 1.3;

export interface PdfColumn {
  key: string;
  header: string;
  width: number;
  align?: string;
  overflow?: 'wrap' | 'truncate' | 'clip';
  /** Optional number/currency format string (e.g. '#,##0.00'), consumed by formatNumber(). */
  format?: string;
}

/**
 * Configuration for the optional carried-forward subtotal row: on every page
 * of a paginated lineItemsTable EXCEPT the last, a row is drawn summing
 * `amountColumn` across every body row rendered so far (from row 0 through
 * the end of the current page's __bodyRange, inclusive of earlier pages).
 * The final page never shows this row — the table's own footer/totals
 * element covers the grand total there.
 */
export interface CarriedSubtotalConfig {
  /** Whether the carried-forward subtotal row is drawn on non-final pages. */
  enabled?: boolean;
  /** Which column to sum — a 0-based column index, or a column `key`. */
  amountColumn?: number | string;
  /** Label drawn in the first column. Defaults to 'Carried forward'. */
  label?: string;
}

/** Default label used when `carriedSubtotal.label` is unset/empty. */
export const DEFAULT_CARRIED_SUBTOTAL_LABEL = 'Carried forward';

/**
 * Resolve a carriedSubtotal.amountColumn value (0-based index, numeric
 * string index, or a column `key`) to a concrete column index. Returns -1
 * when it doesn't resolve to any column in `columns`, so callers can skip
 * the subtotal and warn rather than silently drawing into the wrong cell.
 */
export function resolveColumnIndex(
  columns: PdfColumn[],
  amountColumn: number | string | undefined | null,
): number {
  if (amountColumn === undefined || amountColumn === null || amountColumn === '') return -1;
  if (typeof amountColumn === 'number') {
    return Number.isInteger(amountColumn) && amountColumn >= 0 && amountColumn < columns.length
      ? amountColumn
      : -1;
  }
  const trimmed = amountColumn.trim();
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10);
    return idx >= 0 && idx < columns.length ? idx : -1;
  }
  return columns.findIndex((c) => c.key === amountColumn);
}

export interface WrappedCell {
  lines: string[];
}

export interface WrappedRow {
  cells: WrappedCell[];
  height: number;
}

/** Minimal shape of the lineItemsTable schema fields this module needs. */
export interface LineItemsTableGeometrySchema {
  columns?: PdfColumn[];
  width?: number;
  showHeader?: boolean;
  repeatHeader?: boolean;
  /** Hard cap on body rows rendered per page (independent of remaining height). Clamped to >= 1 at use. */
  linesPerPage?: number;
  headerStyle?: { fontSize?: number };
  bodyStyle?: { fontSize?: number };
  position?: { x: number; y: number };
  /** Carried-forward subtotal row, drawn on every non-final page. See CarriedSubtotalConfig. */
  carriedSubtotal?: CarriedSubtotalConfig;
  [key: string]: unknown;
}

/** Parse a hex color string (#RRGGBB or RRGGBB) to normalised {r, g, b}. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

/** Approximate the width of a string in pt using the embedded font metrics. */
export function measureText(text: string, font: any, fontSize: number): number {
  if (!font) return text.length * fontSize * 0.5; // rough fallback
  try {
    return font.widthOfTextAtSize(text, fontSize);
  } catch {
    return text.length * fontSize * 0.5;
  }
}

/**
 * Word-wrap a text string to fit within `maxWidthPt`, breaking at word
 * boundaries. Returns an array of lines.
 */
export function wrapText(text: string, font: any, fontSize: number, maxWidthPt: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureText(testLine, font, fontSize);
    if (testWidth > maxWidthPt && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  if (lines.length === 0) lines.push('');
  return lines;
}

/** Split a table's total width (pt) across columns proportional to their configured `width`. */
export function computeColWidthsPt(columns: PdfColumn[], tableWidthPt: number): number[] {
  const totalColWidth = columns.reduce((s, c) => s + c.width, 0) || 1;
  return columns.map((c) => (c.width / totalColWidth) * tableWidthPt);
}

export function getHeaderFontSize(schema: LineItemsTableGeometrySchema): number {
  return schema.headerStyle?.fontSize || 9;
}

export function getBodyFontSize(schema: LineItemsTableGeometrySchema): number {
  return schema.bodyStyle?.fontSize || 8;
}

/** The actual font size used when drawing body text (matches the existing 0.8 scale-down). */
export function getDrawFontSize(bodyFontSize: number): number {
  return bodyFontSize * 0.8;
}

/** Header row height in pt. */
export function computeHeaderHeightPt(headerFontSize: number): number {
  return (headerFontSize + 6) * (MM_TO_PT / 3);
}

/**
 * Compute each body row's wrapped cell lines + row height (pt), given the
 * parsed body rows, column definitions, per-column pt widths, and a font
 * usable for width measurement (anything exposing widthOfTextAtSize(text, size),
 * e.g. a pdf-lib embedded font).
 */
export function computeWrappedRows(
  bodyRows: string[][],
  columns: PdfColumn[],
  colWidthsPt: number[],
  font: any,
  bodyFontSize: number,
): WrappedRow[] {
  const drawFontSize = getDrawFontSize(bodyFontSize);
  const lineHeightPt = drawFontSize * LINE_HEIGHT_MULTIPLIER;

  return bodyRows.map((row) => {
    let maxLines = 1;
    const cells: WrappedCell[] = columns.map((col, ci) => {
      const cellText = row[ci] || '';
      const overflow = col.overflow || 'wrap';
      const availableWidth = colWidthsPt[ci] - CELL_PADDING_PT * 2;

      if (overflow === 'wrap') {
        const lines = wrapText(cellText, font, drawFontSize, availableWidth);
        if (lines.length > maxLines) maxLines = lines.length;
        return { lines };
      }
      // clip / truncate: single line, no expansion
      return { lines: [cellText] };
    });

    const rowH = Math.max(maxLines * lineHeightPt + CELL_PADDING_PT * 2, lineHeightPt + 4);
    return { cells, height: rowH };
  });
}

/**
 * Format a number value with optional format string.
 *
 * Supported format patterns:
 * - Number:     '#,##0', '#,##0.00', '#,##0.000', '0', '0.00'
 * - Currency:   'R #,##0.00', '$ #,##0.00', '€ #,##0.00' (prefix before number pattern)
 * - Percentage: '0%', '0.0%', '0.00%' (appends % suffix)
 *
 * The format string is parsed as: [prefix][number-pattern][% suffix]
 * where prefix is any characters before the first '#' or '0',
 * and number-pattern uses '#' for optional digits, '0' for required digits,
 * ',' for thousand separator, and '.' for decimal point.
 *
 * Single source of truth for line-items-table number/currency formatting —
 * shared by index.ts (footer rows, calculated columns) and pdf.ts (the
 * carried-forward subtotal row), so a page's carried subtotal is always
 * formatted identically to the same column's regular cells and footer sums.
 */
export function formatNumber(value: number, format?: string): string {
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
