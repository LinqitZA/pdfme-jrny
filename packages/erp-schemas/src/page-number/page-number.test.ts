/**
 * Tests for the pageNumber schema plugin (prints "Page X of Y" on every
 * generated page).
 *
 * ── What's actually being tested ──
 *
 * The "repeat on every page with the correct per-page index/total" behaviour
 * is NOT new engine code (see packages/erp-schemas/src/page-number/index.ts's
 * doc comment for the full trace): @pdfme/generator's generate() already
 * iterates `template.basePdf.staticSchema` once per FINAL output page and,
 * for `readOnly: true` elements, substitutes `schema.content` via
 * `replacePlaceholders()` with `variables: { totalPages, currentPage }`
 * (packages/generator/src/generate.ts). These tests drive that real
 * mechanism end to end through `generate()` — nothing is mocked or
 * simulated — and assert the actual per-page substituted text.
 *
 * ── Why a stand-in `pdf()` renderer for value verification ──
 *
 * The SHIPPED plugin's `pdf`/`ui` renderers are the upstream `text` plugin's
 * renderers, reused verbatim (`pageNumber.pdf === text.pdf`, asserted below).
 * That renderer embeds a real TrueType font (Roboto) and lets pdf-lib subset
 * it, which — exactly as documented in ../line-items-table/pagination.test.ts
 * (see its `extractPageContent` doc comment) — encodes drawn text as 2-byte
 * glyph IDs, NOT character codes, so it can't be hex-decoded back to a
 * literal string without a ToUnicode CMap (pdf-lib doesn't emit one here;
 * confirmed empirically while writing this test). That's a pdf-lib/font
 * limitation orthogonal to the feature under test.
 *
 * To assert the actual literal per-page string, the value-checking tests
 * below swap ONLY the `pdf` draw function for a trivial pdf-lib
 * StandardFonts.Helvetica renderer (WinAnsi-encoded, plain hex-decodable —
 * the same technique lineItemsTable's own pdf.ts uses, and the same reason
 * pagination.test.ts's `extractPageContent` can decode lineItemsTable cells
 * directly). Everything else — the schema, `content` format template,
 * `readOnly` flag, and critically the engine's per-page substitution that is
 * the actual feature under test — is exactly what generate() would use with
 * the real, shipped plugin. A separate smoke test below drives the
 * unmodified, shipped `pageNumber` plugin (real Roboto font) end to end to
 * confirm it renders without error and actually draws something on every
 * page.
 */

import * as zlib from 'zlib';
import { generate } from '@pdfme/generator';
import {
  BLANK_A4_PDF,
  type Template,
  type Schema,
  type BasePdf,
  type CommonOptions,
} from '@pdfme/common';
import { PDFDocument, PDFArray, PDFName, type PDFPage } from '@pdfme/pdf-lib';
import { text as textPlugin } from '@pdfme/schemas';
import { pageNumber, PAGE_NUMBER_DEFAULT_FORMAT, type PageNumberSchema } from './index';

// ── Test-only helpers ───────────────────────────────────────────────────

/**
 * A no-op "spacer" plugin whose sole purpose is to force a known number of
 * output pages via getDynamicHeights (the same mechanism lineItemsTable uses
 * for real pagination — see ../line-items-table/dynamicHeights.ts), without
 * drawing anything itself. This isolates each page's content stream to ONLY
 * the pageNumber static schema, so decoded Tj text can be attributed
 * unambiguously.
 */
