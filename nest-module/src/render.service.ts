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
import { SignatureService } from './signature.service';

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
    private readonly signatureService: SignatureService,
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

    // 3b. Resolve drawnSignature fields - fetch user's signature PNG and embed as base64
    await this.resolveDrawnSignatures(pdfmeTemplate, inputs, orgId, userId);

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
        // ERP custom: drawnSignature uses image plugin for PDF rendering
        // (signature data resolved to base64 in step 3b above)
        drawnSignature: schemas.image,
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

  /**
   * Resolve drawnSignature fields in the template.
   * Scans template schemas for drawnSignature type fields, fetches the user's
   * signature PNG from storage, and replaces input values with base64 data URIs.
   * Also converts the schema type to 'image' for pdfme compatibility.
   */
  private async resolveDrawnSignatures(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    inputs: Record<string, string>[],
    orgId: string,
    userId: string,
  ): Promise<void> {
    // Find all drawnSignature fields in the template
    const signatureFieldNames: string[] = [];

    if (Array.isArray(pdfmeTemplate.schemas)) {
      for (const page of pdfmeTemplate.schemas) {
        if (Array.isArray(page)) {
          for (const field of page) {
            if (
              field &&
              typeof field === 'object' &&
              'type' in field &&
              (field as { type: string }).type === 'drawnSignature' &&
              'name' in field
            ) {
              signatureFieldNames.push((field as { name: string }).name);
              // Convert type to 'image' for pdfme compatibility
              (field as { type: string }).type = 'image';
            }
          }
        }
      }
    }

    if (signatureFieldNames.length === 0) return;

    // Fetch the user's current signature
    let signatureDataUri = '';
    try {
      const signature = await this.signatureService.getMySignature(orgId, userId);
      if (signature) {
        const fileExists = await this.signatureService.signatureFileExists(signature.filePath);
        if (fileExists) {
          const pngBuffer = await this.signatureService.readSignatureFile(signature.filePath);
          if (pngBuffer && pngBuffer.length > 0) {
            signatureDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
          }
        }
      }
    } catch {
      // Signature not found - use fallback (empty)
    }

    // Set the signature data in all input records
    for (const inputRecord of inputs) {
      for (const fieldName of signatureFieldNames) {
        inputRecord[fieldName] = signatureDataUri;
      }
    }
  }
}
