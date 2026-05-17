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
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse a hex color string (#RRGGBB or RRGGBB) to normalised {r, g, b}. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

/** Approximate the width of a string in pt using the embedded font metrics. */
function measureText(text: string, font: any, fontSize: number): number {
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
function wrapText(
  text: string,
  font: any,
  fontSize: number,
  maxWidthPt: number,
): string[] {
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

// ── Column type with overflow ────────────────────────────────────────

interface PdfColumn {
  key: string;
  header: string;
  width: number;
  align?: string;
  overflow?: 'wrap' | 'truncate' | 'clip';
}

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
  const height = (schema.height as number) || 100;
  const showHeader = schema.showHeader !== false;
  const headerBg =
    ((schema.headerStyle as Record<string, unknown>)?.backgroundColor as string) || '#2d3748';
  const headerFontSize =
    ((schema.headerStyle as Record<string, unknown>)?.fontSize as number) || 9;
  const bodyFontSize =
    ((schema.bodyStyle as Record<string, unknown>)?.fontSize as number) || 8;

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
  const mmToPt = 2.835;
  const x = position.x * mmToPt;
  const pageHeight = page.getHeight();
  const y = pageHeight - position.y * mmToPt;
  const tableWidth = width * mmToPt;
  const totalColWidth = columns.reduce((s, c) => s + c.width, 0) || 1;
  const cellPaddingPt = 2; // horizontal cell padding in pt
  const lineHeightMultiplier = 1.3;

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

  const drawFontSize = bodyFontSize * 0.8;
  const lineHeightPt = drawFontSize * lineHeightMultiplier;
  const bottomBoundary = pageHeight - (position.y + height) * mmToPt;
  let currentY = y;

  // ── Pre-compute wrapped lines and row heights ──────────────────────
  const colWidthsPt = columns.map((c) => (c.width / totalColWidth) * tableWidth);

  interface WrappedCell {
    lines: string[];
  }
  interface WrappedRow {
    cells: WrappedCell[];
    height: number;
  }

  const wrappedRows: WrappedRow[] = bodyRows.map((row) => {
    let maxLines = 1;
    const cells: WrappedCell[] = columns.map((col, ci) => {
      const cellText = row[ci] || '';
      const overflow = col.overflow || 'wrap';
      const availableWidth = colWidthsPt[ci] - cellPaddingPt * 2;

      if (overflow === 'wrap') {
        const lines = wrapText(cellText, font, drawFontSize, availableWidth);
        if (lines.length > maxLines) maxLines = lines.length;
        return { lines };
      }
      // clip / truncate: single line, no expansion
      return { lines: [cellText] };
    });

    const rowH = Math.max(maxLines * lineHeightPt + cellPaddingPt * 2, lineHeightPt + 4);
    return { cells, height: rowH };
  });

  // ── Draw header ────────────────────────────────────────────────────
  if (showHeader && columns.length > 0) {
    const hdrHeight = (headerFontSize + 6) * (mmToPt / 3);
    const bgColor = hexToRgb(headerBg);

    page.drawRectangle({
      x,
      y: currentY - hdrHeight,
      width: tableWidth,
      height: hdrHeight,
      color: pdfLib.rgb(bgColor.r, bgColor.g, bgColor.b),
    });

    let colX = x;
    for (const col of columns) {
      const colW = (col.width / totalColWidth) * tableWidth;
      if (font) {
        page.drawText(col.header, {
          x: colX + cellPaddingPt,
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
  for (let ri = 0; ri < wrappedRows.length; ri++) {
    const wr = wrappedRows[ri];
    const rHeight = wr.height;

    // Stop if we've exceeded the element's vertical bounds
    if (currentY - rHeight < bottomBoundary) break;

    // Alternating row shading
    if (schema.alternateRowShading && ri % 2 === 1) {
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
            x: colX + cellPaddingPt,
            y: currentY - cellPaddingPt - lineHeightPt * (li + 1) + drawFontSize * 0.3,
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
