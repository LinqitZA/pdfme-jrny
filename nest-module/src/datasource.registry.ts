/**
 * DataSourceRegistry - Registry for document type data sources
 *
 * Each document/report type registers a DataSource implementation.
 * Host ERP registers DataSources at module initialisation.
 *
 * Usage:
 *   registry.register({ templateType: 'invoice', resolve: async (entityId, orgId) => [...] });
 *   const ds = registry.resolve('invoice'); // returns the DataSource
 *   registry.resolve('unknown'); // throws Error
 */

import { Injectable } from '@nestjs/common';
import type { DataSource } from './types';

@Injectable()
export class DataSourceRegistry {
  private sources = new Map<string, DataSource>();

  /**
   * Register a DataSource for a template type.
   * Overwrites any existing registration for the same type.
   */
  register(source: DataSource): void {
    this.sources.set(source.templateType, source);
  }

  /**
   * Resolve a DataSource by template type.
   * Throws an Error if no DataSource is registered for the given type.
   */
  resolve(templateType: string): DataSource {
    const source = this.sources.get(templateType);
    if (!source) {
      throw new Error(
        `No DataSource registered for template type "${templateType}". ` +
        `Registered types: [${this.getRegisteredTypes().join(', ')}]`,
      );
    }
    return source;
  }

  /**
   * Check if a DataSource is registered for a template type.
   */
  has(templateType: string): boolean {
    return this.sources.has(templateType);
  }

  /**
   * Get all registered template types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * Unregister a DataSource for a template type.
   * Returns true if a DataSource was removed, false if none existed.
   */
  unregister(templateType: string): boolean {
    return this.sources.delete(templateType);
  }
}
