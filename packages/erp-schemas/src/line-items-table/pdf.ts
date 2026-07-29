/**
 * Line Items Table - PDF renderer.
 *
 * For PDF generation, the line items table is normally pre-resolved to a
 * standard pdfme table by the render service (resolveLineItemsTables).
 * This pdf() function serves as a fallback: if an unresolved lineItemsTable
 * element reaches the generator, it renders a simple table directly using pdf-lib.
 *
 * Supports text wrapping with dynamic row heights (#2251):
 * - Columns with overflow: 'wrap' (or default) wrap text and expand row height
 * - Columns with overflow: 'clip' or 'truncate' clip to single line
 *
 * Supports pagination (see ./dynamicHeights.ts, registered as this plugin's
 * getDynamicHeights): @pdfme/generator dispatches to getLineItemsTableDynamicHeights
 * to compute per-row heights, and @pdfme/common's getDynamicTemplate chunks the
 * schema across pages using those heights, tagging each chunk with
 * schema.__bodyRange ({ start, end }, body-row indices) and schema.__isSplit
 * (true on every chunk after the first). This renderer draws ONLY the rows in
 * __bodyRange and repeats the column header on split chunks when repeatHeader
 * is on — it no longer truncates rows against a fixed pixel boundary, so no
 * rows are silently dropped.
 */

import {
  hexToRgb,
  computeColWidthsPt,
  computeWrappedRows,
  computeHeaderHeightPt,
  getHeaderFontSize,
  getBodyFontSize,
  getDrawFontSize,
  MM_TO_PT,
  LINE_HEIGHT_MULTIPLIER,
  CELL_PADDING_PT,
  type PdfColumn,
  type LineItemsTableGeometrySchema,
} from './rowHeights';

// ── Main render ──────────────────────────────────────────────────────

/**
 * Render a line items table element to a PDF page.
 * Uses pdf-lib to draw a basic table representation.
 */
