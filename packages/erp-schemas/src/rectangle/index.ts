/**
 * Rectangle schema plugin (ERP-extended)
 *
 * A rectangular shape element for decorative / layout purposes in templates.
 * Extends the upstream pdfme rectangle schema with shadow support.
 *
 * Properties:
 * - type: 'rectangle'
 * - cornerRadius: number (mm, 0 = sharp corners)
 * - borderWidth: number (mm, 0 = no border)
 * - borderColor: string (hex, e.g. '#000000')
 * - fillColor: string (hex, e.g. '#ffffff' or '' for transparent)
 * - shadow: optional { offsetX, offsetY, blur, color }
 *
 * PDF rendering uses the upstream pdfme rectangle plugin (which supports
 * radius, borderWidth, borderColor, color). Shadow is applied as a
 * post-processing step via pdf-lib.
 */

export interface RectangleShadow {
  offsetX: number; // mm
  offsetY: number; // mm
  blur: number;    // blur radius in mm (visual only on canvas; PDF uses solid offset)
  color: string;   // hex color with optional alpha, e.g. '#00000040'
}

export interface RectangleSchema {
  type: 'rectangle';
  name: string;
  position: { x: number; y: number };
  width: number;  // mm
  height: number; // mm
  cornerRadius: number;  // mm
  borderWidth: number;   // mm
  borderColor: string;   // hex
  fillColor: string;     // hex or '' for transparent
  opacity: number;       // 0-1
  shadow?: RectangleShadow;
  [key: string]: unknown;
}

export const RECTANGLE_DEFAULTS: Omit<RectangleSchema, 'name'> = {
  type: 'rectangle',
  position: { x: 0, y: 0 },
  width: 80,
  height: 50,
  cornerRadius: 0,
  borderWidth: 1,
  borderColor: '#000000',
  fillColor: '',
  opacity: 1,
};

export const SHADOW_DEFAULTS: RectangleShadow = {
  offsetX: 2,
  offsetY: 2,
  blur: 4,
  color: '#00000040',
};

/**
 * Parse a hex color with optional alpha to { r, g, b, a } in 0-1 range.
 * Supports #RGB, #RRGGBB, #RRGGBBAA formats.
 */
export function parseHexColorWithAlpha(hex: string): { r: number; g: number; b: number; a: number } {
  const clean = hex.replace(/^#/, '');
  let r = 0, g = 0, b = 0, a = 1;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
  } else if (clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
    a = parseInt(clean.slice(6, 8), 16) / 255;
  }

  if (isNaN(r)) r = 0;
  if (isNaN(g)) g = 0;
  if (isNaN(b)) b = 0;
  if (isNaN(a)) a = 1;

  return { r, g, b, a };
}

/**
 * Convert designer element properties to pdfme rectangle schema format.
 * Maps our ERP rectangle properties to the upstream schema format.
 */
export function toUpstreamRectangleSchema(element: RectangleSchema): Record<string, unknown> {
  return {
    type: 'rectangle',
    name: element.name,
    position: element.position,
    width: element.width,
    height: element.height,
    borderWidth: element.borderWidth || 0,
    borderColor: element.borderColor || '#000000',
    color: element.fillColor || '', // upstream uses 'color' for fill
    radius: element.cornerRadius || 0,
    opacity: element.opacity ?? 1,
    readOnly: true,
  };
}

/**
 * Resolve rectangle elements in a template for PDF generation.
 *
 * Converts ERP rectangle schemas to upstream pdfme rectangle format,
 * and extracts shadow info for post-processing.
 */
export function resolveRectangles(
  template: { basePdf: unknown; schemas: unknown[] },
  _inputs: Record<string, string>[],
): {
  template: { basePdf: unknown; schemas: unknown[] };
  shadowElements: Array<{
    pageIndex: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    cornerRadius: number;
    shadow: RectangleShadow;
  }>;
} {
  const shadowElements: Array<{
    pageIndex: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    cornerRadius: number;
    shadow: RectangleShadow;
  }> = [];

  if (!Array.isArray(template.schemas)) {
    return { template, shadowElements };
  }

  const newSchemas = template.schemas.map((page: unknown, pageIndex: number) => {
    if (!Array.isArray(page)) return page;
    return page.map((field: unknown) => {
      if (
        !field ||
        typeof field !== 'object' ||
        !('type' in field)
      ) {
        return field;
      }

      const f = field as Record<string, unknown>;

      // Only process our ERP rectangle elements (identified by having cornerRadius or fillColor)
      if (f.type !== 'rectangle') return field;

      // Check if this is an ERP rectangle (has cornerRadius or fillColor property)
      const isErpRect = 'cornerRadius' in f || 'fillColor' in f;
      if (!isErpRect) return field; // leave upstream rectangles alone

      const rect = f as unknown as RectangleSchema;

      // Extract shadow info for post-processing
      if (rect.shadow && (rect.shadow.offsetX || rect.shadow.offsetY)) {
        shadowElements.push({
          pageIndex,
          position: rect.position,
          width: rect.width,
          height: rect.height,
          cornerRadius: rect.cornerRadius || 0,
          shadow: rect.shadow,
        });
      }

      // Convert to upstream format
      return toUpstreamRectangleSchema(rect);
    });
  });

  return {
    template: { basePdf: template.basePdf, schemas: newSchemas },
    shadowElements,
  };
}

/**
 * Apply rectangle shadows as a post-processing step on the generated PDF.
 * Draws shadow rectangles behind the actual shapes using pdf-lib.
 *
 * @param pdfBytes - The source PDF as a Uint8Array or Buffer
 * @param shadowElements - Shadow info extracted from resolveRectangles
 * @returns Modified PDF as Uint8Array
 */
export async function applyRectangleShadows(
  pdfBytes: Uint8Array | Buffer,
  shadowElements: Array<{
    pageIndex: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    cornerRadius: number;
    shadow: RectangleShadow;
  }>,
): Promise<Uint8Array> {
  if (!shadowElements.length) return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const { PDFDocument, rgb } = await import('pdf-lib');

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  // mm to pt conversion (1mm = 2.83465pt)
  const mm2pt = (mm: number) => mm * 2.83465;

  for (const elem of shadowElements) {
    if (elem.pageIndex >= pages.length) continue;
    const page = pages[elem.pageIndex];
    const pageHeight = page.getHeight();

    const shadowColor = parseHexColorWithAlpha(elem.shadow.color);
    const x = mm2pt(elem.position.x + elem.shadow.offsetX);
    const y = pageHeight - mm2pt(elem.position.y + elem.shadow.offsetY) - mm2pt(elem.height);
    const width = mm2pt(elem.width);
    const height = mm2pt(elem.height);
    const radius = mm2pt(elem.cornerRadius);

    // Draw shadow rectangle (behind the actual shape)
    // pdf-lib doesn't support blur, so we draw a solid offset shadow
    const drawOpts: Record<string, unknown> = {
      x,
      y,
      width,
      height,
      color: rgb(shadowColor.r, shadowColor.g, shadowColor.b),
      opacity: shadowColor.a,
    };

    if (radius > 0) {
      drawOpts.borderRadius = radius;
    }

    page.drawRectangle(drawOpts as any);
  }

  return pdfDoc.save();
}

/**
 * The rectangle plugin definition.
 */
export const rectangle = {
  type: 'rectangle' as const,

  defaultSchema: {
    ...RECTANGLE_DEFAULTS,
  },

  resolveRectangles,
  applyRectangleShadows,
  toUpstreamRectangleSchema,
  parseHexColorWithAlpha,
  RECTANGLE_DEFAULTS,
  SHADOW_DEFAULTS,
};
