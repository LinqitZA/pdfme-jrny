/**
 * Rich Text schema plugin
 *
 * Limited HTML subset (bold, italic, underline, font size, colour, line breaks),
 * field bindings within rich text, PDF rendering via pdf-lib.
 *
 * Supported HTML tags:
 * - <b>, <strong> — bold
 * - <i>, <em> — italic
 * - <u> — underline
 * - <br>, <br/> — line break
 * - <span style="..."> — inline styles (font-size, color, font-weight, font-style, text-decoration)
 * - <p> — paragraph (block with line break)
 *
 * Field bindings: {{field.key}} resolved from inputs context.
 */

export interface RichTextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: { r: number; g: number; b: number };
  lineBreakAfter: boolean;
}

export interface RichTextSchemaElement {
  type: 'richText';
  name: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  fontSize?: number;
  color?: string;
  lineHeight?: number;
  [key: string]: unknown;
}

export interface RichTextRenderInfo {
  name: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  segments: RichTextSegment[];
  lineHeight: number;
  pageIndex: number;
}

const DEFAULT_FONT_SIZE = 12;
const DEFAULT_COLOR = { r: 0, g: 0, b: 0 };
const DEFAULT_LINE_HEIGHT = 1.4;

/**
 * Parse a hex/CSS color string to { r, g, b } in 0-1 range.
 * Supports #RRGGBB, #RGB, rgb(r,g,b), and named colors (black, red, blue, green, gray).
 */
export function parseColor(colorStr: string): { r: number; g: number; b: number } {
  if (!colorStr) return DEFAULT_COLOR;

  const s = colorStr.trim().toLowerCase();

  // Named colors
  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 1, g: 1, b: 1 },
    red: { r: 1, g: 0, b: 0 },
    green: { r: 0, g: 0.502, b: 0 },
    blue: { r: 0, g: 0, b: 1 },
    gray: { r: 0.502, g: 0.502, b: 0.502 },
    grey: { r: 0.502, g: 0.502, b: 0.502 },
  };
  if (namedColors[s]) return namedColors[s];

  // #RRGGBB or #RGB
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
      };
    }
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
      };
    }
  }

  // rgb(r, g, b)
  const rgbMatch = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10) / 255,
      g: parseInt(rgbMatch[2], 10) / 255,
      b: parseInt(rgbMatch[3], 10) / 255,
    };
  }

  return DEFAULT_COLOR;
}

/**
 * Parse inline style string to extract formatting properties.
 */
function parseInlineStyle(style: string): {
  fontSize?: number;
  color?: { r: number; g: number; b: number };
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
} {
  const result: ReturnType<typeof parseInlineStyle> = {};

  // font-size
  const fsMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt|em|rem)?/i);
  if (fsMatch) {
    let size = parseFloat(fsMatch[1]);
    const unit = fsMatch[2]?.toLowerCase() || 'px';
    if (unit === 'px') size = size * 0.75; // px to pt approximation
    if (unit === 'em' || unit === 'rem') size = size * 12; // relative to 12pt base
    result.fontSize = Math.round(size * 10) / 10;
  }

  // color
  const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (colorMatch) {
    result.color = parseColor(colorMatch[1].trim());
  }

  // font-weight
  const fwMatch = style.match(/font-weight\s*:\s*([^;]+)/i);
  if (fwMatch) {
    const w = fwMatch[1].trim().toLowerCase();
    result.bold = w === 'bold' || w === '700' || w === '800' || w === '900';
  }

  // font-style
  const fiMatch = style.match(/font-style\s*:\s*([^;]+)/i);
  if (fiMatch) {
    result.italic = fiMatch[1].trim().toLowerCase() === 'italic';
  }

  // text-decoration
  const tdMatch = style.match(/text-decoration\s*:\s*([^;]+)/i);
  if (tdMatch) {
    result.underline = tdMatch[1].trim().toLowerCase().includes('underline');
  }

  return result;
}

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: { r: number; g: number; b: number };
}

/**
 * Parse an HTML subset string into RichTextSegment[].
 * Uses a simple tag-based parser (not a full DOM parser).
 */