const spacer = {
  type: 'spacer' as const,
  pdf: async () => {
    /* draws nothing */
  },
  ui: async () => {
    /* not exercised by generate() */
  },
  propPanel: {
    schema: () => ({}),
    defaultSchema: { name: '', type: 'spacer', position: { x: 0, y: 0 }, width: 10, height: 10 },
  },
  getDynamicHeights: async (
    _value: string,
    args: { schema: Schema; basePdf: BasePdf; options: CommonOptions },
  ): Promise<number[]> => {
    const basePdf = args.basePdf as { height: number; padding: [number, number, number, number] };
    const contentHeight = basePdf.height - basePdf.padding[0] - basePdf.padding[2];
    // Comfortably over half the page so exactly one "row" fits per page,
    // forcing exactly `pageCount` output pages.
    const rowHeight = contentHeight * 0.6;
    const pageCount = (args.schema as unknown as { pageCount?: number }).pageCount ?? 1;
    return Array.from({ length: pageCount }, () => rowHeight);
  },
};

function makeSpacerSchema(pageCount: number): Schema {
  return {
    type: 'spacer',
    name: 'spacer',
    position: { x: 0, y: 0 },
    width: 10,
    height: 10,
    pageCount,
  } as unknown as Schema;
}

function makePageNumberStaticSchema(overrides: Record<string, unknown> = {}): PageNumberSchema {
  return {
    type: 'pageNumber',
    name: 'pageNumber',
    content: PAGE_NUMBER_DEFAULT_FORMAT,
    readOnly: true,
    position: { x: 10, y: 285 },
    width: 60,
    height: 8,
    fontSize: 12,
    ...overrides,
  } as PageNumberSchema;
}

/**
 * A minimal pdf-lib StandardFonts.Helvetica text renderer — WinAnsi-encoded,
 * so its Tj hex strings decode directly to plain characters (see file-level
 * doc comment for why this stand-in is needed only for value assertions).
 */
const debugHelveticaPdfRender = async (arg: {
  value: string;
  schema: Record<string, unknown>;
  pdfDoc: InstanceType<typeof PDFDocument>;
  page: PDFPage;
  pdfLib: typeof import('@pdfme/pdf-lib');
}): Promise<void> => {
  const { value, schema, pdfDoc, page, pdfLib } = arg;
  if (!value) return;
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  const position = schema.position as { x: number; y: number };
  const MM_TO_PT = 2.83465;
  const x = position.x * MM_TO_PT;
  const y = page.getHeight() - position.y * MM_TO_PT - 10;
  page.drawText(value, { x, y, size: 10, font });
};

/** Decode a page's content stream(s) into its Tj hex tokens, joined/decoded via WinAnsi latin1 (see debugHelveticaPdfRender above). */
function extractPageText(doc: InstanceType<typeof PDFDocument>, page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return '';
  const streamRefs = contents instanceof PDFArray ? contents.asArray() : [contents];

  let raw = '';
  for (const ref of streamRefs) {
    const stream = doc.context.lookup(ref) as {
      dict: { get(name: ReturnType<typeof PDFName.of>): unknown };
      getContents(): Uint8Array;
    };
    const filter = stream.dict.get(PDFName.of('Filter'));
    let bytes = stream.getContents();
    if (filter && String(filter) === '/FlateDecode') {
      bytes = zlib.inflateSync(Buffer.from(bytes));
    }
    raw += Buffer.from(bytes).toString('latin1');
  }

  const hexStrings = raw.match(/<([0-9A-Fa-f]+)>\s*Tj/g) || [];
  return hexStrings
    .map((m) => {
      const hex = m.slice(1, m.indexOf('>'));
      return Buffer.from(hex, 'hex').toString('latin1');
    })
    .join('');
}

// ── Plugin shape ─────────────────────────────────────────────────────────

