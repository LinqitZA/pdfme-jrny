/**
 * ConfigController - Configuration endpoint for frontend clients
 *
 * GET /api/pdfme/config
 * Returns fonts, locale configuration, and feature flags.
 * Requires authentication (JWT).
 */

import { Controller, Get } from '@nestjs/common';

@Controller('api/pdfme')
export class ConfigController {
  @Get('config')
  getConfig() {
    return {
      fonts: [
        {
          name: 'Helvetica',
          label: 'Helvetica',
          default: true,
        },
        {
          name: 'Times-Roman',
          label: 'Times New Roman',
          default: false,
        },
        {
          name: 'Courier',
          label: 'Courier',
          default: false,
        },
      ],
      locale: {
        locale: 'en-ZA',
        currency: {
          code: 'ZAR',
          symbol: 'R',
          position: 'before' as const,
          thousandSeparator: ' ',
          decimalSeparator: '.',
          decimalPlaces: 2,
        },
        date: {
          shortFormat: 'yyyy-MM-dd',
          longFormat: 'dd MMMM yyyy',
        },
        number: {
          thousandSeparator: ' ',
          decimalSeparator: '.',
        },
      },
      features: {
        pdfA: false,
        bulkRender: true,
        signatures: true,
        expressionEngine: true,
        richText: false,
        watermark: true,
      },
    };
  }
}
