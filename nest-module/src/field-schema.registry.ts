/**
 * FieldSchemaRegistry - Registry for template type field schemas
 *
 * Field schemas registered per template type, served via
 * GET /api/pdfme/field-schema/:templateType
 */

import type { FieldGroup } from '@pdfme-erp/schemas';

export class FieldSchemaRegistry {
  private schemas = new Map<string, FieldGroup[]>();

  register(templateType: string, fieldGroups: FieldGroup[]): void {
    this.schemas.set(templateType, fieldGroups);
  }

  resolve(templateType: string): FieldGroup[] | undefined {
    return this.schemas.get(templateType);
  }

  has(templateType: string): boolean {
    return this.schemas.has(templateType);
  }
}