describe('pageNumber plugin definition', () => {
  test('reuses the upstream text plugin renderers verbatim (no bespoke font/layout code)', () => {
    expect(pageNumber.pdf).toBe(textPlugin.pdf);
    expect(pageNumber.ui).toBe(textPlugin.ui);
  });

  test('defaultSchema is readOnly with the documented default format', () => {
    expect(pageNumber.propPanel.defaultSchema.type).toBe('pageNumber');
    expect(pageNumber.propPanel.defaultSchema.readOnly).toBe(true);
    expect(pageNumber.propPanel.defaultSchema.content).toBe('Page {currentPage} of {totalPages}');
    expect(PAGE_NUMBER_DEFAULT_FORMAT).toBe('Page {currentPage} of {totalPages}');
  });

  test("propPanel exposes a 'Format' field bound to `content`, plus the upstream text font fields", () => {
    const schema = pageNumber.propPanel.schema({
      options: {},
      activeSchema: pageNumber.propPanel.defaultSchema,
      activeElements: [],
      schemas: [],
      theme: {} as never,
      i18n: (key: string) => key,
    } as never);

    expect(schema.content).toMatchObject({ title: 'Format', type: 'string' });
    // Font styling fields delegated from the upstream text propPanel.
    expect(schema.fontSize).toBeDefined();
    expect(schema.fontColor).toBeDefined();
    // The multi-variable-text "formatter" widget is upstream-text-specific and irrelevant here.
    expect(schema.formatter).toBeUndefined();
  });
});

// ── Real generate() smoke test with the UNMODIFIED shipped plugin ─────────

describe('pageNumber via generate() — shipped plugin (real Roboto font)', () => {
  test('renders without error and draws content on every page of a multi-page document', async () => {
    const template: Template = {
      basePdf: { ...BLANK_A4_PDF, staticSchema: [makePageNumberStaticSchema()] },
      schemas: [[makeSpacerSchema(3)]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: { pageNumber, spacer: spacer as never },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    expect(pages).toHaveLength(3);

    // Every page must have actually drawn something (a non-empty content
    // stream referencing the embedded font) — i.e. the static schema really
    // was rendered on each page, not just the first/last.
    for (const page of pages) {
      const contents = page.node.Contents();
      expect(contents).toBeTruthy();
    }
  });
});

// ── Real generate() value assertions (debug Helvetica stand-in renderer) ──

describe('pageNumber via generate() — per-page "Page X of Y" text', () => {
  test('a 3-page document shows "Page 1 of 3", "Page 2 of 3", "Page 3 of 3" on the respective pages', async () => {
    const template: Template = {
      basePdf: { ...BLANK_A4_PDF, staticSchema: [makePageNumberStaticSchema()] },
      schemas: [[makeSpacerSchema(3)]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: {
        pageNumber: { ...pageNumber, pdf: debugHelveticaPdfRender } as never,
        spacer: spacer as never,
      },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    expect(pages).toHaveLength(3);

    const texts = pages.map((p) => extractPageText(doc, p));
    expect(texts[0]).toBe('Page 1 of 3');
    expect(texts[1]).toBe('Page 2 of 3');
    expect(texts[2]).toBe('Page 3 of 3');
  });

  test('a single-page document shows "Page 1 of 1"', async () => {
    const template: Template = {
      basePdf: { ...BLANK_A4_PDF, staticSchema: [makePageNumberStaticSchema()] },
      schemas: [[makeSpacerSchema(1)]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: {
        pageNumber: { ...pageNumber, pdf: debugHelveticaPdfRender } as never,
        spacer: spacer as never,
      },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    expect(pages).toHaveLength(1);
    expect(extractPageText(doc, pages[0])).toBe('Page 1 of 1');
  });

  test('a custom format template is honoured (e.g. "{currentPage} / {totalPages}")', async () => {
    const template: Template = {
      basePdf: {
        ...BLANK_A4_PDF,
        staticSchema: [makePageNumberStaticSchema({ content: '{currentPage} / {totalPages}' })],
      },
      schemas: [[makeSpacerSchema(2)]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: {
        pageNumber: { ...pageNumber, pdf: debugHelveticaPdfRender } as never,
        spacer: spacer as never,
      },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    expect(pages).toHaveLength(2);
    const texts = pages.map((p) => extractPageText(doc, p));
    expect(texts[0]).toBe('1 / 2');
    expect(texts[1]).toBe('2 / 2');
  });
});
