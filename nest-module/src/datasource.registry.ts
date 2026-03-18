/**
 * DataSourceRegistry - Registry for document type data sources
 *
 * Each document/report type registers a DataSource implementation.
 * Host ERP registers DataSources at module initialisation.
 */

import type { DataSource } from './types';

export class DataSourceRegistry {
  private sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    this.sources.set(source.templateType, source);
  }

  resolve(templateType: string): DataSource | undefined {
    return this.sources.get(templateType);
  }

  has(templateType: string): boolean {
    return this.sources.has(templateType);
  }
}
