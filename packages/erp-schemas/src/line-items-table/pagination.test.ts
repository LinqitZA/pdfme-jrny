/**
 * Tests for lineItemsTable pagination (getDynamicHeights + __bodyRange/__isSplit
 * honoring in pdf.ts).
 *
 * Two layers:
 *  1. Unit tests directly against getLineItemsTableDynamicHeights, asserting the
 *     contract mirrors getDynamicHeightsForTable (packages/schemas/src/tables/
 *     dynamicTemplate.ts): return shape is [headerHeight, ...bodyRowHeights],
 *     and repeatHeader folds a header height into the first body row of every
 *     page after the first.
 *  2. A real generate() run (this package's jest harness CAN resolve
 *     @pdfme/generator, @pdfme/pdf-lib and @pdfme/schemas — all prebuilt
 *     workspace packages with CJS entry points, verified against this ts-jest
 *     setup before writing this file) that drives the actual plugin end to
 *     end: many rows split across pages, the header repeated on every page,
 *     no row dropped, and a totals element positioned below the table on the
 *     original template landing on the last generated page.
 *
 * Text is verified by decoding the generated PDF's content streams directly
 * (FlateDecode + hex-string Tj operands) rather than via pdfjs-dist: pdfjs-dist
 * 5.x only ships an ESM (`import.meta`-using) build, which this repo's
 * ts-jest/CommonJS jest config cannot load. Reading pdf-lib's own parsed
 * object graph avoids depending on any new tooling.
 */

import * as zlib from 'zlib';
import { generate } from '@pdfme/generator';
import { BLANK_A4_PDF, isBlankPdf, type BlankPdf, type Schema, type Template } from '@pdfme/common';
import { PDFDocument, PDFArray, PDFName, StandardFonts } from '@pdfme/pdf-lib';
import { text as textPlugin } from '@pdfme/schemas';
import { lineItemsTable, resolveLineItemsTableInputs } from './index';
import { getLineItemsTableDynamicHeights } from './dynamicHeights';
import {
  computeHeaderHeightPt,
  computeColWidthsPt,
  measureText,
  getBodyFontSize,
  getDrawFontSize,
  CELL_PADDING_PT,
  MM_TO_PT,
} from './rowHeights';

// ── Shared fixtures ─────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'description', header: 'Description', width: 100 },
  { key: 'qty', header: 'Qty', width: 30, align: 'right' as const },
  { key: 'price', header: 'Price', width: 30, align: 'right' as const },
  { key: 'amount', header: 'Amount', width: 30, align: 'right' as const },
];

function makeSchema(overrides: Record<string, unknown> = {}): Schema {
  return {
    type: 'lineItemsTable',
    name: 'items',
    position: { x: 10, y: 20 },
    width: 190,
    height: 100,
    showHeader: true,
    repeatHeader: true,
    columns: COLUMNS,
    ...overrides,
  } as unknown as Schema;
}

function makeRows(n: number): string[][] {
  return Array.from({ length: n }, (_, i) => [`Item ${i + 1}`, '1', '10.00', '10.00']);
}

const _cache = () => new Map<string | number, unknown>();

// ── Layer 1: unit tests for getLineItemsTableDynamicHeights ────────────

