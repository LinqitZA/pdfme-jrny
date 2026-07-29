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
import { PDFDocument, PDFArray, PDFName } from '@pdfme/pdf-lib';
import { text as textPlugin } from '@pdfme/schemas';
import { lineItemsTable } from './index';
import { getLineItemsTableDynamicHeights } from './dynamicHeights';
import { computeHeaderHeightPt, MM_TO_PT } from './rowHeights';

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
});
