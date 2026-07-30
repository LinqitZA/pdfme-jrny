/**
 * Line Items Table - PDF renderer (NATIVE render path).
 *
 * This is the primary renderer for lineItemsTable elements: the render
 * service (nest-module/src/render.service.ts) resolves line-item DATA via
 * resolveLineItemsTableInputs() (body rows + resolved footer rows) while
 * keeping the element's type as 'lineItemsTable', so @pdfme/generator
 * dispatches straight to this pdf() function (and to getDynamicHeights, see
 * ./dynamicHeights.ts) instead of converting it to a base `table` element.
 * The legacy convert-to-`table` path (resolveLineItemsTables/buildTableSchema
 * in ./index.ts) still exists for backward compatibility but is no longer
 * used by the render service.
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
 *
 * Column alignment (col.align / col.headerAlign), grid borders (column
 * separators + row divider lines), and footer rows (subtotal/VAT/total,
 * drawn only on the final chunk) are all handled natively here — see the
 * dedicated sections below.
 *
 * TODO(parity): the following features were supported by the OLD
 * convert-to-`table` path (via buildPerColumnStyles/computeFooterRows in
 * ./index.ts) and are NOT YET ported to this native renderer:
 *  - Per-column font/color overrides (ColumnDefinition.columnStyle /
 *    headerColumnStyle) — every cell draws with the single embedded
 *    Helvetica/Helvetica-Bold font and black text color.
 *  - Sub-row / tracking-row (serial/lot) special styling — these rows DO
 *    render (they arrive as ordinary entries in the resolved body via
 *    resolveLineItemsTableData), but with plain body-row styling, not any
 *    dedicated indent/italic/background treatment.
 *  - Footer row `type: 'expression'` / `type: 'static'` calc types — see
 *    computeFooterRows in ./index.ts, which already returns 0 for these
 *    (unimplemented upstream of this renderer, not specific to it).
 *  - Cell colSpan (FooterRowConfig.labelColSpan, SubRowConfig.colSpan) —
 *    resolveLineItemsTableData does not currently emit merged-cell layout
 *    information for this renderer to consume.
 */