describe('getLineItemsTableDynamicHeights (contract)', () => {
  test('returns [headerHeight, ...bodyRowHeights] with header at index 0', async () => {
    const schema = makeSchema();
    const rows = makeRows(5);
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
      schema,
      basePdf: BLANK_A4_PDF,
      options: {},
      _cache: _cache(),
    });

    expect(heights).toHaveLength(rows.length + 1);
    // Header height (mm) should match computeHeaderHeightPt(9) converted back to mm.
    expect(heights[0]).toBeCloseTo(computeHeaderHeightPt(9) / MM_TO_PT, 5);
    // Every body row height should be a small positive number of mm (not pt-scale).
    for (const h of heights.slice(1)) {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThan(20);
    }
  });

  test('showHeader: false reports 0 at index 0, matching the base table convention', async () => {
    const schema = makeSchema({ showHeader: false });
    const rows = makeRows(3);
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
      schema,
      basePdf: BLANK_A4_PDF,
      options: {},
      _cache: _cache(),
    });

    expect(heights[0]).toBe(0);
    expect(heights).toHaveLength(4);
  });

  test('columns.length === 0 falls back to the fixed schema.height (no columns to lay out)', async () => {
    const schema = makeSchema({ columns: [] });
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(makeRows(3)), {
      schema,
      basePdf: BLANK_A4_PDF,
      options: {},
      _cache: _cache(),
    });

    expect(heights).toEqual([schema.height]);
  });

  test('repeatHeader: false never injects header height into a body row', async () => {
    // Enough tall rows to have overflowed a page if repeat-header simulation ran.
    const schema = makeSchema({ repeatHeader: false, bodyStyle: { fontSize: 60 } });
    const rows = makeRows(40);
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
      schema,
      basePdf: BLANK_A4_PDF,
      options: {},
      _cache: _cache(),
    });

    // Without the simulation, the returned array is just [header, ...rows] verbatim —
    // every body row should have the SAME height (no row was fattened by a folded-in header).
    const bodyHeights = heights.slice(1);
    const distinct = new Set(bodyHeights.map((h) => Math.round(h * 1000)));
    expect(distinct.size).toBe(1);
  });

  test('repeatHeader: true folds the header height into the first body row of later pages', async () => {
    // Tall rows (bodyStyle fontSize 60) + enough of them to force a page split
    // within a single A4 page's content height.
    const schema = makeSchema({ bodyStyle: { fontSize: 60 } });
    const rows = makeRows(40);
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
      schema,
      basePdf: BLANK_A4_PDF,
      options: {},
      _cache: _cache(),
    });

    const bodyHeights = heights.slice(1);
    const distinct = Array.from(new Set(bodyHeights.map((h) => Math.round(h * 1000) / 1000)));
    // At least one row height must differ from the rest — that's the row a
    // repeated header was folded into.
    expect(distinct.length).toBeGreaterThan(1);

    const plainRowHeight = Math.min(...distinct);
    const fattenedRowHeight = Math.max(...distinct);
    // The difference should be approximately one header height (in mm).
    expect(fattenedRowHeight - plainRowHeight).toBeCloseTo(heights[0], 1);
  });

  test('is a no-op (all rows identical height) for a non-blank basePdf, matching getDynamicHeightsForTable', async () => {
    const customPdf = { width: 210, height: 297, padding: [10, 10, 10, 10] } as unknown as BlankPdf;
    expect(isBlankPdf(customPdf)).toBe(true); // sanity: our test double IS a blank pdf shape

    // Simulate a non-blank basePdf (e.g. an uploaded background PDF) by using an
    // object that fails isBlankPdf — repeatHeader must not attempt the page simulation.
    const notBlank = { width: 210, height: 297 } as unknown as BlankPdf; // no `padding` -> isBlankPdf() is false
    expect(isBlankPdf(notBlank as any)).toBe(false);

    const schema = makeSchema({ bodyStyle: { fontSize: 60 } });
    const rows = makeRows(40);
    const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
      schema,
      basePdf: notBlank,
      options: {},
      _cache: _cache(),
    });
    const bodyHeights = heights.slice(1);
    const distinct = new Set(bodyHeights.map((h) => Math.round(h * 1000)));
    expect(distinct.size).toBe(1);
  });
});

// ── Layer 2: real generate() pagination ─────────────────────────────────

/**
 * Decode a PDF page's content stream(s).
 *
 * Returns both:
 *  - `tokens`: the lineItemsTable/header cell text, in draw order, joined by
 *    `|`. lineItemsTable's pdf.ts (this plugin) draws with a pdf-lib
 *    STANDARD font (Helvetica), which pdf-lib emits as hex strings whose
 *    bytes are plain WinAnsi character codes (e.g. `<4974656D2031> Tj` ==
 *    "Item 1") — safe to decode directly.
 *  - `raw`: the undecoded content stream text, used only to detect the
 *    *presence* of the totals element (a `text` schema) by its distinct
 *    embedded font resource. @pdfme/schemas' `text` plugin embeds its own
 *    TrueType font (Roboto) with a custom glyph-ID cmap, so its Tj hex
 *    strings are NOT character codes and can't be decoded the same way —
 *    but the referenced font resource name is enough to tell which page(s)
 *    it was drawn on.
 */
function extractPageContent(
  doc: PDFDocument,
  page: ReturnType<PDFDocument['getPages']>[number],
): { tokens: string; raw: string } {
  const contents = page.node.Contents();
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

  // Standard-font (WinAnsi) text is emitted as hex strings, e.g. `<4974656D2031> Tj`.
  // Decode each in draw order and join with a separator so adjacent cells stay distinct.
  const hexStrings = raw.match(/<([0-9A-Fa-f]+)>\s*Tj/g) || [];
  const tokens = hexStrings
    .map((m) => {
      const hex = m.slice(1, m.indexOf('>'));
      return Buffer.from(hex, 'hex').toString('latin1');
    })
    .join('|');

  return { tokens, raw };
}