export function parseRichTextHtml(
  html: string,
  defaultFontSize: number = DEFAULT_FONT_SIZE,
  defaultColor: { r: number; g: number; b: number } = DEFAULT_COLOR,
): RichTextSegment[] {
  if (!html || typeof html !== 'string') {
    return [{ text: '', bold: false, italic: false, underline: false, fontSize: defaultFontSize, color: defaultColor, lineBreakAfter: false }];
  }

  const segments: RichTextSegment[] = [];
  const stateStack: FormatState[] = [];
  let currentState: FormatState = {
    bold: false,
    italic: false,
    underline: false,
    fontSize: defaultFontSize,
    color: { ...defaultColor },
  };

  // Tokenize: split into tags and text
  const tokenRegex = /(<\/?[a-zA-Z][^>]*\/?>)/g;
  const tokens: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(html.substring(lastIndex, match.index));
    }
    tokens.push(match[1]);
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < html.length) {
    tokens.push(html.substring(lastIndex));
  }

  function pushText(text: string, lineBreakAfter = false) {
    if (text.length === 0 && !lineBreakAfter) return;
    segments.push({
      text,
      bold: currentState.bold,
      italic: currentState.italic,
      underline: currentState.underline,
      fontSize: currentState.fontSize,
      color: { ...currentState.color },
      lineBreakAfter,
    });
  }

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      // Plain text - decode HTML entities
      const decoded = decodeHtmlEntities(token);
      pushText(decoded);
      continue;
    }

    const tagLower = token.toLowerCase();

    // Self-closing <br> or <br/>
    if (tagLower.startsWith('<br')) {
      pushText('', true);
      continue;
    }

    // Closing tags
    if (tagLower.startsWith('</')) {
      const tagName = tagLower.replace(/<\/([a-z]+)\s*>/, '$1');
      if (['b', 'strong', 'i', 'em', 'u', 'span', 'p'].includes(tagName)) {
        if (tagName === 'p') {
          pushText('', true);
        }
        if (stateStack.length > 0) {
          currentState = stateStack.pop()!;
        }
      }
      continue;
    }

    // Opening tags
    const tagNameMatch = tagLower.match(/^<([a-z]+)/);
    if (!tagNameMatch) continue;
    const tagName = tagNameMatch[1];

    stateStack.push({ ...currentState, color: { ...currentState.color } });

    switch (tagName) {
      case 'b':
      case 'strong':
        currentState = { ...currentState, color: { ...currentState.color }, bold: true };
        break;
      case 'i':
      case 'em':
        currentState = { ...currentState, color: { ...currentState.color }, italic: true };
        break;
      case 'u':
        currentState = { ...currentState, color: { ...currentState.color }, underline: true };
        break;
      case 'p':
        // paragraph - inherits state
        currentState = { ...currentState, color: { ...currentState.color } };
        break;
      case 'span': {
        const styleMatch = token.match(/style\s*=\s*"([^"]*)"/i) || token.match(/style\s*=\s*'([^']*)'/i);
        if (styleMatch) {
          const parsed = parseInlineStyle(styleMatch[1]);
          currentState = {
            ...currentState,
            color: { ...currentState.color },
            ...(parsed.bold !== undefined ? { bold: parsed.bold } : {}),
            ...(parsed.italic !== undefined ? { italic: parsed.italic } : {}),
            ...(parsed.underline !== undefined ? { underline: parsed.underline } : {}),
            ...(parsed.fontSize !== undefined ? { fontSize: parsed.fontSize } : {}),
            ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          };
        } else {
          currentState = { ...currentState, color: { ...currentState.color } };
        }
        break;
      }
      default:
        // Unknown tag - pop the state we just pushed
        stateStack.pop();
        break;
    }
  }

  // If no segments were produced, return a single empty one
  if (segments.length === 0) {
    return [{
      text: html, // treat as plain text
      bold: false,
      italic: false,
      underline: false,
      fontSize: defaultFontSize,
      color: defaultColor,
      lineBreakAfter: false,
    }];
  }

  return segments;
}

/**
 * Decode basic HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Resolve {{field.key}} bindings in an HTML string using the provided context.
 */
export function resolveFieldBindings(
  html: string,
  context: Record<string, string>,
): string {
  if (!html || !context) return html || '';
  return html.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmedKey = key.trim();
    // Support dot notation: "field.key" => look up "field.key" directly first
    if (context[trimmedKey] !== undefined) {
      return context[trimmedKey];
    }
    // Try nested lookup
    const parts = trimmedKey.split('.');
    let value: unknown = context;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return ''; // binding not found, return empty
      }
    }
    return String(value ?? '');
  });
}

/**
 * Extract rich text elements from template schemas and prepare render info.
 * Returns the extracted rich text info and modifies the schemas to remove richText elements.
 */
export function extractRichTextFromTemplate(
  schemas: unknown[],
  inputs: Record<string, string>[],
): { richTextInfo: RichTextRenderInfo[]; cleanedSchemas: unknown[] } {
  const richTextInfo: RichTextRenderInfo[] = [];
  const inputContext = inputs.length > 0 ? inputs[0] : {};

  const cleanedSchemas = schemas.map((page: unknown, pageIndex: number) => {
    if (!Array.isArray(page)) return page;
    const cleanedPage: unknown[] = [];

    for (const field of page) {
      if (
        field &&
        typeof field === 'object' &&
        'type' in field &&
        (field as { type: string }).type === 'richText'
      ) {
        const rtField = field as RichTextSchemaElement;
        const name = rtField.name;

        // Get content: from inputs first, then from schema
        let content = '';
        if (name && inputContext[name]) {
          content = inputContext[name];
        } else if (rtField.content && typeof rtField.content === 'string') {
          content = rtField.content as string;
        }

        // Resolve field bindings
        content = resolveFieldBindings(content, inputContext);

        // Parse default color from schema
        const defaultColor = rtField.color ? parseColor(rtField.color) : DEFAULT_COLOR;
        const defaultFontSize = rtField.fontSize || DEFAULT_FONT_SIZE;

        // Parse HTML to segments
        const segments = parseRichTextHtml(content, defaultFontSize, defaultColor);

        richTextInfo.push({
          name: name || 'richText',
          position: rtField.position || { x: 10, y: 10 },
          width: rtField.width || 190,
          height: rtField.height || 50,
          segments,
          lineHeight: rtField.lineHeight || DEFAULT_LINE_HEIGHT,
          pageIndex,
        });
      } else {
        cleanedPage.push(field);
      }
    }

    return cleanedPage;
  });

  return { richTextInfo, cleanedSchemas };
}

