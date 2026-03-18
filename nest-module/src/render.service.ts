/**
 * RenderService - PDF generation pipeline
 *
 * Pipeline: Fetch published template -> resolve inputs -> pdfme generate() ->
 *   SHA-256 hash -> FileStorageService store -> GeneratedDocument record
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import * as crypto from 'crypto';
import { templates, generatedDocuments, renderBatches } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { FileStorageService } from './file-storage.service';
import { SignatureService } from './signature.service';
import { EventEmitter } from 'events';
import { resolveLineItemsTables } from '../../packages/erp-schemas/src/line-items-table';
import { extractWatermarkFromTemplate, applyWatermark } from '../../packages/erp-schemas/src/watermark';
import { resolveRichText, applyRichText, RichTextRenderInfo } from '../../packages/erp-schemas/src/rich-text';
import { resolveQrBarcodes } from '../../packages/erp-schemas/src/qr-barcode';
import { resolveErpImages } from '../../packages/erp-schemas/src/erp-image';
import { resolveSignatureBlocks, applySignatureBlocks, SignatureBlockRenderInfo } from '../../packages/erp-schemas/src/signature-block';
import { resolveCalculatedFields } from '../../packages/erp-schemas/src/calculated-field';

export interface RenderNowDto {
  templateId: string;
  entityId: string;
  entityType?: string;
  channel: string;
  inputs?: Record<string, string>[];
}

export interface RenderBulkDto {
  templateId: string;
  entityIds: string[];
  entityType?: string;
  channel: string;
  onFailure?: 'continue' | 'abort';
  notifyUrl?: string;
  inputs?: Record<string, string>[];
}

@Injectable()
export class RenderService {
  /** EventEmitter for SSE progress streams, keyed by batchId */
  public readonly batchEvents = new EventEmitter();

  /** Track document IDs per batch for merge operations */
  private batchDocuments = new Map<string, string[]>();

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly fileStorage: FileStorageService,
    private readonly signatureService: SignatureService,
  ) {
    // Allow many listeners (one per SSE client)
    this.batchEvents.setMaxListeners(100);
  }

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
    let pdfmeTemplate = this.buildPdfmeTemplate(templateSchema);

    // 3. Resolve inputs - use provided inputs or create empty inputs
    let inputs = dto.inputs && dto.inputs.length > 0
      ? dto.inputs
      : [this.buildEmptyInputs(pdfmeTemplate)];

    // 3b. Resolve drawnSignature fields - fetch user's signature PNG and embed as base64
    await this.resolveDrawnSignatures(pdfmeTemplate, inputs, orgId, userId);

    // 3b2. Resolve erpImage elements - fetch from FileStorageService and convert to base64
    const erpImageResult = await resolveErpImages(pdfmeTemplate, inputs, {
      readFile: (p: string) => this.fileStorage.read(p),
      fileExists: (p: string) => this.fileStorage.exists(p),
      listFiles: (p: string) => this.fileStorage.list(p),
      orgId,
    });
    pdfmeTemplate = erpImageResult.template as typeof pdfmeTemplate;
    inputs = erpImageResult.inputs;

    // 3c. Resolve lineItemsTable elements - convert to standard table with footer rows
    const resolvedLit = resolveLineItemsTables(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedLit.template as typeof pdfmeTemplate;
    inputs = resolvedLit.inputs;

    // 3d. Resolve qrBarcode elements - convert to standard pdfme qrcode with URL bindings
    const resolvedQr = resolveQrBarcodes(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedQr.template as typeof pdfmeTemplate;
    inputs = resolvedQr.inputs;

    // 3e. Resolve richText elements - extract for post-processing via pdf-lib
    const richTextResult = resolveRichText(pdfmeTemplate, inputs);
    pdfmeTemplate = richTextResult.template as typeof pdfmeTemplate;
    inputs = richTextResult.inputs;
    const richTextInfo: RichTextRenderInfo[] = richTextResult.richTextInfo;

    // 3e2. Resolve signatureBlock elements - extract for post-processing via pdf-lib
    const sigBlockResult = resolveSignatureBlocks(pdfmeTemplate, inputs);
    pdfmeTemplate = sigBlockResult.template as typeof pdfmeTemplate;
    inputs = sigBlockResult.inputs;
    const signatureBlockInfo: SignatureBlockRenderInfo[] = sigBlockResult.signatureBlockInfo;

    // 3f. Resolve page scopes - filter elements by first/last/all/notFirst
    this.resolvePageScopes(pdfmeTemplate);

    // 3g. Resolve conditions - hide elements based on fieldNonEmpty/expression conditions
    this.resolveConditions(pdfmeTemplate, inputs);

    // 3g2. Resolve output channel filtering - remove elements not matching the requested channel
    this.resolveOutputChannels(pdfmeTemplate, dto.channel);

    // 3h. Resolve calculatedField elements - evaluate expressions and convert to text
    const resolvedCalc = resolveCalculatedFields(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedCalc.template as typeof pdfmeTemplate;
    inputs = resolvedCalc.inputs;

    // 3i. Extract watermark config (if any watermark element exists in template)
    const watermarkConfig = extractWatermarkFromTemplate(pdfmeTemplate.schemas, inputs);

    // 3i. Always remove watermark elements from schemas (pdfme doesn't know about them)
    // This must happen regardless of whether watermarkConfig is set (e.g. variable='' hides watermark)
    pdfmeTemplate.schemas = pdfmeTemplate.schemas.map((page: unknown) => {
      if (!Array.isArray(page)) return page;
      return page.filter((field: unknown) => {
        if (field && typeof field === 'object' && 'type' in field) {
          return (field as { type: string }).type !== 'watermark';
        }
        return true;
      });
    });

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

    // 4b. Apply rich text rendering via pdf-lib (post-processing)
    if (richTextInfo.length > 0) {
      try {
        pdfBuffer = await applyRichText(pdfBuffer, richTextInfo);
      } catch (err: unknown) {
        console.error('Rich text rendering failed:', err);
        // Continue without rich text rather than failing the entire render
      }
    }

    // 4b2. Apply signature block rendering via pdf-lib (post-processing)
    if (signatureBlockInfo.length > 0) {
      try {
        pdfBuffer = await applySignatureBlocks(pdfBuffer, signatureBlockInfo);
      } catch (err: unknown) {
        console.error('Signature block rendering failed:', err);
      }
    }

    // 4c. Apply watermark overlay if configured
    if (watermarkConfig) {
      try {
        pdfBuffer = await applyWatermark(pdfBuffer, watermarkConfig);
      } catch (err: unknown) {
        console.error('Watermark application failed:', err);
        // Continue without watermark rather than failing the entire render
      }
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
        inputSnapshot: inputs || dto.inputs || null,
      })
      .returning();

    return { document };
  }

  /**
   * Bulk render: creates a RenderBatch record, then processes each entityId asynchronously.
   * Returns immediately with 202 and the batchId.
   */
  async renderBulk(dto: RenderBulkDto, orgId: string, userId: string) {
    const batchId = createId();
    const onFailure = dto.onFailure || 'continue';

    // Create batch record
    const [batch] = await this.db
      .insert(renderBatches)
      .values({
        id: batchId,
        orgId,
        templateType: dto.entityType || 'document',
        channel: dto.channel,
        totalJobs: dto.entityIds.length,
        completedJobs: 0,
        failedJobs: 0,
        failedIds: [],
        status: 'running',
        onFailure,
        notifyUrl: dto.notifyUrl || null,
      })
      .returning();

    // Process entities asynchronously (fire and forget)
    this.processBatchAsync(batchId, dto, orgId, userId).catch((err) => {
      console.error(`Batch ${batchId} processing error:`, err);
    });

    return { batchId: batch.id, status: batch.status, totalJobs: batch.totalJobs };
  }

  /**
   * Process batch entities sequentially in the background.
   */
  private async processBatchAsync(
    batchId: string,
    dto: RenderBulkDto,
    orgId: string,
    userId: string,
  ) {
    let completedJobs = 0;
    let failedJobs = 0;
    const failedIds: string[] = [];
    const documentIds: string[] = [];
    let aborted = false;

    // Initialize batch document tracking
    this.batchDocuments.set(batchId, documentIds);

    for (const entityId of dto.entityIds) {
      if (aborted) break;

      const renderDto: RenderNowDto = {
        templateId: dto.templateId,
        entityId,
        entityType: dto.entityType,
        channel: dto.channel,
        inputs: dto.inputs ? [dto.inputs] : undefined,
      };

      const result = await this.renderNow(renderDto, orgId, userId);

      if ('error' in result && !('document' in result)) {
        // Template not found error
        failedJobs++;
        failedIds.push(entityId);

        this.batchEvents.emit(`batch:${batchId}`, {
          type: 'job_failed',
          entityId,
          error: result.error,
          completedJobs,
          failedJobs,
          totalJobs: dto.entityIds.length,
        });

        if (dto.onFailure === 'abort') {
          aborted = true;
        }
      } else if ('error' in result && 'document' in result) {
        // PDF generation failed
        failedJobs++;
        failedIds.push(entityId);

        this.batchEvents.emit(`batch:${batchId}`, {
          type: 'job_failed',
          entityId,
          error: result.error,
          completedJobs,
          failedJobs,
          totalJobs: dto.entityIds.length,
        });

        if (dto.onFailure === 'abort') {
          aborted = true;
        }
      } else {
        // Success
        completedJobs++;
        const docId = (result as { document: { id: string } }).document.id;
        documentIds.push(docId);

        this.batchEvents.emit(`batch:${batchId}`, {
          type: 'job_completed',
          entityId,
          documentId: docId,
          completedJobs,
          failedJobs,
          totalJobs: dto.entityIds.length,
        });
      }

      // Update batch progress in DB
      const batchStatus = aborted
        ? 'aborted'
        : (completedJobs + failedJobs >= dto.entityIds.length)
          ? (failedJobs > 0 ? 'completedWithErrors' : 'completed')
          : 'running';

      await this.db
        .update(renderBatches)
        .set({
          completedJobs,
          failedJobs,
          failedIds: failedIds.length > 0 ? failedIds : [],
          status: batchStatus,
          ...(batchStatus !== 'running' ? { completedAt: new Date() } : {}),
        })
        .where(eq(renderBatches.id, batchId));
    }

    // Final status
    const finalStatus = aborted
      ? 'aborted'
      : (failedJobs > 0 ? 'completedWithErrors' : 'completed');

    await this.db
      .update(renderBatches)
      .set({
        completedJobs,
        failedJobs,
        failedIds: failedIds.length > 0 ? failedIds : [],
        status: finalStatus,
        completedAt: new Date(),
      })
      .where(eq(renderBatches.id, batchId));

    // Emit batch complete event
    this.batchEvents.emit(`batch:${batchId}`, {
      type: 'batch_complete',
      status: finalStatus,
      completedJobs,
      failedJobs,
      totalJobs: dto.entityIds.length,
    });

    // Webhook callback if configured
    if (dto.notifyUrl) {
      try {
        await fetch(dto.notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchId,
            status: finalStatus,
            completedJobs,
            failedJobs,
            totalJobs: dto.entityIds.length,
          }),
        });
      } catch {
        console.error(`Webhook callback failed for batch ${batchId}`);
      }
    }
  }

  /**
   * Get batch status by ID.
   */
  async getBatchStatus(batchId: string, orgId: string) {
    const [batch] = await this.db
      .select()
      .from(renderBatches)
      .where(
        and(
          eq(renderBatches.id, batchId),
          eq(renderBatches.orgId, orgId),
        ),
      );

    if (!batch) {
      return null;
    }

    return {
      id: batch.id,
      status: batch.status,
      totalJobs: batch.totalJobs,
      completedJobs: batch.completedJobs,
      failedJobs: batch.failedJobs,
      failedIds: batch.failedIds,
      channel: batch.channel,
      onFailure: batch.onFailure,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    };
  }

  /**
   * Merge all PDFs from a completed batch into a single PDF file.
   */
  async mergeBatchPdfs(batchId: string, orgId: string) {
    // 1. Get batch
    const [batch] = await this.db
      .select()
      .from(renderBatches)
      .where(
        and(
          eq(renderBatches.id, batchId),
          eq(renderBatches.orgId, orgId),
        ),
      );

    if (!batch) {
      return { error: 'Batch not found' };
    }

    if (batch.status === 'running') {
      return { error: 'Batch is still running' };
    }

    // 2. Get all successful documents for this batch using tracked document IDs
    const batchDocIds = this.batchDocuments.get(batchId) || [];

    let relevantDocs: { id: string; filePath: string }[] = [];
    if (batchDocIds.length > 0) {
      relevantDocs = await this.db
        .select({ id: generatedDocuments.id, filePath: generatedDocuments.filePath })
        .from(generatedDocuments)
        .where(
          and(
            eq(generatedDocuments.orgId, orgId),
            eq(generatedDocuments.status, 'done'),
            inArray(generatedDocuments.id, batchDocIds),
          ),
        );
    }

    if (relevantDocs.length === 0) {
      return { error: 'No completed documents found in batch' };
    }

    // 3. Read all PDF buffers
    const pdfBuffers: Buffer[] = [];
    for (const doc of relevantDocs) {
      try {
        const buffer = await this.fileStorage.read(doc.filePath);
        if (buffer) {
          pdfBuffers.push(buffer);
        }
      } catch {
        console.error(`Failed to read PDF: ${doc.filePath}`);
      }
    }

    if (pdfBuffers.length === 0) {
      return { error: 'No PDF files could be read' };
    }

    // 4. Merge PDFs using pdf-lib
    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();

    let totalPages = 0;
    for (const pdfBuffer of pdfBuffers) {
      try {
        const sourcePdf = await PDFDocument.load(pdfBuffer);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        for (const page of copiedPages) {
          mergedPdf.addPage(page);
          totalPages++;
        }
      } catch (err) {
        console.error('Failed to merge a PDF:', err);
      }
    }

    // 5. Save merged PDF
    const mergedBytes = await mergedPdf.save();
    const mergedHash = crypto
      .createHash('sha256')
      .update(Buffer.from(mergedBytes))
      .digest('hex');

    const mergedDocId = createId();
    const mergedFilePath = `${orgId}/documents/merged_${batchId}_${mergedDocId}.pdf`;
    await this.fileStorage.write(mergedFilePath, Buffer.from(mergedBytes));

    return {
      mergedDocumentId: mergedDocId,
      filePath: mergedFilePath,
      pdfHash: mergedHash,
      totalPages,
      documentsIncluded: relevantDocs.length,
    };
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
    const basePdf = schema.basePdf || { width: 210, height: 297, padding: [10, 10, 10, 10] };
    const rawSchemas = (schema.schemas as unknown[]) || [[]];

    // Convert legacy keyed format to flat pdfme format:
    // Legacy: [[{fieldName: {type, position, ...}}, ...]]
    // pdfme:  [[{name: fieldName, type, position, ...}, ...]]
    const schemas = rawSchemas.map((page: unknown) => {
      if (!Array.isArray(page)) return page;
      const flatPage: unknown[] = [];
      for (const item of page) {
        if (!item || typeof item !== 'object') { flatPage.push(item); continue; }
        const obj = item as Record<string, unknown>;
        // If the object already has 'name' and 'type' at top level, it's already flat
        if ('name' in obj && 'type' in obj) {
          flatPage.push(obj);
        } else {
          // Keyed format: {fieldName: {type, position, ...}} — flatten each key
          for (const [key, value] of Object.entries(obj)) {
            if (value && typeof value === 'object') {
              flatPage.push({ ...(value as Record<string, unknown>), name: key });
            }
          }
        }
      }
      return flatPage;
    });

    return { basePdf, schemas };
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

  /**
   * Resolve page scopes: filter elements based on their pageScope property.
   * - 'all' (default): element appears on every page
   * - 'first': element only appears on the first page
   * - 'last': element only appears on the last page
   * - 'notFirst': element appears on all pages except the first
   *
   * Mutates the template schemas in place.
   */
  private resolvePageScopes(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
  ): void {
    if (!Array.isArray(pdfmeTemplate.schemas) || pdfmeTemplate.schemas.length === 0) return;

    const totalPages = pdfmeTemplate.schemas.length;

    pdfmeTemplate.schemas = pdfmeTemplate.schemas.map((page: unknown, pageIndex: number) => {
      if (!Array.isArray(page)) return page;

      const isFirst = pageIndex === 0;
      const isLast = pageIndex === totalPages - 1;

      return page.filter((field: unknown) => {
        if (!field || typeof field !== 'object') return true;
        const f = field as Record<string, unknown>;
        const scope = (f.pageScope as string) || 'all';

        switch (scope) {
          case 'first':
            return isFirst;
          case 'last':
            return isLast;
          case 'notFirst':
            return !isFirst;
          case 'all':
          default:
            return true;
        }
      }).map((field: unknown) => {
        // Remove pageScope from the element since pdfme doesn't understand it
        if (!field || typeof field !== 'object') return field;
        const f = field as Record<string, unknown>;
        if ('pageScope' in f) {
          const { pageScope: _removed, ...rest } = f;
          return rest;
        }
        return field;
      });
    });
  }

  /**
   * Resolve conditions: hide elements based on their condition property.
   * Condition types:
   * - 'fieldNonEmpty': element visible only if the specified field has a non-empty value
   * - 'expression': element visible only if the expression evaluates to truthy
   *
   * Mutates the template schemas and removes hidden elements' inputs.
   */
  private resolveConditions(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    inputs: Record<string, string>[],
  ): void {
    if (!Array.isArray(pdfmeTemplate.schemas)) return;

    // Build a context from the first input record for condition evaluation
    const context = inputs.length > 0 ? inputs[0] : {};

    pdfmeTemplate.schemas = pdfmeTemplate.schemas.map((page: unknown) => {
      if (!Array.isArray(page)) return page;

      return page.filter((field: unknown) => {
        if (!field || typeof field !== 'object') return true;
        const f = field as Record<string, unknown>;
        const condition = f.condition as Record<string, unknown> | undefined;

        if (!condition) return true; // No condition = always visible

        const condType = condition.type as string;

        if (condType === 'fieldNonEmpty') {
          const fieldKey = condition.field as string;
          if (!fieldKey) return true;
          const value = context[fieldKey];
          // Field is non-empty if it exists, is not empty string, not null, not undefined
          return value !== undefined && value !== null && value !== '';
        }

        if (condType === 'expression') {
          const expr = condition.expression as string;
          if (!expr) return true;
          try {
            return this.evaluateConditionExpression(expr, context);
          } catch {
            // If expression evaluation fails, keep the element visible
            return true;
          }
        }

        return true; // Unknown condition type = always visible
      }).map((field: unknown) => {
        // Remove condition from the element since pdfme doesn't understand it
        if (!field || typeof field !== 'object') return field;
        const f = field as Record<string, unknown>;
        if ('condition' in f) {
          const { condition: _removed, ...rest } = f;
          return rest;
        }
        return field;
      });
    });
  }

  /**
   * Evaluate a simple condition expression.
   * Supports: field == value, field != value, field > value, field < value,
   * field >= value, field <= value
   * Also supports simple truthy checks: just a field name returns true if non-empty
   */
  private evaluateConditionExpression(
    expr: string,
    context: Record<string, string>,
  ): boolean {
    const trimmed = expr.trim();

    // Try comparison operators
    const comparisonMatch = trimmed.match(
      /^([a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/,
    );
    if (comparisonMatch) {
      const [, fieldKey, operator, rawValue] = comparisonMatch;
      const fieldValue = context[fieldKey] ?? '';

      // Remove quotes from value if present
      let compareValue = rawValue.trim();
      if (
        (compareValue.startsWith("'") && compareValue.endsWith("'")) ||
        (compareValue.startsWith('"') && compareValue.endsWith('"'))
      ) {
        compareValue = compareValue.slice(1, -1);
      }

      // Try numeric comparison
      const numField = Number(fieldValue);
      const numCompare = Number(compareValue);
      const isNumeric = !isNaN(numField) && !isNaN(numCompare) && fieldValue !== '';

      switch (operator) {
        case '==':
          return isNumeric ? numField === numCompare : fieldValue === compareValue;
        case '!=':
          return isNumeric ? numField !== numCompare : fieldValue !== compareValue;
        case '>':
          return isNumeric ? numField > numCompare : fieldValue > compareValue;
        case '<':
          return isNumeric ? numField < numCompare : fieldValue < compareValue;
        case '>=':
          return isNumeric ? numField >= numCompare : fieldValue >= compareValue;
        case '<=':
          return isNumeric ? numField <= numCompare : fieldValue <= compareValue;
        default:
          return true;
      }
    }

    // Simple truthy check: field name only
    const value = context[trimmed] ?? '';
    return value !== '' && value !== '0' && value !== 'false';
  }

  /**
   * Resolve output channels: filter elements based on their outputChannel property
   * and the requested render channel.
   *
   * outputChannel values on elements: 'both' (default), 'email', 'print'
   * - 'both': element appears in all channels
   * - 'email': element only appears when rendering for email channel
   * - 'print': element only appears when rendering for print channel
   *
   * Elements tagged as email-only are excluded when channel='print' and vice versa.
   * This supports pre-printed stationery: suppress email-only elements (company logo,
   * header graphics) when printing on pre-printed paper.
   *
   * Mutates the template schemas in place, also strips the outputChannel property
   * since pdfme doesn't understand it.
   */
  private resolveOutputChannels(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    channel: string,
  ): void {
    if (!Array.isArray(pdfmeTemplate.schemas)) return;

    pdfmeTemplate.schemas = pdfmeTemplate.schemas.map((page: unknown) => {
      if (!Array.isArray(page)) return page;

      return page.filter((field: unknown) => {
        if (!field || typeof field !== 'object') return true;
        const f = field as Record<string, unknown>;
        const elementChannel = (f.outputChannel as string) || 'both';

        // 'both' always passes through
        if (elementChannel === 'both') return true;

        // Element channel must match the requested render channel
        return elementChannel === channel;
      }).map((field: unknown) => {
        // Remove outputChannel from the element since pdfme doesn't understand it
        if (!field || typeof field !== 'object') return field;
        const f = field as Record<string, unknown>;
        if ('outputChannel' in f) {
          const { outputChannel: _removed, ...rest } = f;
          return rest;
        }
        return field;
      });
    });
  }
}