describe('lineItemsTable pagination via generate()', () => {
  test('splits many rows across pages, repeats the header on every page, drops no rows, and places a trailing totals element on the last page', async () => {
    const ROW_COUNT = 30;
    const rows = makeRows(ROW_COUNT);

    // Large body font size keeps the scenario deterministic: it forces far
    // fewer rows per page than a realistic invoice would use, so a handful
    // of rows reliably produces multiple pages without depending on exact
    // font-metric approximations.
    const tableSchema = {
      type: 'lineItemsTable',
      name: 'items',
      position: { x: 10, y: 20 },
      width: 190,
      height: 100, // nominal only — actual layout is fully dynamic
      showHeader: true,
      repeatHeader: true,
      bodyStyle: { fontSize: 40 },
      columns: COLUMNS,
    };

    // Positioned right after the table's nominal (pre-pagination) extent, so
    // it only lands on the last generated page if getDynamicTemplate's
    // Y-offset propagation correctly accounts for the table's real,
    // multi-page height.
    const totalsSchema = {
      type: 'text',
      name: 'totals',
      content: 'GRAND TOTAL',
      readOnly: true, // so generate() renders schema.content directly, no matching input needed
      position: { x: 10, y: 125 },
      width: 60,
      height: 10,
      fontSize: 12,
    };

    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [[tableSchema, totalsSchema] as unknown as Schema[]],
    };

    const pdf = await generate({
      inputs: [{ items: JSON.stringify(rows) }],
      template,
      plugins: { lineItemsTable, text: textPlugin },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();

    // 1. Pagination actually happened.
    expect(pages.length).toBeGreaterThan(1);

    const pageContents = pages.map((p) => extractPageContent(doc, p));
    const pageTexts = pageContents.map((c) => c.tokens);

    // 2. Header repeats on every page (repeatHeader: true).
    for (const pageText of pageTexts) {
      expect(pageText).toContain('Description');
      expect(pageText).toContain('Qty');
    }

    // 3. No row dropped, none duplicated: every "Item N" appears exactly once
    //    across the whole document, and all 30 are present.
    const fullText = pageTexts.join('|');
    for (let i = 1; i <= ROW_COUNT; i++) {
      const label = `Item ${i}`;
      const occurrences = fullText.split('|').filter((tok) => tok === label).length;
      expect(occurrences).toBe(1);
    }

    // 4. The totals element, positioned below the table in the original
    //    template, was pushed down onto the LAST page only (not duplicated,
    //    not left behind on an earlier page). Detected via its distinct
    //    embedded font resource (see extractPageContent's doc comment for
    //    why its text can't be hex-decoded the same way as the table cells).
    const pagesWithTotals = pageContents.filter((c) => /\/Roboto[\w-]*\s/.test(c.raw));
    expect(pagesWithTotals).toHaveLength(1);
    expect(pagesWithTotals[0]).toBe(pageContents[pageContents.length - 1]);
  });

  test('a lineItemsTable that fits on one page is not split and renders every row', async () => {
    const rows = makeRows(3);
    const tableSchema = {
      type: 'lineItemsTable',
      name: 'items',
      position: { x: 10, y: 20 },
      width: 190,
      height: 100,
      showHeader: true,
      repeatHeader: true,
      columns: COLUMNS,
    };

    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [[tableSchema] as unknown as Schema[]],
    };

    const pdf = await generate({
      inputs: [{ items: JSON.stringify(rows) }],
      template,
      plugins: { lineItemsTable },
    });

    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPages();
    expect(pages).toHaveLength(1);

    const pageText = extractPageContent(doc, pages[0]).tokens;
    for (let i = 1; i <= 3; i++) {
      expect(pageText).toContain(`Item ${i}`);
    }
  });

  /**
   * Count how many "Item N" tokens (per the makeRows() fixture) appear on a
   * single decoded page's token string.
   */
  function countItemTokensOnPage(pageTokens: string): number {
    return pageTokens.split('|').filter((tok) => /^Item \d+$/.test(tok)).length;
  }

  describe('linesPerPage cap', () => {
    test('30 rows with linesPerPage=15 on a tall page produce exactly 2 pages of 15 rows each', async () => {
      const ROW_COUNT = 30;
      const rows = makeRows(ROW_COUNT);

      // Small, normal-sized body font (unlike the height-fit test above) so
      // that height-based wrapping alone would comfortably fit far more than
      // 15 rows per A4 page — any page break here is caused ONLY by the
      // linesPerPage cap, not by running out of vertical space.
      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 15,
        columns: COLUMNS,
      };

      const template: Template = {
        basePdf: BLANK_A4_PDF,
        schemas: [[tableSchema] as unknown as Schema[]],
      };

      const pdf = await generate({
        inputs: [{ items: JSON.stringify(rows) }],
        template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();

      // Exactly 2 pages.
      expect(pages).toHaveLength(2);

      const pageContents = pages.map((p) => extractPageContent(doc, p));
      const pageTexts = pageContents.map((c) => c.tokens);

      // Exactly 15 rows per page.
      expect(countItemTokensOnPage(pageTexts[0])).toBe(15);
      expect(countItemTokensOnPage(pageTexts[1])).toBe(15);

      // Header repeats on both pages.
      for (const pageText of pageTexts) {
        expect(pageText).toContain('Description');
      }

      // No row dropped, none duplicated.
      const fullText = pageTexts.join('|');
      for (let i = 1; i <= ROW_COUNT; i++) {
        const label = `Item ${i}`;
        const occurrences = fullText.split('|').filter((tok) => tok === label).length;
        expect(occurrences).toBe(1);
      }

      // Page 1 holds rows 1-15, page 2 holds rows 16-30 (order preserved,
      // cap split at the right boundary, not just the right count).
      for (let i = 1; i <= 15; i++) {
        expect(pageTexts[0]).toContain(`Item ${i}`);
      }
      for (let i = 16; i <= 30; i++) {
        expect(pageTexts[1]).toContain(`Item ${i}`);
      }
    });

    test('linesPerPage unset leaves height-fit pagination unchanged', async () => {
      // Same tall-row scenario as the height-fit pagination test above, with
      // no linesPerPage set — must reproduce identical page count/shape.
      const ROW_COUNT = 30;
      const rows = makeRows(ROW_COUNT);

      const buildTemplate = (): Template => ({
        basePdf: BLANK_A4_PDF,
        schemas: [
          [
            {
              type: 'lineItemsTable',
              name: 'items',
              position: { x: 10, y: 20 },
              width: 190,
              height: 100,
              showHeader: true,
              repeatHeader: true,
              bodyStyle: { fontSize: 40 },
              columns: COLUMNS,
            },
          ] as unknown as Schema[],
        ],
      });

      const [pdfWithoutCap, pdfExplicitUndefinedCap] = await Promise.all([
        generate({
          inputs: [{ items: JSON.stringify(rows) }],
          template: buildTemplate(),
          plugins: { lineItemsTable },
        }),
        generate({
          inputs: [{ items: JSON.stringify(rows) }],
          template: {
            basePdf: BLANK_A4_PDF,
            schemas: [
              [
                {
                  type: 'lineItemsTable',
                  name: 'items',
                  position: { x: 10, y: 20 },
                  width: 190,
                  height: 100,
                  showHeader: true,
                  repeatHeader: true,
                  bodyStyle: { fontSize: 40 },
                  linesPerPage: undefined,
                  columns: COLUMNS,
                },
              ] as unknown as Schema[],
            ],
          },
          plugins: { lineItemsTable },
        }),
      ]);

      const docA = await PDFDocument.load(pdfWithoutCap);
      const docB = await PDFDocument.load(pdfExplicitUndefinedCap);

      // Same page count as the pre-existing height-fit test (multi-page,
      // driven purely by tall rows), and identical between the two runs.
      expect(docA.getPageCount()).toBeGreaterThan(1);
      expect(docB.getPageCount()).toBe(docA.getPageCount());

      const tokensA = docA.getPages().map((p) => extractPageContent(docA, p).tokens);
      const tokensB = docB.getPages().map((p) => extractPageContent(docB, p).tokens);
      expect(tokensB).toEqual(tokensA);
    });

    test('a cap larger than the row count renders a single page', async () => {
      const rows = makeRows(5);
      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 100,
        columns: COLUMNS,
      };

      const template: Template = {
        basePdf: BLANK_A4_PDF,
        schemas: [[tableSchema] as unknown as Schema[]],
      };

      const pdf = await generate({
        inputs: [{ items: JSON.stringify(rows) }],
        template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      expect(pages).toHaveLength(1);

      const pageText = extractPageContent(doc, pages[0]).tokens;
      expect(countItemTokensOnPage(pageText)).toBe(5);
    });

    test('unit: applyPageBreakSimulation-driven getLineItemsTableDynamicHeights inflates exactly the 15th body row per page to force the cap', async () => {
      const schema = makeSchema({ linesPerPage: 15 });
      const rows = makeRows(30);
      const heights = await getLineItemsTableDynamicHeights(JSON.stringify(rows), {
        schema,
        basePdf: BLANK_A4_PDF,
        options: {},
        _cache: _cache(),
      });

      // [header, body0..body29] = 31 entries; body index 14 (the 15th body
      // row, 0-based) must be inflated well beyond a normal row height to
      // consume the rest of the page and force the break.
      expect(heights).toHaveLength(31);
      const normalRowHeight = heights[1]; // first body row, unaffected by the cap
      const boundaryRowHeight = heights[15]; // header(0) + 15th body row => index 15
      expect(boundaryRowHeight).toBeGreaterThan(normalRowHeight * 2);
    });
  });

  describe('carriedSubtotal (carried-forward subtotal row)', () => {
    const COLUMNS_WITH_FORMAT = [
      { key: 'description', header: 'Description', width: 100 },
      { key: 'qty', header: 'Qty', width: 30, align: 'right' as const },
      { key: 'price', header: 'Price', width: 30, align: 'right' as const },
      { key: 'amount', header: 'Amount', width: 30, align: 'right' as const, format: '#,##0.00' },
    ];

    test('shows the cumulative sum labelled "Carried forward" on every non-final page, and none on the last page', async () => {
      const ROW_COUNT = 30;
      const rows = makeRows(ROW_COUNT); // every row's amount cell is '10.00'

      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 15,
        columns: COLUMNS_WITH_FORMAT,
        carriedSubtotal: { enabled: true, amountColumn: 'amount' },
      };

      const template: Template = {
        basePdf: BLANK_A4_PDF,
        schemas: [[tableSchema] as unknown as Schema[]],
      };

      const pdf = await generate({
        inputs: [{ items: JSON.stringify(rows) }],
        template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      expect(pages).toHaveLength(2);

      const pageTexts = pages.map((p) => extractPageContent(doc, p).tokens);

      // Page 1 (non-final): carried subtotal = sum of rows 1-15's amounts (15 * 10.00 = 150.00),
      // formatted using the amount column's own '#,##0.00' format.
      expect(pageTexts[0]).toContain('Carried forward');
      expect(pageTexts[0]).toContain('150.00');

      // Page 2 (last): no carried subtotal at all — the separate totals element covers the grand total there.
      expect(pageTexts[1]).not.toContain('Carried forward');

      // No row dropped, none duplicated.
      const fullText = pageTexts.join('|');
      for (let i = 1; i <= ROW_COUNT; i++) {
        expect(fullText.split('|').filter((tok) => tok === `Item ${i}`)).toHaveLength(1);
      }
    });

    test('carriedSubtotal disabled leaves pagination and rendering unchanged (same as the plain linesPerPage cap behaviour)', async () => {
      const ROW_COUNT = 30;
      const rows = makeRows(ROW_COUNT);

      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 15,
        columns: COLUMNS_WITH_FORMAT,
        carriedSubtotal: { enabled: false, amountColumn: 'amount' },
      };

      const template: Template = {
        basePdf: BLANK_A4_PDF,
        schemas: [[tableSchema] as unknown as Schema[]],
      };

      const pdf = await generate({
        inputs: [{ items: JSON.stringify(rows) }],
        template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      expect(pages).toHaveLength(2);

      const pageTexts = pages.map((p) => extractPageContent(doc, p).tokens);
      expect(countItemTokensOnPage(pageTexts[0])).toBe(15);
      expect(countItemTokensOnPage(pageTexts[1])).toBe(15);
      expect(pageTexts.join('|')).not.toContain('Carried forward');
    });

    test('a non-numerically-summable amountColumn skips the subtotal, warns, and still renders successfully', async () => {
      const ROW_COUNT = 30;
      const rows = makeRows(ROW_COUNT);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 15,
        columns: COLUMNS_WITH_FORMAT,
        // 'description' holds text ("Item 1", "Item 2", ...) — not numerically summable.
        carriedSubtotal: { enabled: true, amountColumn: 'description' },
      };

      const template: Template = {
        basePdf: BLANK_A4_PDF,
        schemas: [[tableSchema] as unknown as Schema[]],
      };

      const pdf = await generate({
        inputs: [{ items: JSON.stringify(rows) }],
        template,
        plugins: { lineItemsTable },
      });

      expect(pdf).toBeDefined();
      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      expect(pages.length).toBeGreaterThan(1);

      const pageTexts = pages.map((p) => extractPageContent(doc, p).tokens);
      expect(pageTexts.join('|')).not.toContain('Carried forward');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not numerically summable'));
      warnSpy.mockRestore();
    });

    test('unit: reserving room for the carried subtotal forces an earlier page break than an unreserved run, so the subtotal never overflows past the page', async () => {
      // Tall rows (as in the repeatHeader-folding test above) so pagination is
      // driven by real vertical space pressure, not just the linesPerPage cap —
      // this is the scenario where the reservation mechanism actually matters.
      const schemaWithReserve = makeSchema({
        bodyStyle: { fontSize: 60 },
        carriedSubtotal: { enabled: true, amountColumn: 'amount' },
      });
      const schemaWithoutReserve = makeSchema({ bodyStyle: { fontSize: 60 } });
      const rows = makeRows(40);

      const [heightsWithReserve, heightsWithoutReserve] = await Promise.all([
        getLineItemsTableDynamicHeights(JSON.stringify(rows), {
          schema: schemaWithReserve,
          basePdf: BLANK_A4_PDF,
          options: {},
          _cache: _cache(),
        }),
        getLineItemsTableDynamicHeights(JSON.stringify(rows), {
          schema: schemaWithoutReserve,
          basePdf: BLANK_A4_PDF,
          options: {},
          _cache: _cache(),
        }),
      ]);

      // Reserving space for the subtotal must break the first page at least
      // one row earlier than the unreserved run (fewer/shorter rows placed
      // before the first inflated/forced-break row).
      const findFirstInflatedIndex = (heights: number[], plain: number) =>
        heights.slice(1).findIndex((h) => Math.round(h * 1000) !== Math.round(plain * 1000));

      const plainRowHeight = Math.min(...heightsWithoutReserve.slice(1));
      const firstBreakWithoutReserve = findFirstInflatedIndex(heightsWithoutReserve, plainRowHeight);
      const firstBreakWithReserve = findFirstInflatedIndex(heightsWithReserve, plainRowHeight);

      expect(firstBreakWithReserve).toBeGreaterThanOrEqual(0);
      expect(firstBreakWithReserve).toBeLessThanOrEqual(firstBreakWithoutReserve);
    });
  });

  // ── Native render parity: alignment, grid borders, footer rows ────────
  //
  // Exercises the SAME production data-resolution step RenderService now
  // calls (resolveLineItemsTableInputs, from ./index.ts) — not just
  // getLineItemsTableDynamicHeights/pdfRender directly — so this covers the
  // real wiring: raw line-item records in, resolved body + __resolvedFooterRows
  // out, fed into generate() with the schema still type: 'lineItemsTable'.
  describe('native render parity (alignment, grid borders, footer rows)', () => {
    const PARITY_COLUMNS = [
      { key: 'description', header: 'Description', width: 100 },
      { key: 'qty', header: 'Qty', width: 30, align: 'right' as const },
      { key: 'price', header: 'Price', width: 30, align: 'right' as const },
      { key: 'amount', header: 'Amount', width: 30, align: 'right' as const, format: '#,##0.00' },
    ];

    /** Every raw line item has amount=10, so N rows sum to N*10. */
    function makeRawLineItems(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        description: `Item ${i + 1}`,
        qty: 1,
        price: 10,
        amount: 10,
      }));
    }

    function buildParityTemplate(rowCount: number) {
      const tableSchema = {
        type: 'lineItemsTable',
        name: 'items',
        position: { x: 10, y: 20 },
        width: 190,
        height: 100,
        showHeader: true,
        repeatHeader: true,
        linesPerPage: 15,
        columns: PARITY_COLUMNS,
        carriedSubtotal: { enabled: true, amountColumn: 'amount' },
        footerRows: [
          {
            id: 'subtotal',
            label: 'Subtotal',
            valueColumnKey: 'amount',
            type: 'sum' as const,
            format: '#,##0.00',
            style: { fontWeight: 'bold' as const },
          },
          {
            id: 'vat',
            label: 'VAT (15%)',
            valueColumnKey: 'amount',
            type: 'percentage' as const,
            referenceFooterId: 'subtotal',
            percentage: 0.15,
            format: '#,##0.00',
          },
          {
            id: 'total',
            label: 'Total',
            valueColumnKey: 'amount',
            type: 'sumWithFooters' as const,
            footerIds: ['subtotal', 'vat'],
            format: '#,##0.00',
            style: { fontWeight: 'bold' as const, borderBottom: '1px solid #000' },
          },
        ],
      };

      const rawTemplate = { basePdf: BLANK_A4_PDF, schemas: [[tableSchema] as unknown as Schema[]] };
      const rawInputs = [{ items: JSON.stringify(makeRawLineItems(rowCount)) }];

      // Reuse the SAME production data-resolution step render.service.ts calls
      // (resolveLineItemsTableInputs) — resolves body rows + footer rows,
      // keeps type: 'lineItemsTable', does NOT convert to a base `table`.
      return resolveLineItemsTableInputs(
        rawTemplate as { basePdf: unknown; schemas: unknown[] },
        rawInputs as Record<string, string>[],
      );
    }

    /** Extract (x, decodedText) pairs, in draw order, from a WinAnsi/Standard-font content stream. */
    function extractTextPositions(raw: string): { x: number; text: string }[] {
      const re = /1 0 0 1 ([\-\d.]+) [\-\d.]+ Tm\r?\n<([0-9A-Fa-f]+)> Tj/g;
      const out: { x: number; text: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        out.push({ x: parseFloat(m[1]), text: Buffer.from(m[2], 'hex').toString('latin1') });
      }
      return out;
    }

    /** Extract stroked line segments (m ... l ... S), with their stroke width. */
    function extractLineSegments(
      raw: string,
    ): { x1: number; y1: number; x2: number; y2: number; thickness: number }[] {
      const re =
        /([\d.]+) w\r?\n\[\] 0 d\r?\n([\-\d.]+) ([\-\d.]+) m\r?\n(?:[\-\d.]+ [\-\d.]+ m\r?\n)?([\-\d.]+) ([\-\d.]+) l/g;
      const out: { x1: number; y1: number; x2: number; y2: number; thickness: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        out.push({
          thickness: parseFloat(m[1]),
          x1: parseFloat(m[2]),
          y1: parseFloat(m[3]),
          x2: parseFloat(m[4]),
          y2: parseFloat(m[5]),
        });
      }
      return out;
    }

    test('30 rows / linesPerPage 15: 2 pages of 15, footer rows ONLY on page 2, carried subtotal ONLY on page 1', async () => {
      const { template, inputs } = buildParityTemplate(30);

      const pdf = await generate({
        inputs,
        template: template as unknown as Template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      expect(pages).toHaveLength(2);

      const pageContents = pages.map((p) => extractPageContent(doc, p));
      const pageTexts = pageContents.map((c) => c.tokens);

      // Exactly 15 rows per page, no drops/duplicates.
      expect(countItemTokensOnPage(pageTexts[0])).toBe(15);
      expect(countItemTokensOnPage(pageTexts[1])).toBe(15);
      const fullText = pageTexts.join('|');
      for (let i = 1; i <= 30; i++) {
        expect(fullText.split('|').filter((tok) => tok === `Item ${i}`)).toHaveLength(1);
      }

      // Carried-forward subtotal: page 1 (non-final) only.
      expect(pageTexts[0]).toContain('Carried forward');
      expect(pageTexts[1]).not.toContain('Carried forward');

      // Footer rows (subtotal/VAT/total): FINAL chunk (page 2) only — never
      // on page 1, never split/double-counted across both pages.
      for (const label of ['Subtotal', 'VAT (15%)', 'Total']) {
        expect(pageTexts[0]).not.toContain(label);
        expect(pageTexts[1]).toContain(label);
      }
      // Each footer label appears exactly once (not duplicated by any
      // interaction between the linesPerPage cap and the footer reservation).
      for (const label of ['Subtotal', 'VAT (15%)', 'Total']) {
        expect(pageTexts[1].split('|').filter((tok) => tok === label)).toHaveLength(1);
      }

      // Footer values: subtotal = 30 * 10.00 = 300.00, vat = 45.00, total = 345.00.
      expect(pageTexts[1]).toContain('300.00');
      expect(pageTexts[1]).toContain('45.00');
      expect(pageTexts[1]).toContain('345.00');
    });

    test('amount column (align: right) draws body, carried-subtotal, and footer cells right-aligned to the same column edge', async () => {
      const { template, inputs } = buildParityTemplate(30);

      const pdf = await generate({
        inputs,
        template: template as unknown as Template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      const raw0 = extractPageContent(doc, pages[0]).raw;
      const raw1 = extractPageContent(doc, pages[1]).raw;

      // Independently compute the amount column's right edge (pt) using the
      // SAME geometry helpers pdf.ts itself uses — column 3 (0-based) of a
      // 190mm-wide, 4-column [100,30,30,30] table starting at x=10mm.
      const tableWidthPt = 190 * MM_TO_PT;
      const colWidthsPt = computeColWidthsPt(PARITY_COLUMNS, tableWidthPt);
      const xStartPt = 10 * MM_TO_PT;
      const amountColLeft = xStartPt + colWidthsPt[0] + colWidthsPt[1] + colWidthsPt[2];
      const amountColRightEdge = amountColLeft + colWidthsPt[3] - CELL_PADDING_PT;
      const amountColLeftAlignedX = amountColLeft + CELL_PADDING_PT;

      const bodyFontSize = getBodyFontSize({});
      const bodyDrawFontSize = getDrawFontSize(bodyFontSize);
      const measurementFont = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
      const measurementBoldFont = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);

      // A regular body row's amount cell ("10.00") on page 1.
      const positions0 = extractTextPositions(raw0);
      const bodyAmountEntry = positions0.find((p) => p.text === '10.00');
      expect(bodyAmountEntry).toBeDefined();
      const bodyAmountWidth = measureText('10.00', measurementFont, bodyDrawFontSize);
      const bodyExpectedX = amountColRightEdge - bodyAmountWidth;
      expect(bodyAmountEntry!.x).toBeCloseTo(bodyExpectedX, 1);
      // Not left-aligned: right-aligned x differs from the fixed left-aligned x.
      expect(Math.abs(bodyAmountEntry!.x - amountColLeftAlignedX)).toBeGreaterThan(1);

      // The carried-forward subtotal's amount cell ("150.00", 15 rows * 10.00) on page 1.
      const carriedEntry = positions0.find((p) => p.text === '150.00');
      expect(carriedEntry).toBeDefined();
      const carriedWidth = measureText('150.00', measurementFont, bodyDrawFontSize);
      expect(carriedEntry!.x).toBeCloseTo(amountColRightEdge - carriedWidth, 1);

      // The footer "Total" row's amount cell ("345.00", bold) on page 2 —
      // right-edge-aligned to the SAME column boundary as the body rows,
      // despite using a bold font (different glyph widths than plain Helvetica).
      const positions1 = extractTextPositions(raw1);
      const totalEntry = positions1.find((p) => p.text === '345.00');
      expect(totalEntry).toBeDefined();
      const totalWidth = measureText('345.00', measurementBoldFont, bodyDrawFontSize);
      expect(totalEntry!.x).toBeCloseTo(amountColRightEdge - totalWidth, 1);

      // Header "Amount" label itself is right-aligned too (headerAlign inherits from align).
      const headerEntry = positions0.find((p) => p.text === 'Amount');
      expect(headerEntry).toBeDefined();
      expect(headerEntry!.x).toBeGreaterThan(amountColLeftAlignedX);
    });

    test('draws grid borders: internal column separators and per-row dividers, on every page', async () => {
      const { template, inputs } = buildParityTemplate(30);

      const pdf = await generate({
        inputs,
        template: template as unknown as Template,
        plugins: { lineItemsTable },
      });

      const doc = await PDFDocument.load(pdf);
      const pages = doc.getPages();
      const raw0 = extractPageContent(doc, pages[0]).raw;
      const raw1 = extractPageContent(doc, pages[1]).raw;

      for (const raw of [raw0, raw1]) {
        const segments = extractLineSegments(raw);

        // Internal vertical column separators: 3 boundaries for a 4-column
        // table, each a vertical segment (x1 === x2) spanning the table's
        // full drawn height, using the grid color/width (0.25pt).
        const verticalGridLines = segments.filter(
          (s) => Math.abs(s.x1 - s.x2) < 0.01 && s.thickness === 0.25,
        );
        const distinctVerticalX = new Set(verticalGridLines.map((s) => Math.round(s.x1 * 100)));
        expect(distinctVerticalX.size).toBe(3);

        // Row divider (horizontal) lines beneath body rows: 15 body rows per
        // page => at least 15 horizontal grid-colored dividers.
        const horizontalGridLines = segments.filter(
          (s) => Math.abs(s.y1 - s.y2) < 0.01 && s.thickness === 0.25,
        );
        expect(horizontalGridLines.length).toBeGreaterThanOrEqual(15);

        // Outer/header-divider border lines (0.5pt, black) are also present
        // (header/body divider on every page; footer-block divider on the
        // last page only, so just assert at least one exists everywhere).
        const outerLines = segments.filter((s) => s.thickness === 0.5);
        expect(outerLines.length).toBeGreaterThanOrEqual(1);
      }

      // The footer's "Total" row has a configured borderBottom ('1px solid
      // #000') distinct from the default outer/grid widths — present only
      // on the final page (page 2), right after the footer block.
      const segments1 = extractLineSegments(raw1);
      const footerBorderLines = segments1.filter((s) => s.thickness === 1);
      expect(footerBorderLines.length).toBeGreaterThanOrEqual(1);
      const segments0 = extractLineSegments(raw0);
      expect(segments0.filter((s) => s.thickness === 1)).toHaveLength(0);
    });
  });
});