/**
 * Apply rich text rendering to a PDF buffer using pdf-lib.
 * Draws styled text segments at the specified positions on each page.
 */
export async function applyRichText(
  pdfBytes: Uint8Array | Buffer,
  richTextInfo: RichTextRenderInfo[],
): Promise<Uint8Array> {
  if (richTextInfo.length === 0) return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(pdfBytes);

  // Embed standard fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const pages = pdfDoc.getPages();

  // Helper: mm to PDF points (1mm ≈ 2.835 pt)
  const mmToPt = (mm: number) => mm * 2.835;

  for (const rtInfo of richTextInfo) {
    const pageIndex = rtInfo.pageIndex;
    if (pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { height: pageHeight } = page.getSize();

    // Convert position from mm (top-left origin) to PDF points (bottom-left origin)
    const boxX = mmToPt(rtInfo.position.x);
    const boxY = pageHeight - mmToPt(rtInfo.position.y);
    const boxWidth = mmToPt(rtInfo.width);

    let cursorX = boxX;
    let cursorY = boxY;
    let currentLineHeight = 0;
    let firstLine = true;

    for (const seg of rtInfo.segments) {
      // Select font based on bold/italic
      const font = seg.bold && seg.italic
        ? fontBoldItalic
        : seg.bold
          ? fontBold
          : seg.italic
            ? fontItalic
            : fontRegular;

      const fontSize = seg.fontSize;
      const lineSpacing = fontSize * rtInfo.lineHeight;

      if (firstLine) {
        cursorY -= fontSize; // Move down from top edge by font size
        currentLineHeight = lineSpacing;
        firstLine = false;
      }

      if (seg.text.length > 0) {
        // Simple word-wrapping
        const words = seg.text.split(/(\s+)/);
        for (const word of words) {
          if (word.length === 0) continue;
          const wordWidth = font.widthOfTextAtSize(word, fontSize);

          // Check if we need to wrap to next line
          if (cursorX + wordWidth > boxX + boxWidth && cursorX > boxX) {
            cursorX = boxX;
            cursorY -= lineSpacing;
            currentLineHeight = lineSpacing;
          }

          // Draw the text
          page.drawText(word, {
            x: cursorX,
            y: cursorY,
            size: fontSize,
            font,
            color: rgb(seg.color.r, seg.color.g, seg.color.b),
          });

          // Draw underline if needed
          if (seg.underline) {
            const underlineY = cursorY - fontSize * 0.15;
            page.drawLine({
              start: { x: cursorX, y: underlineY },
              end: { x: cursorX + wordWidth, y: underlineY },
              thickness: fontSize * 0.05,
              color: rgb(seg.color.r, seg.color.g, seg.color.b),
            });
          }

          cursorX += wordWidth;
          currentLineHeight = Math.max(currentLineHeight, lineSpacing);
        }
      }

      // Handle line break
      if (seg.lineBreakAfter) {
        cursorX = boxX;
        cursorY -= currentLineHeight || lineSpacing;
        currentLineHeight = lineSpacing;
      }
    }
  }

  return pdfDoc.save();
}

/**
 * Process rich text elements in the render pipeline.
 * Returns modified template/inputs (with richText elements removed)
 * and the rich text render info for post-processing.
 */
export function resolveRichText(
  template: { basePdf: unknown; schemas: unknown[] },
  inputs: Record<string, string>[],
): {
  template: { basePdf: unknown; schemas: unknown[] };
  inputs: Record<string, string>[];
  richTextInfo: RichTextRenderInfo[];
} {
  const { richTextInfo, cleanedSchemas } = extractRichTextFromTemplate(
    template.schemas,
    inputs,
  );

  // Remove richText field names from inputs
  const richTextNames = new Set(richTextInfo.map((r) => r.name));
  const cleanedInputs = inputs.map((inp) => {
    const clean = { ...inp };
    for (const name of richTextNames) {
      delete clean[name];
    }
    return clean;
  });

  return {
    template: { basePdf: template.basePdf, schemas: cleanedSchemas },
    inputs: cleanedInputs,
    richTextInfo,
  };
}

/**
 * The richText plugin definition.
 */
export const richText = {
  type: 'richText' as const,

  defaultSchema: {
    type: 'richText',
    content: '',
    position: { x: 10, y: 10 },
    width: 190,
    height: 50,
    fontSize: 12,
    color: '#000000',
    lineHeight: 1.4,
  },

  parseRichTextHtml,
  resolveFieldBindings,
  extractRichTextFromTemplate,
  applyRichText,
  resolveRichText,
  parseColor,
};
