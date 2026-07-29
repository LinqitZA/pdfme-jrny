/**
 * getDynamicHeights implementation for the lineItemsTable plugin.
 *
 * Registered on the plugin export (see index.ts) so @pdfme/generator's
 * generate() dispatches to this instead of the built-in fixed-single-height
 * path, letting lineItemsTable schemas paginate across pages the same way
 * the upstream `table` plugin does. Reference contract (matched exactly):
 *   - packages/schemas/src/tables/dynamicTemplate.ts (getDynamicHeightsForTable)
 *   - packages/common/src/dynamicTemplate.ts (getDynamicTemplate — the chunker
 *     that consumes this return value and sets __bodyRange/__isSplit)
 *
 * Row/header height math itself lives in ./rowHeights.ts and is shared with
 * pdf.ts so the two can never drift.
 */

import { PDFDocument, StandardFonts } from '@pdfme/pdf-lib';
import { isBlankPdf } from '@pdfme/common';
import type { Schema, BasePdf, BlankPdf, CommonOptions } from '@pdfme/common';
import {
  MM_TO_PT,
  computeColWidthsPt,
  computeWrappedRows,
  computeHeaderHeightPt,
  getHeaderFontSize,
  getBodyFontSize,
  type LineItemsTableGeometrySchema,
  type PdfColumn,
} from './rowHeights';

const MEASUREMENT_FONT_CACHE_KEY = '__lineItemsTable_measurementFont';

/**
 * Lazily create (and cache via the `_cache` Map the generator passes through
 * for the lifetime of a single generate() call) a standalone Helvetica font
 * for text-width measurement.
 *
 * getDynamicHeights runs inside getDynamicTemplate, BEFORE the generator's
 * real PDFDocument/page exist (see generate.ts: preprocessing() creates
 * pdfDoc, then getDynamicTemplate() is called, then pages are created and
 * plugin.pdf() is invoked per page) — so unlike pdf.ts, which reuses the
 * render-time pdfDoc/pdfLib passed to it, we have no PDFDocument to embed a
 * font into here. We embed our own throwaway one purely for measurement.
 * Standard-14 font (AFM) metrics are static data independent of which
 * PDFDocument embedded them, so widthOfTextAtSize() on this font returns
 * IDENTICAL widths to the font pdf.ts embeds at render time — no drift.
 */
function getMeasurementFont(cache: Map<string | number, unknown>): Promise<any> {
  const cached = cache.get(MEASUREMENT_FONT_CACHE_KEY);
  if (cached) return cached as Promise<any>;
  const fontPromise = PDFDocument.create().then((doc) => doc.embedFont(StandardFonts.Helvetica));
  cache.set(MEASUREMENT_FONT_CACHE_KEY, fontPromise);
  return fontPromise;
}

function parseBodyRows(value: string): string[][] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Floating point tolerance, matches getDynamicHeightsForTable's SAFETY_MARGIN. */
const SAFETY_MARGIN = 0.5;

/**
 * Mirrors getDynamicHeightsForTable's repeat-header simulation
 * (packages/schemas/src/tables/dynamicTemplate.ts lines ~37-87), adapted to
 * operate on a generic [headerHeight, ...bodyRowHeights] array instead of
 * the base table's internal Row/Column classes — @pdfme/schemas is upstream
 * and is not modified/imported into here for this purpose, so the
 * page-simulation algorithm is reproduced verbatim against plain numbers.
 *
 * Simulates walking the header + body rows down the page, inserting the
 * header height in front of the first body row of every page after the
 * first (when `foldHeader` is on), so getDynamicTemplate's chunker reserves
 * the right amount of space for the repeated header when it splits the
 * schema across pages.
 *
 * Also enforces an optional `linesPerPageCap`: a hard limit on how many body
 * rows may land on one page, independent of remaining height. The engine's
 * real chunker (placeRowsOnPages in packages/common/src/dynamicTemplate.ts)
 * only ever sees the flat heights array this function returns and re-derives
 * page fit purely from summing those numbers — it has no notion of "row
 * count". So the cap is enforced here by INFLATING the height of the last
 * body row allowed on a page (once the cap is hit) so it consumes the rest
 * of that page's content height; the real chunker then finds no room left
 * for the next row and rolls it onto a new page, exactly as if the cap row
 * had genuinely been that tall. This is purely a chunking signal — pdf.ts
 * never reads this returned array; it recomputes each row's true height
 * independently via computeWrappedRows, so the inflated number here can
 * never corrupt what actually gets drawn. The effective break point is
 * therefore min(linesPerPageCap, height-fit): if the natural height-based
 * packing would already have broken the page before the cap is reached,
 * bodyRowsOnCurrentPage resets first and the cap logic never fires early.
 */
