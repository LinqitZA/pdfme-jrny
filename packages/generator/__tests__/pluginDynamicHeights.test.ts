import { PDFDocument } from '@pdfme/pdf-lib';
import generate from '../src/generate.js';
import { Template, BLANK_A4_PDF, Schema, Plugin } from '@pdfme/common';

describe('plugin.getDynamicHeights dispatch', () => {
  const baseSchema: Schema = {
    name: 'items',
    type: 'customDynamic',
    content: '',
    position: { x: 10, y: 10 },
    width: 190,
    height: 50,
  };

  const noopPlugin: Omit<Plugin, 'getDynamicHeights'> = {
    pdf: async () => {},
    ui: async () => {},
    propPanel: {
      schema: {},
      defaultSchema: { ...baseSchema },
    },
  };

  test('a plugin exposing getDynamicHeights is dispatched to and paginates across pages', async () => {
    // A4 blank pdf content height is 297 - 10 - 10 = 277mm. Two 150mm rows can't
    // fit on the same page, so if the plugin's getDynamicHeights is actually
    // being called, the generator must split the schema onto 2 pages.
    const plugin: Plugin = {
      ...noopPlugin,
      getDynamicHeights: async () => [150, 150],
    };

    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [[baseSchema]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: { customDynamic: plugin },
    });

    const pdfDoc = await PDFDocument.load(pdf);
    expect(pdfDoc.getPageCount()).toBe(2);
  });

  test('a plugin without getDynamicHeights falls back to the default (single-height) path', async () => {
    const plugin: Plugin = { ...noopPlugin };

    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [[baseSchema]],
    };

    const pdf = await generate({
      inputs: [{}],
      template,
      plugins: { customDynamic: plugin },
    });

    const pdfDoc = await PDFDocument.load(pdf);
    expect(pdfDoc.getPageCount()).toBe(1);
  });
});
