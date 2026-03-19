/**
 * Grouped Table - PDF renderer.
 *
 * For PDF generation, the grouped table is normally pre-resolved to a
 * standard pdfme table by the render service / GroupedTableController.
 * This pdf() function serves as a fallback: if an unresolved groupedTable
 * element reaches the generator, it renders a simple table directly using pdf-lib.
 */

/**
 * Render a grouped table element to a PDF page.
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

  const columns = (schema.columns as Array<{ key: string; header: string; width: number; align?: string }>) || [];
  const position = schema.position as { x: number; y: number };
  const width = schema.width as number || 190;
  const height = schema.height as number || 150;
  const headerStyle = (schema.headerStyle as Record<string, unknown>) || {};

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
  const y = pageHeight - (position.y * mmToPt);
  const tableWidth = width * mmToPt;
  const totalColWidth = columns.reduce((s, c) => s + c.width, 0) || 1;

  // Get or embed a font
  let font;
  try {
    font = await arg.pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  } catch {
    try {
      font = await arg.pdfDoc.embedFont('Helvetica');
    } catch {
      font = null;
    }
  }

  const headerFontSize = (headerStyle.fontSize as number) || 9;
  const bodyFontSize = 8;

  function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16) / 255,
      g: parseInt(h.substring(2, 4), 16) / 255,
      b: parseInt(h.substring(4, 6), 16) / 255,
    };
  }

  let currentY = y;

  // Draw header
  if (columns.length > 0) {
    const hdrHeight = (headerFontSize + 6) * mmToPt / 3;
    const bgColor = hexToRgb((headerStyle.backgroundColor as string) || '#e0e0e0');

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
          x: colX + 2,
          y: currentY - hdrHeight + 3,
          size: headerFontSize * 0.8,
          font,
          color: pdfLib.rgb(0, 0, 0),
        });
      }
      colX += colW;
    }
    currentY -= hdrHeight;
  }

  // Draw body rows
  for (let ri = 0; ri < bodyRows.length; ri++) {
    const row = bodyRows[ri];
    const rHeight = (bodyFontSize + 4) * mmToPt / 3;

    if (currentY - rHeight < pageHeight - (position.y + height) * mmToPt) break;

    let colX = x;
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const colW = (col.width / totalColWidth) * tableWidth;
      const cellText = row[ci] || '';
      if (font && cellText) {
        page.drawText(cellText.substring(0, 50), {
          x: colX + 2,
          y: currentY - rHeight + 2,
          size: bodyFontSize * 0.8,
          font,
          color: pdfLib.rgb(0, 0, 0),
        });
      }
      colX += colW;
    }
    currentY -= rHeight;
  }

  // Draw border
  page.drawRectangle({
    x,
    y: currentY,
    width: tableWidth,
    height: y - currentY,
    borderColor: pdfLib.rgb(0, 0, 0),
    borderWidth: 0.5,
  });
}
