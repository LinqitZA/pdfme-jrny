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
  headerStyle?: { fontSize?: number };
  bodyStyle?: { fontSize?: number };
  position?: { x: number; y: number };
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
