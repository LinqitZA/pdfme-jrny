/**
 * FieldSchemaController - Serves field schema definitions per template type
 *
 * GET /api/pdfme/field-schema/:templateType
 * Returns field groups with key, label, type for each field.
 * Used by the designer Fields tab to show available data bindings.
 */

import { Controller, Get, Param, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { FieldSchemaRegistry } from './field-schema.registry';

@Controller('api/pdfme/field-schema')
export class FieldSchemaController {
  constructor(
    @Inject('FIELD_SCHEMA_REGISTRY') private readonly registry: FieldSchemaRegistry,
  ) {}

  @Get(':templateType')
  getFieldSchema(@Param('templateType') templateType: string) {
    const fieldGroups = this.registry.resolve(templateType);

    if (!fieldGroups) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: `No field schema registered for template type: ${templateType}`,
          timestamp: new Date().toISOString(),
          path: `/api/pdfme/field-schema/${templateType}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      templateType,
      fieldGroups,
    };
  }
}