export async function pdfRender(arg: {
  schema: Record<string, unknown>;
  value: string;
  pdfLib: any;
  pdfDoc: any;
  page: any;
  options: Record<string, unknown>;
}): Promise<void> {
  const { schema, value, page, pdfLib } = arg;

  const columns = (schema.columns as PdfColumn[]) || [];
  const position = schema.position as { x: number; y: number };
  const width = (schema.width as number) || 190;
  const showHeader = schema.showHeader !== false;
  const repeatHeader = schema.repeatHeader !== false;
  const headerBg =
    ((schema.headerStyle as Record<string, unknown>)?.backgroundColor as string) || '#2d3748';
  const headerFontSize = getHeaderFontSize(schema as LineItemsTableGeometrySchema);
  const bodyFontSize = getBodyFontSize(schema as LineItemsTableGeometrySchema);

  // Parse body data
  let bodyRows: string[][] = [];
  if (value) {
    try {
      bodyRows = JSON.parse(value);
    } catch {
      bodyRows = [];
    }
  }

  // Convert mm to points (1mm = 2.835pt)
  const x = position.x * MM_TO_PT;
  const pageHeight = page.getHeight();
  const y = pageHeight - position.y * MM_TO_PT;
  const tableWidth = width * MM_TO_PT;

  // Get or embed a font
  let font: any;
  try {
    font = await arg.pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  } catch {
    try {
      font = await arg.pdfDoc.embedFont('Helvetica');
    } catch {
      font = null;
    }
  }

  const drawFontSize = getDrawFontSize(bodyFontSize);
  const lineHeightPt = drawFontSize * LINE_HEIGHT_MULTIPLIER;
  let currentY = y;

  // ── Pre-compute wrapped lines and row heights ──────────────────────
  // Shared with getLineItemsTableDynamicHeights (./dynamicHeights.ts) so the
  // heights the generator used to decide page breaks can never drift from
  // what gets drawn here.
  const colWidthsPt = computeColWidthsPt(columns, tableWidth);
  const wrappedRows = computeWrappedRows(bodyRows, columns, colWidthsPt, font, bodyFontSize);

  // ── Determine which rows belong on THIS page/chunk ──────────────────
  // __bodyRange is set by @pdfme/common's getDynamicTemplate when it splits
  // this schema across pages. Its `end` is an EXCLUSIVE slice boundary —
  // NOT an inclusive last-index — matching getBodyWithRange's own
  // `body.slice(range.start, range.end)` (packages/schemas/src/tables/helper.ts),
  // the same convention the base `table` plugin relies on. Treating it as
  // inclusive here previously double-rendered the row straddling every page
  // boundary (e.g. the last row of page N reappearing as the first row of
  // page N+1) — caught by the generate()-driven pagination test.
  //
  // Clamping to the actual row count is the "safety guard" replacing the
  // old fixed bottomBoundary break: per-page chunking (including forcing a
  // single over-tall row onto its own page) is the engine's responsibility
  // now (see placeRowsOnPages in packages/common/src/dynamicTemplate.ts);
  // this guard only prevents out-of-range slicing. When __bodyRange is
  // absent (e.g. this pdf() fallback invoked outside the dynamic-pagination
  // flow), every row is rendered — never silently dropped.
  const bodyRange = schema.__bodyRange as { start: number; end?: number } | undefined;
  const isSplit = Boolean(schema.__isSplit);

  let rangeStart = 0;
  let rangeEndExclusive = wrappedRows.length;
  if (bodyRange) {
    rangeStart = Math.max(0, Math.min(bodyRange.start ?? 0, wrappedRows.length));
    const end = bodyRange.end ?? wrappedRows.length;
    rangeEndExclusive = Math.max(rangeStart, Math.min(end, wrappedRows.length));
  }
  const rowsToRender = wrappedRows.slice(rangeStart, rangeEndExclusive);

  // Draw the header on the first chunk, and on every chunk when repeatHeader is on.
  const showHeaderOnThisChunk = showHeader && columns.length > 0 && (!isSplit || repeatHeader);

  // ── Draw header ────────────────────────────────────────────────────
  if (showHeaderOnThisChunk) {
    const hdrHeight = computeHeaderHeightPt(headerFontSize);
    const bgColor = hexToRgb(headerBg);

    page.drawRectangle({
      x,
      y: currentY - hdrHeight,
      width: tableWidth,
      height: hdrHeight,
      color: pdfLib.rgb(bgColor.r, bgColor.g, bgColor.b),
    });

    let colX = x;
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const colW = colWidthsPt[ci];
      if (font) {
        page.drawText(col.header, {
          x: colX + CELL_PADDING_PT,
          y: currentY - hdrHeight + 3,
          size: headerFontSize * 0.8,
          font,
          color: pdfLib.rgb(1, 1, 1),
        });
      }
      colX += colW;
    }
    currentY -= hdrHeight;
  }

  // ── Draw body rows ─────────────────────────────────────────────────
  for (let i = 0; i < rowsToRender.length; i++) {
    const wr = rowsToRender[i];
    const rHeight = wr.height;
    // Absolute row index (pre-slice) so alternating shading stays stable across page breaks.
    const originalRowIndex = rangeStart + i;

    // Alternating row shading
    if (schema.alternateRowShading && originalRowIndex % 2 === 1) {
      const altColor = hexToRgb((schema.alternateRowColor as string) || '#f7fafc');
      page.drawRectangle({
        x,
        y: currentY - rHeight,
        width: tableWidth,
        height: rHeight,
        color: pdfLib.rgb(altColor.r, altColor.g, altColor.b),
      });
    }

    let colX = x;
    for (let ci = 0; ci < columns.length; ci++) {
      const colW = colWidthsPt[ci];
      const cell = wr.cells[ci];
      if (font && cell) {
        for (let li = 0; li < cell.lines.length; li++) {
          const lineText = cell.lines[li];
          if (!lineText) continue;
          page.drawText(lineText, {
            x: colX + CELL_PADDING_PT,
            y: currentY - CELL_PADDING_PT - lineHeightPt * (li + 1) + drawFontSize * 0.3,
            size: drawFontSize,
            font,
            color: pdfLib.rgb(0, 0, 0),
          });
        }
      }
      colX += colW;
    }
    currentY -= rHeight;
  }

  // ── Draw outer border ──────────────────────────────────────────────
  page.drawRectangle({
    x,
    y: currentY,
    width: tableWidth,
    height: y - currentY,
    borderColor: pdfLib.rgb(0, 0, 0),
    borderWidth: 0.5,
  });
}
