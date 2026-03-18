/**
 * Watermark schema plugin
 *
 * Diagonal text overlay (DRAFT/COPY/VOID), configurable text/colour/opacity/rotation/font size,
 * controlled by template variable.
 *
 * The watermark is applied as a post-processing step on the generated PDF using pdf-lib.
 * It draws rotated text at the center of each page with the specified styling.
 *
 * Schema properties:
 * - type: 'watermark'
 * - text: string (e.g., 'DRAFT', 'COPY', 'VOID', 'CONFIDENTIAL')
 * - opacity: number (0.0 - 1.0, default: 0.3)
 * - rotation: number (degrees, default: 45)
 * - color: { r: number, g: number, b: number } (0-1 range, default: { r: 0.5, g: 0.5, b: 0.5 })
 * - fontSize: number (default: 72)
 */

export interface WatermarkConfig {
  text: string;
  opacity?: number;
  rotation?: number;
  color?: { r: number; g: number; b: number };
  fontSize?: number;
}

export interface WatermarkSchemaElement {
  type: 'watermark';
  name: string;
  text?: string;
  opacity?: number;
  rotation?: number;
  color?: { r: number; g: number; b: number };
  fontSize?: number;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  [key: string]: unknown;
}

/** Default watermark configuration */
export const WATERMARK_DEFAULTS: Required<WatermarkConfig> = {
  text: 'DRAFT',
  opacity: 0.3,
  rotation: 45,
  color: { r: 0.5, g: 0.5, b: 0.5 },
  fontSize: 72,
};

/**
 * Parse a hex color string (#RRGGBB or RRGGBB) to { r, g, b } in 0-1 range
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) return WATERMARK_DEFAULTS.color;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return WATERMARK_DEFAULTS.color;
  return { r, g, b };
}

/**
 * Apply a watermark overlay to a PDF buffer.
 * Draws diagonal text on every page of the PDF.
 *
 * @param pdfBytes - The source PDF as a Uint8Array or Buffer
 * @param config - Watermark configuration
 * @returns Modified PDF as Uint8Array
 */
export async function applyWatermark(
  pdfBytes: Uint8Array | Buffer,
  config: WatermarkConfig,
): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees, StandardFonts } = await import('pdf-lib');

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const text = config.text || WATERMARK_DEFAULTS.text;
  const opacity = config.opacity ?? WATERMARK_DEFAULTS.opacity;
  const rotation = config.rotation ?? WATERMARK_DEFAULTS.rotation;
  const color = config.color ?? WATERMARK_DEFAULTS.color;
  const fontSize = config.fontSize ?? WATERMARK_DEFAULTS.fontSize;

  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const textHeight = font.heightAtSize(fontSize);

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();

    // Center the watermark on the page
    const centerX = width / 2;
    const centerY = height / 2;

    page.drawText(text, {
      x: centerX - textWidth / 2,
      y: centerY - textHeight / 2,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity,
      rotate: degrees(rotation),
    });
  }

  return pdfDoc.save();
}

/**
 * Extract watermark configuration from template schema elements.
 * Scans all pages for watermark-type elements and returns the first found config.
 * Also supports watermark config from inputs.
 */
export function extractWatermarkFromTemplate(
  schemas: unknown[],
  inputs: Record<string, string>[],
): WatermarkConfig | null {
  if (!Array.isArray(schemas)) return null;

  for (const page of schemas) {
    if (!Array.isArray(page)) continue;
    for (const field of page) {
      if (
        field &&
        typeof field === 'object' &&
        'type' in field &&
        (field as { type: string }).type === 'watermark'
      ) {
        const wmField = field as WatermarkSchemaElement;
        const name = wmField.name;

        // Check if watermark text is overridden via inputs (variable binding)
        let text = wmField.text || WATERMARK_DEFAULTS.text;
        if (name && inputs.length > 0 && name in inputs[0]) {
          const inputValue = inputs[0][name];
          // Empty string means "hide watermark" - return null
          if (inputValue === '' || inputValue === null || inputValue === undefined) {
            return null;
          }
          text = inputValue;
        }

        // Parse color - support hex strings from inputs
        let color = wmField.color || WATERMARK_DEFAULTS.color;
        if (name && inputs.length > 0 && inputs[0][`${name}_color`]) {
          color = parseHexColor(inputs[0][`${name}_color`]);
        }

        // Parse fontSize from inputs
        let fontSize = wmField.fontSize || WATERMARK_DEFAULTS.fontSize;
        if (name && inputs.length > 0 && inputs[0][`${name}_fontSize`]) {
          const parsed = parseInt(inputs[0][`${name}_fontSize`], 10);
          if (!isNaN(parsed) && parsed > 0) fontSize = parsed;
        }

        return {
          text,
          opacity: wmField.opacity ?? WATERMARK_DEFAULTS.opacity,
          rotation: wmField.rotation ?? WATERMARK_DEFAULTS.rotation,
          color,
          fontSize,
        };
      }
    }
  }

  return null;
}

/**
 * The watermark plugin definition.
 * The actual PDF rendering is handled as a post-processing step by the render service,
 * which applies the watermark overlay after pdfme generates the base PDF.
 */
export const watermark = {
  type: 'watermark' as const,

  defaultSchema: {
    type: 'watermark',
    text: 'DRAFT',
    opacity: 0.3,
    rotation: 45,
    color: { r: 0.5, g: 0.5, b: 0.5 },
    fontSize: 72,
    position: { x: 0, y: 0 },
    width: 210,
    height: 297,
  },

  applyWatermark,
  extractWatermarkFromTemplate,
  parseHexColor,
  WATERMARK_DEFAULTS,
};
