"use strict";
/**
 * Line Items Table - PDF renderer.
 *
 * For PDF generation, the line items table is normally pre-resolved to a
 * standard pdfme table by the render service (resolveLineItemsTables).
 * This pdf() function serves as a fallback: if an unresolved lineItemsTable
 * element reaches the generator, it renders a simple table directly using pdf-lib.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfRender = pdfRender;
/**
 * Render a line items table element to a PDF page.
 * Uses pdf-lib to draw a basic table representation.
 */
async function pdfRender(arg) {
    const { schema, value, page, pdfLib } = arg;
    const columns = schema.columns || [];
    const position = schema.position;
    const width = schema.width || 190;
    const height = schema.height || 100;
    const showHeader = schema.showHeader !== false;
    const headerBg = schema.headerStyle?.backgroundColor || '#2d3748';
    const headerFontSize = schema.headerStyle?.fontSize || 9;
    const bodyFontSize = schema.bodyStyle?.fontSize || 8;
    // Parse body data
    let bodyRows = [];
    if (value) {
        try {
            bodyRows = JSON.parse(value);
        }
        catch {
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
        font = await pdfLib.PDFDocument.prototype.embedFont
            ? await arg.pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica)
            : null;
    }
    catch {
        // Fallback
        try {
            font = await arg.pdfDoc.embedFont('Helvetica');
        }
        catch {
            font = null;
        }
    }
    const rowHeight = 14 * mmToPt / 5; // ~8pt rows
    let currentY = y;
    // Parse hex color to rgb
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        return {
            r: parseInt(h.substring(0, 2), 16) / 255,
            g: parseInt(h.substring(2, 4), 16) / 255,
            b: parseInt(h.substring(4, 6), 16) / 255,
        };
    }
    // Draw header
    if (showHeader && columns.length > 0) {
        const hdrHeight = (headerFontSize + 6) * mmToPt / 3;
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
                    x: colX + 2,
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
    // Draw body rows
    for (let ri = 0; ri < bodyRows.length; ri++) {
        const row = bodyRows[ri];
        const rHeight = (bodyFontSize + 4) * mmToPt / 3;
        if (currentY - rHeight < pageHeight - (position.y + height) * mmToPt)
            break;
        // Alternating row shading
        if (schema.alternateRowShading && ri % 2 === 1) {
            const altColor = hexToRgb(schema.alternateRowColor || '#f7fafc');
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
//# sourceMappingURL=pdf.js.map