function applyPageBreakSimulation(
  baseHeights: number[],
  headerHeight: number,
  headRowCount: number,
  schema: Pick<Schema, 'position'>,
  basePdf: BlankPdf,
  opts: { foldHeader: boolean; linesPerPageCap?: number },
): number[] {
  const [paddingTop, , paddingBottom] = basePdf.padding;
  const pageContentHeight = basePdf.height - paddingTop - paddingBottom;
  const getPageStartY = (pageIndex: number) => pageIndex * pageContentHeight + paddingTop;

  const initialPageIndex = Math.max(
    0,
    Math.floor((schema.position.y - paddingTop) / pageContentHeight),
  );

  const cap =
    opts.linesPerPageCap !== undefined && opts.linesPerPageCap > 0
      ? opts.linesPerPageCap
      : undefined;

  let currentPageIndex = initialPageIndex;
  let currentPageY = schema.position.y;
  let rowsOnCurrentPage = 0;
  let bodyRowsOnCurrentPage = 0;

  const result: number[] = [];

  for (let i = 0; i < baseHeights.length; i++) {
    const isBodyRow = i >= headRowCount;
    const rowHeight = baseHeights[i];

    while (true) {
      const currentPageStartY = getPageStartY(currentPageIndex);
      const remainingHeight = currentPageStartY + pageContentHeight - currentPageY;
      const needsHeader =
        opts.foldHeader &&
        isBodyRow &&
        rowsOnCurrentPage === 0 &&
        currentPageIndex > initialPageIndex;
      const totalRowHeight = rowHeight + (needsHeader ? headerHeight : 0);

      if (totalRowHeight > remainingHeight - SAFETY_MARGIN) {
        if (
          rowsOnCurrentPage === 0 &&
          Math.abs(currentPageY - currentPageStartY) < SAFETY_MARGIN
        ) {
          result.push(totalRowHeight);
          currentPageY += totalRowHeight;
          rowsOnCurrentPage++;
          if (isBodyRow) bodyRowsOnCurrentPage++;
          break;
        }
        currentPageIndex++;
        currentPageY = getPageStartY(currentPageIndex);
        rowsOnCurrentPage = 0;
        bodyRowsOnCurrentPage = 0;
        continue;
      }

      result.push(totalRowHeight);
      currentPageY += totalRowHeight;
      rowsOnCurrentPage++;
      if (isBodyRow) bodyRowsOnCurrentPage++;

      const atPageBottom = currentPageY >= currentPageStartY + pageContentHeight - SAFETY_MARGIN;
      const hasMoreRows = i < baseHeights.length - 1;
      const capHit = cap !== undefined && isBodyRow && bodyRowsOnCurrentPage >= cap && hasMoreRows;

      if (atPageBottom || capHit) {
        if (capHit && !atPageBottom) {
          // Force the break: pad the row we just pushed out to the page
          // boundary so the real chunker (which only sees these numbers)
          // concludes this page is full.
          const leftover = currentPageStartY + pageContentHeight - currentPageY;
          if (leftover > SAFETY_MARGIN) {
            result[result.length - 1] += leftover;
            currentPageY += leftover;
          }
        }
        currentPageIndex++;
        currentPageY = getPageStartY(currentPageIndex);
        rowsOnCurrentPage = 0;
        bodyRowsOnCurrentPage = 0;
      }
      break;
    }
  }

  return result;
}

/**
 * Plugin.getDynamicHeights implementation for lineItemsTable.
 *
 * Contract (mirrors getDynamicHeightsForTable exactly):
 *  - Returns [headerHeight, bodyRow0Height, bodyRow1Height, ...] in mm (the
 *    same units as schema.height/position — NOT pt).
 *  - Index 0 is always the header slot: the real header height when
 *    showHeader is on, else 0 (mirrors the base table's
 *    `schema.showHead ? ... : [0].concat(...)`).
 *  - When repeatHeader is on (and the base PDF is a blank/paginated one),
 *    the header height is folded into the first body row height of every
 *    page after the first, so @pdfme/common's getDynamicTemplate reserves
 *    space for the repeated header when it chunks pages and sets
 *    schema.__bodyRange / schema.__isSplit accordingly.
 */
export async function getLineItemsTableDynamicHeights(
  value: string,
  args: {
    schema: Schema;
    basePdf: BasePdf;
    options: CommonOptions;
    _cache: Map<string | number, unknown>;
  },
): Promise<number[]> {
  const schema = args.schema as unknown as LineItemsTableGeometrySchema & Schema;
  const columns: PdfColumn[] = schema.columns || [];

  if (columns.length === 0) {
    // Nothing to lay out — behave like an ordinary fixed-height element.
    return [schema.height];
  }

  const showHeader = schema.showHeader !== false;
  const repeatHeader = schema.repeatHeader !== false;
  const widthMm = schema.width || 190;

  // Clamp to >= 1 at use: 0/negative/non-integer configuration values are
  // treated as "no cap" rather than silently misbehaving.
  const linesPerPageCap =
    schema.linesPerPage != null && Number.isFinite(schema.linesPerPage)
      ? Math.max(1, Math.floor(schema.linesPerPage))
      : undefined;

  const bodyRows = parseBodyRows(value);

  const tableWidthPt = widthMm * MM_TO_PT;
  const colWidthsPt = computeColWidthsPt(columns, tableWidthPt);
  const bodyFontSize = getBodyFontSize(schema);
  const headerFontSize = getHeaderFontSize(schema);

  const font = await getMeasurementFont(args._cache);
  const wrappedRows = computeWrappedRows(bodyRows, columns, colWidthsPt, font, bodyFontSize);

  const headerHeightPt = showHeader ? computeHeaderHeightPt(headerFontSize) : 0;
  const headerHeightMm = headerHeightPt / MM_TO_PT;
  const bodyHeightsMm = wrappedRows.map((r) => r.height / MM_TO_PT);

  const baseHeights = [headerHeightMm, ...bodyHeightsMm];

  const shouldRepeatHeader =
    repeatHeader && showHeader && isBlankPdf(args.basePdf) && headerHeightMm > 0;
  const shouldEnforceCap = linesPerPageCap !== undefined && isBlankPdf(args.basePdf);

  if (!shouldRepeatHeader && !shouldEnforceCap) {
    return baseHeights;
  }

  return applyPageBreakSimulation(
    baseHeights,
    headerHeightMm,
    1, // exactly one header "row" occupies index 0
    schema,
    args.basePdf as BlankPdf,
    { foldHeader: shouldRepeatHeader, linesPerPageCap: linesPerPageCap },
  );
}
