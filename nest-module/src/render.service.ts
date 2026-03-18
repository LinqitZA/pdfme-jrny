/**
 * RenderService - PDF generation pipeline
 *
 * Pipeline: Fetch published template -> resolve inputs -> pdfme generate() ->
 *   SHA-256 hash -> FileStorageService store -> GeneratedDocument record
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import * as crypto from 'crypto';
import { templates, generatedDocuments } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { FileStorageService } from './file-storage.service';

export interface RenderNowDto {
  templateId: string;
  entityId: string;
  entityType?: string;
  channel: string;
  inputs?: Record<string, string>[];
}

@Injectable()
export class RenderService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly fileStorage: FileStorageService,
  ) {}

  /**
   * Synchronous render: generates a PDF immediately and returns the document record.
   */
  async renderNow(dto: RenderNowDto, orgId: string, userId: string) {
    // 1. Fetch the published template
    const [template] = await this.db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, dto.templateId),
          eq(templates.status, 'published'),
        ),
      );

    if (!template) {
      return { error: 'Template not found or not published' };
    }

    // 2. Build pdfme template structure from the stored schema
    const templateSchema = template.schema as Record<string, unknown>;
    const pdfmeTemplate = this.buildPdfmeTemplate(templateSchema);

    // 3. Resolve inputs - use provided inputs or create empty inputs
    const inputs = dto.inputs && dto.inputs.length > 0
      ? dto.inputs
      : [this.buildEmptyInputs(pdfmeTemplate)];

    // 4. Generate PDF using @pdfme/generator
    let pdfBuffer: Uint8Array;
    try {
      const { generate } = await import('@pdfme/generator');
      const schemas = await import('@pdfme/schemas');

      // Build plugins map from all available schemas
      const plugins = {
        text: schemas.text,
        image: schemas.image,
        table: schemas.table,
        line: schemas.line,
        rectangle: schemas.rectangle,
        ellipse: schemas.ellipse,
        svg: schemas.svg,
        multiVariableText: schemas.multiVariableText,
        dateTime: schemas.dateTime,
        date: schemas.date,
        time: schemas.time,
        select: schemas.select,
        radioGroup: schemas.radioGroup,
        checkbox: schemas.checkbox,
        ...schemas.barcodes,
      };

      pdfBuffer = await generate({
        template: pdfmeTemplate,
        inputs,
        plugins,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Create a failed document record
      const docId = createId();
      const [failedDoc] = await this.db
        .insert(generatedDocuments)
        .values({
          id: docId,
          orgId,
          templateId: dto.templateId,
          templateVer: template.version,
          entityType: dto.entityType || template.type,
          entityId: dto.entityId,
          filePath: '',
          pdfHash: '',
          status: 'failed',
          outputChannel: dto.channel,
          triggeredBy: userId,
          inputSnapshot: dto.inputs || null,
          errorMessage: errorMessage,
        })
        .returning();
      return { error: errorMessage, document: failedDoc };
    }

    // 5. Compute SHA-256 hash
    const pdfHash = crypto
      .createHash('sha256')
      .update(pdfBuffer)
      .digest('hex');

    // 6. Store PDF via FileStorageService
    const docId = createId();
    const filePath = `${orgId}/documents/${docId}.pdf`;
    await this.fileStorage.write(filePath, Buffer.from(pdfBuffer));

    // 7. Create GeneratedDocument record
    const [document] = await this.db
      .insert(generatedDocuments)
      .values({
        id: docId,
        orgId,
        templateId: dto.templateId,
        templateVer: template.version,
        entityType: dto.entityType || template.type,
        entityId: dto.entityId,
        filePath,
        pdfHash,
        status: 'done',
        outputChannel: dto.channel,
        triggeredBy: userId,
        inputSnapshot: dto.inputs || null,
      })
      .returning();

    return { document };
  }

  /**
   * Build a pdfme-compatible Template object from stored schema JSON.
   * If the schema is already a full pdfme template (has basePdf + schemas),
   * use it directly. Otherwise wrap it in a minimal template.
   */
  private buildPdfmeTemplate(schema: Record<string, unknown>): {
    basePdf: unknown;
    schemas: unknown[];
  } {
    if (schema.basePdf && schema.schemas) {
      return schema as { basePdf: unknown; schemas: unknown[] };
    }

    // Wrap in a minimal A4 blank template
    return {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: schema.schemas
        ? (schema.schemas as unknown[])
        : [[]],
    };
  }

  /**
   * Build empty inputs from template schemas (one empty string per field).
   */
  private buildEmptyInputs(
    template: { schemas: unknown[] },
  ): Record<string, string> {
    const inputs: Record<string, string> = {};
    if (Array.isArray(template.schemas)) {
      for (const page of template.schemas) {
        if (Array.isArray(page)) {
          for (const field of page) {
            if (field && typeof field === 'object' && 'name' in field) {
              inputs[(field as { name: string }).name] = '';
            }
          }
        }
      }
    }
    return inputs;
  }
}
