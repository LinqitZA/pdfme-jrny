/**
 * Page Number schema plugin
 *
 * Prints "Page X of Y" (or any custom format) on EVERY generated page —
 * unlike an ordinary schema element (which only appears on the page(s) it
 * is explicitly placed on and reflows/disappears once dynamic content like
 * a lineItemsTable pushes it around), a pageNumber element is meant to be
 * placed in `template.basePdf.staticSchema`, which the engine already
 * replicates across every output page.
 *
 * ── How "repeat on every page" + correct index/total works (NO new
 *    generator/common code needed — this reuses an existing mechanism) ──
 *
 * `@pdfme/generator`'s generate() (packages/generator/src/generate.ts)
 * loops once per FINAL output page (`for (let j = 0; j < basePages.length; j++)`,
 * where `basePages.length` is the true post-pagination page count for the
 * current input/document). Inside that loop, BEFORE the per-page named
 * schema loop, it already iterates `template.basePdf.staticSchema` and, for
 * any element with `readOnly: true`, evaluates `schema.content` through
 * `replacePlaceholders()` with
 * `variables: { ...input, totalPages: basePages.length, currentPage: j + 1 }`
 * — i.e. the current (1-based) page index and the final total page count
 * are already threaded through per page, for exactly this "static/repeats
 * on every page" class of element. The exact same mechanism (and the same
 * `totalPages`/`currentPage` variable names) is used by the Designer/Form/
 * Viewer live preview (packages/ui/src/components/StaticSchema.tsx and
 * packages/ui/src/components/Preview.tsx), so a pageNumber element behaves
 * identically in the live preview and the generated PDF.
 *
 * `replacePlaceholders()` (packages/common/src/expression.ts) uses this
 * repo's single-brace `{expr}` JS-expression placeholder syntax — NOT
 * mustache `{{ }}` — so the default format is `Page {currentPage} of
 * {totalPages}`, matching every other readOnly/content-templated element in
 * this codebase (see generate.ts's existing static/readOnly-schema
 * handling).
 *
 * Usage: add a pageNumber element to `template.basePdf.staticSchema` (not
 * the per-page `schemas[][]` list) with `readOnly: true`. It will then be
 * drawn on every page with `content` placeholder-substituted per page.
 *
 * ── Rendering (no new font/layout/drawing code) ──
 *
 * By the time a pageNumber schema reaches the renderer, `value` has already
 * been placeholder-substituted to the final string (e.g. "Page 2 of 5") by
 * generate.ts — so drawing it is *exactly* what the upstream `text` plugin
 * already does. This plugin's `pdf`/`ui` renderers are the upstream `text`
 * plugin's renderers, reused verbatim (imported from `@pdfme/schemas`) —
 * font embedding, alignment, wrapping, clipping, rotation, colour, etc. all
 * come from there, unmodified.
 */

import { text } from '@pdfme/schemas';
import type { PropPanelSchema } from '@pdfme/common';

/** Default format template. Uses this repo's `{expr}` placeholder syntax (see packages/common/src/expression.ts). */
export const PAGE_NUMBER_DEFAULT_FORMAT = 'Page {currentPage} of {totalPages}';

export interface PageNumberSchema {
  type: 'pageNumber';
  name: string;
  /** Format template, e.g. 'Page {currentPage} of {totalPages}'. Evaluated per page via replacePlaceholders(). */
  content: string;
  /** Must be true for the per-page currentPage/totalPages substitution to run (see generate.ts). */
  readOnly?: boolean;
  position: { x: number; y: number };
  width: number;
  height: number;
  fontSize?: number;
  fontName?: string;
  fontColor?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  [key: string]: unknown;
}

const PAGE_NUMBER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>';

/**
 * The pageNumber plugin definition.
 *
 * `pdf` and `ui` delegate entirely to the upstream `text` plugin's
 * renderers — a pageNumber schema is a plain text schema by render time
 * (its `content` template has already been substituted to a literal
 * string), so there is no bespoke drawing code here.
 */
export const pageNumber = {
  type: 'pageNumber' as const,

  pdf: text.pdf,

  ui: text.ui,

  propPanel: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- propPanelProps' real type
    // (PropPanelProps, minus rootElement) is not exported by @pdfme/common; passed through
    // verbatim to the upstream text plugin's schema() below, which is fully typed internally.
    schema: (propPanelProps: any) => {
      const textSchemaFn = text.propPanel.schema;
      const textFields: Record<string, PropPanelSchema> =
        typeof textSchemaFn === 'function'
          ? textSchemaFn(propPanelProps)
          : (textSchemaFn as Record<string, PropPanelSchema>);

      const formatField: Record<string, PropPanelSchema> = {
        content: {
          title: 'Format',
          type: 'string' as const,
          widget: 'inputText',
          props: { placeholder: PAGE_NUMBER_DEFAULT_FORMAT },
          span: 24,
        },
      };

      // Drop the upstream `formatter`/extra-formatter widget (multi-variable-text
      // concept) — irrelevant here, the format IS the content template.
      const { formatter: _formatter, ...restTextFields } = textFields;
      void _formatter;

      return { ...formatField, ...restTextFields };
    },

    widgets: text.propPanel.widgets,

    defaultSchema: {
      name: '',
      type: 'pageNumber',
      content: PAGE_NUMBER_DEFAULT_FORMAT,
      readOnly: true,
      position: { x: 0, y: 0 },
      width: 40,
      height: 8,
      rotate: 0,
      alignment: 'right' as const,
      verticalAlignment: 'middle' as const,
      fontSize: 9,
      lineHeight: 1,
      characterSpacing: 0,
      fontColor: '#000000',
      fontName: undefined,
      backgroundColor: '',
      opacity: 1,
      strikethrough: false,
      underline: false,
    },
  },

  icon: PAGE_NUMBER_ICON,
};
