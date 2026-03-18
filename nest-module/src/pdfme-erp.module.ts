/**
 * PdfmeErpModule - NestJS module for pdfme ERP Edition
 *
 * Usage:
 * PdfmeErpModule.register({
 *   storage: { rootDir, tempDir, tempRetentionMinutes },
 *   jwt: { secret, algorithm, claimsMapping },
 *   redis: { host, port },
 *   database: { drizzleClient },
 *   apiPrefix: '/api/pdfme',
 *   ...
 * })
 */

import type { PdfmeErpModuleConfig } from './types';

export class PdfmeErpModule {
  static register(_config: PdfmeErpModuleConfig) {
    // To be implemented by coding agents
    // Will register all services, controllers, and middleware
    throw new Error('Not implemented');
  }
}