import {
  hexToRgb,
  computeColWidthsPt,
  computeWrappedRows,
  computeHeaderHeightPt,
  getHeaderFontSize,
  getBodyFontSize,
  getDrawFontSize,
  resolveColumnIndex,
  computeCellDrawX,
  parseBorderBottom,
  formatNumber,
  DEFAULT_CARRIED_SUBTOTAL_LABEL,
  DEFAULT_GRID_BORDER_COLOR,
  DEFAULT_GRID_BORDER_WIDTH,
  DEFAULT_OUTER_BORDER_COLOR,
  DEFAULT_OUTER_BORDER_WIDTH,
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

  // Bold variant, used for footer rows whose style.fontWeight === 'bold'.
  let boldFont: any;
  try {
    boldFont = await arg.pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  } catch {
    boldFont = font;
  }

  const drawFontSize = getDrawFontSize(bodyFontSize);
  const lineHeightPt = drawFontSize * LINE_HEIGHT_MULTIPLIER;
  let currentY = y;

  // ── Border/grid styling (schema-configurable, with sensible defaults) ──
  const outerBorderColor = hexToRgb((schema.borderColor as string) || DEFAULT_OUTER_BORDER_COLOR);
  const outerBorderWidth = (schema.borderWidth as number) || DEFAULT_OUTER_BORDER_WIDTH;
  const gridBorderColor = hexToRgb((schema.gridColor as string) || DEFAULT_GRID_BORDER_COLOR);
  const gridBorderWidth = (schema.gridWidth as number) || DEFAULT_GRID_BORDER_WIDTH;

  /** Draw a full-width horizontal divider line at the given y (pt). */
  const drawHorizontalLine = (lineY: number, color: { r: number; g: number; b: number }, thickness: number) => {
    page.drawLine({
      start: { x, y: lineY },
      end: { x: x + tableWidth, y: lineY },
      thickness,
      color: pdfLib.rgb(color.r, color.g, color.b),
    });
  };

  const tableTopY = currentY;

  // ── Pre-compute wrapped lines and row heights ──────────────────────
  // Shared with getLineItemsTableDynamicHeights (./dynamicHeights.ts) so the
  // heights the generator used to decide page breaks can never drift from
  // what gets drawn here.
  const colWidthsPt = computeColWidthsPt(columns, tableWidth);
  const wrappedRows = computeWrappedRows(bodyRows, columns, colWidthsPt, font, bodyFontSize);

  // Column left-edge x positions (for vertical grid lines) — the post-pass
  // near the end of this function draws internal separators at each
  // boundary once the table's full vertical extent (header..footer) is known.
  const colBoundaryX: number[] = [x];
  {
    let cx = x;
    for (const w of colWidthsPt) {
      cx += w;
      colBoundaryX.push(cx);
    }
  }

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
      const headerDrawSize = headerFontSize * 0.8;
      const headerAlign = col.headerAlign || col.align;
      if (font) {
        page.drawText(col.header, {
          x: computeCellDrawX(colX, colW, col.header, headerAlign, font, headerDrawSize),
          y: currentY - hdrHeight + 3,
          size: headerDrawSize,
          font,
          color: pdfLib.rgb(1, 1, 1),
        });
      }
      colX += colW;
    }
    currentY -= hdrHeight;
    // Divider between header and body.
    drawHorizontalLine(currentY, outerBorderColor, outerBorderWidth);
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
      const align = columns[ci]?.align;
      if (font && cell) {
        for (let li = 0; li < cell.lines.length; li++) {
          const lineText = cell.lines[li];
          if (!lineText) continue;
          page.drawText(lineText, {
            x: computeCellDrawX(colX, colW, lineText, align, font, drawFontSize),
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
    // Row divider (grid line) beneath this body row.
    drawHorizontalLine(currentY, gridBorderColor, gridBorderWidth);
  }

  // ── Draw carried-forward subtotal row (non-final pages only) ───────
  // "Last chunk" is determined the same way the engine's real chunker
  // decides it: __bodyRange.end is EXCLUSIVE, so this chunk is the last one
  // iff its end reaches (or somehow exceeds) the full parsed body row count.
  // When __bodyRange is absent (unresolved/non-paginated render), the whole
  // table is a single chunk — always "last" — so no carried subtotal is ever
  // drawn in that case either.
  const isLastChunk = rangeEndExclusive >= wrappedRows.length;
  const carriedSubtotal = (schema as LineItemsTableGeometrySchema).carriedSubtotal;

  if (carriedSubtotal?.enabled && !isLastChunk && columns.length > 0) {
    const amountColIdx = resolveColumnIndex(columns, carriedSubtotal.amountColumn);

    if (amountColIdx < 0) {
      console.warn(
        `[lineItemsTable] carriedSubtotal.amountColumn "${String(carriedSubtotal.amountColumn)}" did not resolve to a valid column — skipping carried-forward subtotal row.`,
      );
    } else {
      // Cumulative sum over ALL rows rendered so far, across every page up
      // to and including this one — i.e. bodyRows[0 .. rangeEndExclusive),
      // using the FULL parsed body (bodyRows), not just this chunk's slice.
      let sum = 0;
      let summable = true;
      for (let ri = 0; ri < rangeEndExclusive; ri++) {
        const raw = bodyRows[ri]?.[amountColIdx];
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
        if (raw === undefined || raw === null || raw === '' || isNaN(num)) {
          summable = false;
          break;
        }
        sum += num;
      }

      if (!summable) {
        console.warn(
          `[lineItemsTable] carriedSubtotal.amountColumn "${String(carriedSubtotal.amountColumn)}" is not numerically summable — skipping carried-forward subtotal row.`,
        );
      } else {
        const label = carriedSubtotal.label || DEFAULT_CARRIED_SUBTOTAL_LABEL;
        // Reuse the SAME formatter + per-column format string the table
        // already uses for this column's regular cells and footer sums, so
        // the carried subtotal is never formatted differently.
        const amountText = formatNumber(sum, columns[amountColIdx].format);

        const subtotalCells = columns.map((_, ci) => (ci === amountColIdx ? amountText : ''));
        if (amountColIdx === 0) {
          // Label and amount column coincide (edge case): combine into one cell
          // rather than silently dropping the label.
          subtotalCells[0] = `${label} ${amountText}`;
        } else {
          subtotalCells[0] = label;
        }

        const subtotalWrapped = computeWrappedRows(
          [subtotalCells],
          columns,
          colWidthsPt,
          font,
          bodyFontSize,
        )[0];
        const rHeight = subtotalWrapped.height;

        // Thin top border to visually separate the carried subtotal from the
        // regular rows above it, mirroring the footer rows' borderBottom styling.
        drawHorizontalLine(currentY, { r: 0, g: 0, b: 0 }, 0.75);

        let colX = x;
        for (let ci = 0; ci < columns.length; ci++) {
          const colW = colWidthsPt[ci];
          const cell = subtotalWrapped.cells[ci];
          const align = ci === amountColIdx ? columns[ci]?.align : undefined;
          if (font && cell) {
            for (let li = 0; li < cell.lines.length; li++) {
              const lineText = cell.lines[li];
              if (!lineText) continue;
              page.drawText(lineText, {
                x: computeCellDrawX(colX, colW, lineText, align, font, drawFontSize),
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
        drawHorizontalLine(currentY, gridBorderColor, gridBorderWidth);
      }
    }
  }

  // ── Draw footer rows (subtotal/VAT/total) — FINAL chunk only ───────
  // Excluded from the paginated body (they're never part of `bodyRows`/
  // `wrappedRows`), drawn once, immediately after the last body row (or
  // carried-forward subtotal, which never coexists with footer rows since
  // it's only drawn on non-final chunks). Styled distinctly (bold font
  // and/or a configured borderBottom per row) and NEVER alternately shaded.
  // dynamicHeights.ts reserves room for this block on the last page (see
  // getLineItemsTableDynamicHeights's footerReserveMm), so it should never
  // overflow past the page here.
  const resolvedFooterRows = (schema as LineItemsTableGeometrySchema).__resolvedFooterRows;
  if (isLastChunk && resolvedFooterRows && resolvedFooterRows.length > 0 && columns.length > 0) {
    // Divider separating the footer block from the body/carried-subtotal above it.
    drawHorizontalLine(currentY, outerBorderColor, outerBorderWidth);

    for (const footerRow of resolvedFooterRows) {
      const isBold = footerRow.style?.fontWeight === 'bold';
      const rowFont = isBold ? boldFont : font;
      const rowFontSize = footerRow.style?.fontSize ?? bodyFontSize;
      const rowDrawFontSize = getDrawFontSize(rowFontSize);
      const rowLineHeightPt = rowDrawFontSize * LINE_HEIGHT_MULTIPLIER;

      const wrapped = computeWrappedRows([footerRow.cells], columns, colWidthsPt, font, rowFontSize)[0];
      const rHeight = wrapped.height;

      // No alternating shading on footer rows — but an explicit
      // backgroundColor override is honored if present.
      if (footerRow.style?.backgroundColor) {
        const bg = hexToRgb(footerRow.style.backgroundColor);
        page.drawRectangle({
          x,
          y: currentY - rHeight,
          width: tableWidth,
          height: rHeight,
          color: pdfLib.rgb(bg.r, bg.g, bg.b),
        });
      }

      let colX = x;
      for (let ci = 0; ci < columns.length; ci++) {
        const colW = colWidthsPt[ci];
        const cell = wrapped.cells[ci];
        const align = columns[ci]?.align;
        if (rowFont && cell) {
          for (let li = 0; li < cell.lines.length; li++) {
            const lineText = cell.lines[li];
            if (!lineText) continue;
            page.drawText(lineText, {
              x: computeCellDrawX(colX, colW, lineText, align, rowFont, rowDrawFontSize),
              y: currentY - CELL_PADDING_PT - rowLineHeightPt * (li + 1) + rowDrawFontSize * 0.3,
              size: rowDrawFontSize,
              font: rowFont,
              color: pdfLib.rgb(0, 0, 0),
            });
          }
        }
        colX += colW;
      }
      currentY -= rHeight;

      const border = parseBorderBottom(footerRow.style?.borderBottom);
      if (border) {
        drawHorizontalLine(currentY, hexToRgb(border.color), border.widthPt);
      }
    }
  }

  // ── Draw grid: internal vertical column separators ──────────────────
  // Spans the table's full drawn vertical extent (header top through the
  // bottom of the last row drawn — body, carried-subtotal, or footer).
  for (let bi = 1; bi < colBoundaryX.length - 1; bi++) {
    page.drawLine({
      start: { x: colBoundaryX[bi], y: tableTopY },
      end: { x: colBoundaryX[bi], y: currentY },
      thickness: gridBorderWidth,
      color: pdfLib.rgb(gridBorderColor.r, gridBorderColor.g, gridBorderColor.b),
    });
  }

  // ── Draw outer border ──────────────────────────────────────────────
  page.drawRectangle({
    x,
    y: currentY,
    width: tableWidth,
    height: y - currentY,
    borderColor: pdfLib.rgb(outerBorderColor.r, outerBorderColor.g, outerBorderColor.b),
    borderWidth: outerBorderWidth,
  });
}
