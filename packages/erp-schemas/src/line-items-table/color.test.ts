/**
 * Colour parsing for the lineItemsTable PDF renderer.
 *
 * The prop panel exposes two colour pickers (`alternateRowColor` and
 * `headerStyle.backgroundColor`) through form-render's `color` widget, and that
 * widget can store a CSS `rgb(...)` string rather than hex — a live quotation
 * template in dev holds `"rgb(3,115,227)"`. The editor preview assigns the value
 * straight to `element.style.backgroundColor`, where CSS accepts it, so the
 * template looks correct right up until the PDF is generated.
 *
 * At render time the value goes through this parser and then into
 * `pdfLib.rgb()`, which asserts its arguments are numbers. A hex-only parser
 * turns `"rgb(3,115,227)"` into NaN and the whole document fails with
 * "`red` must be of type `number`, but was actually of type `NaN`" — and only
 * on documents with a SECOND body row, because the alternating shade is drawn
 * from row index 1. That is the bug these tests exist to keep fixed.
 */

import { parseColor } from './rowHeights';

/** pdf-lib's own precondition: every component must be a number in [0, 1]. */
function expectDrawable(color: { r: number; g: number; b: number }) {
  for (const component of [color.r, color.g, color.b]) {
    expect(Number.isFinite(component)).toBe(true);
    expect(component).toBeGreaterThanOrEqual(0);
    expect(component).toBeLessThanOrEqual(1);
  }
}

describe('parseColor', () => {
  it('parses the rgb() string the colour picker actually stored', () => {
    const color = parseColor('rgb(3,115,227)');

    expect(color.r).toBeCloseTo(3 / 255, 6);
    expect(color.g).toBeCloseTo(115 / 255, 6);
    expect(color.b).toBeCloseTo(227 / 255, 6);
  });

  it('tolerates the spacing a browser-normalised rgb() string carries', () => {
    expect(parseColor('rgb(3, 115, 227)')).toEqual(parseColor('rgb(3,115,227)'));
  });

  it('parses rgba(), ignoring the alpha the picker is configured not to use', () => {
    // props: { disabledAlpha: true } on the widget, so alpha is always 1 — but the
    // string form still carries it, and dropping the channel must not shift the others.
    expect(parseColor('rgba(3, 115, 227, 1)')).toEqual(parseColor('rgb(3,115,227)'));
  });

  it('still parses six-digit hex, which is what every untouched default is', () => {
    const color = parseColor('#1a1a2e');

    expect(color.r).toBeCloseTo(0x1a / 255, 6);
    expect(color.g).toBeCloseTo(0x1a / 255, 6);
    expect(color.b).toBeCloseTo(0x2e / 255, 6);
  });

  it('still expands three-digit hex, which footer border styles use', () => {
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('accepts hex without the leading #', () => {
    expect(parseColor('1a1a2e')).toEqual(parseColor('#1a1a2e'));
  });

  it('is case-insensitive', () => {
    expect(parseColor('#1A1A2E')).toEqual(parseColor('#1a1a2e'));
    expect(parseColor('RGB(3,115,227)')).toEqual(parseColor('rgb(3,115,227)'));
  });

  it('never hands NaN to pdf-lib, whatever the schema holds', () => {
    // A colour is decoration. Failing an entire document because one property holds
    // a string this parser does not recognise trades a cosmetic defect for a
    // customer-facing outage, so an unparseable value falls back instead.
    for (const value of ['', '   ', 'transparent', 'cornflowerblue', 'rgb()', '#12345', 'null']) {
      expectDrawable(parseColor(value));
    }
  });

  it('uses the fallback the caller supplies when it cannot parse', () => {
    // Each call site already knows what "unset" should look like — a grid line wants
    // grey, an alternating row wants near-white — so the fallback belongs to the caller
    // rather than to one global default that is wrong for most of them.
    expect(parseColor('not a colour', '#f7fafc')).toEqual(parseColor('#f7fafc'));
  });

  it('clamps out-of-range rgb() components rather than passing them through', () => {
    // pdf-lib rejects anything outside [0, 1]; a hand-edited schema can hold 300.
    expectDrawable(parseColor('rgb(300, -20, 115)'));
  });
});
