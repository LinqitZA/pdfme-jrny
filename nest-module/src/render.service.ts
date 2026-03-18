/**
 * RenderService - PDF generation pipeline
 *
 * Pipeline: Fetch published template -> resolve inputs -> pdfme generate() ->
 *   SHA-256 hash -> FileStorageService store -> GeneratedDocument record
 */

import { Injectable, Inject, Optional } from '@nestjs/common';
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
import { resolveErpImages, generatePlaceholderImage } from '../../packages/erp-schemas/src/erp-image';
import { resolveSignatureBlocks, applySignatureBlocks, SignatureBlockRenderInfo } from '../../packages/erp-schemas/src/signature-block';
import { resolveCalculatedFields } from '../../packages/erp-schemas/src/calculated-field';
import { resolveCurrencyFields } from '../../packages/erp-schemas/src/currency-field';
import { PdfaProcessor } from './pdfa-processor';
import { DataSourceRegistry } from './datasource.registry';
import * as path from 'path';

/** Warnings emitted during font resolution */
export interface FontWarning {
  fontName: string;
  message: string;
}

/** Info about placeholder images that need "Image not found" text overlay */
export interface PlaceholderImageInfo {
  pageIndex: number;
  x: number; // mm
  y: number; // mm
  width: number; // mm
  height: number; // mm
  fieldName: string;
}

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

/** Metadata for a generated preview */
export interface PreviewRecord {
  previewId: string;
  orgId: string;
  filePath: string;
  expiresAt: string; // ISO 8601
  createdAt: string; // ISO 8601
}

@Injectable()
export class RenderService {
  /** EventEmitter for SSE progress streams, keyed by batchId */
  public readonly batchEvents = new EventEmitter();

  /** Track document IDs per batch for merge operations */
  private batchDocuments = new Map<string, string[]>();

  /** In-memory registry of preview PDFs with expiry metadata */
  public readonly previewRegistry = new Map<string, PreviewRecord>();

  /** Retry configuration for file storage operations */
  private retryConfig = {
    maxRetries: 3,
    baseDelayMs: 200, // 200ms, 400ms, 800ms with exponential backoff
    maxDelayMs: 5000,
  };

  /** Track retry attempts for observability/testing */
  public lastRetryAttempts = 0;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly fileStorage: FileStorageService,
    private readonly signatureService: SignatureService,
    private readonly pdfaProcessor: PdfaProcessor,
    @Optional() private readonly dataSourceRegistry?: DataSourceRegistry,
  ) {
    // Allow many listeners (one per SSE client)
    this.batchEvents.setMaxListeners(100);
  }

  /**
   * Execute a file storage operation with retry logic and exponential backoff.
   * Retries up to maxRetries times on transient failures.
   *
   * @param operation - Async function to retry
   * @param operationName - Description for logging
   * @returns Result of the operation
   * @throws Last error if all retries exhausted
   */
  async withRetry<T>(operation: () => Promise<T>, operationName: string = 'file operation'): Promise<T> {
    let lastError: Error | undefined;
    this.lastRetryAttempts = 0;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = await operation();
        this.lastRetryAttempts = attempt;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.lastRetryAttempts = attempt + 1;

        if (attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt),
            this.retryConfig.maxDelayMs,
          );
          console.warn(
            `[RenderService] ${operationName} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(
      `[RenderService] ${operationName} failed after ${this.retryConfig.maxRetries + 1} attempts: ${lastError!.message}`,
    );
    throw lastError!;
  }

  /**
   * Write to file storage with retry logic.
   */
  async writeWithRetry(filePath: string, data: Buffer): Promise<void> {
    return this.withRetry(
      () => this.fileStorage.write(filePath, data),
      `write(${filePath})`,
    );
  }

  /**
   * Read from file storage with retry logic.
   */
  async readWithRetry(filePath: string): Promise<Buffer> {
    return this.withRetry(
      () => this.fileStorage.read(filePath),
      `read(${filePath})`,
    );
  }

  /**
   * Set custom retry configuration (for testing).
   */
  setRetryConfig(config: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }) {
    if (config.maxRetries !== undefined) this.retryConfig.maxRetries = config.maxRetries;
    if (config.baseDelayMs !== undefined) this.retryConfig.baseDelayMs = config.baseDelayMs;
    if (config.maxDelayMs !== undefined) this.retryConfig.maxDelayMs = config.maxDelayMs;
  }

  /**
   * Get current retry configuration (for testing).
   */
  getRetryConfig() {
    return { ...this.retryConfig };
  }

  /**
   * Check font availability for a template without rendering.
   * Returns which fonts are available and which would fall back.
   */
  async checkTemplateFonts(templateId: string, orgId: string) {
    const [template] = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, templateId));

    if (!template) {
      return { error: 'Template not found' };
    }

    const templateSchema = template.schema as Record<string, unknown>;
    const pdfmeTemplate = this.buildPdfmeTemplate(templateSchema);
    const fontResult = await this.resolveFonts(pdfmeTemplate, orgId);

    const fontNames = new Set<string>();
    for (const page of pdfmeTemplate.schemas) {
      if (!Array.isArray(page)) continue;
      for (const element of page) {
        if (element && typeof element === 'object' && 'fontName' in element) {
          const fn = (element as { fontName?: string }).fontName;
          if (fn && typeof fn === 'string' && fn.trim()) {
            fontNames.add(fn.trim());
          }
        }
      }
    }

    return {
      templateId,
      fontsReferenced: Array.from(fontNames),
      fontsResolved: fontResult.font ? Object.keys(fontResult.font) : [],
      warnings: fontResult.warnings,
      fallbackUsed: fontResult.warnings.length > 0,
    };
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

    // 3-ds. If a DataSource is registered for this template type and no explicit inputs,
    //       resolve data from the DataSource
    if (this.dataSourceRegistry && this.dataSourceRegistry.has(template.type) && (!dto.inputs || dto.inputs.length === 0)) {
      try {
        const dataSource = this.dataSourceRegistry.resolve(template.type);
        const resolvedData = await dataSource.resolve(dto.entityId, orgId);
        if (Array.isArray(resolvedData) && resolvedData.length > 0) {
          inputs = resolvedData.map((item: unknown) =>
            typeof item === 'object' && item !== null
              ? Object.fromEntries(
                  Object.entries(item as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
                )
              : {}
          );
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // Create a failed document record for DataSource errors
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
            errorMessage: `DataSource error: ${errorMessage}`,
          })
          .returning();
        return { error: `DataSource error: ${errorMessage}`, document: failedDoc };
      }
    }

    // 3a. Resolve field bindings with fallbackValue for missing/empty inputs
    this.resolveFieldBindings(pdfmeTemplate, inputs);

    // 3b. Resolve drawnSignature fields - fetch user's signature PNG and embed as base64
    try {
      await this.resolveDrawnSignatures(pdfmeTemplate, inputs, orgId, userId);
    } catch (sigErr: unknown) {
      const errorMessage = sigErr instanceof Error ? sigErr.message : String(sigErr);
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
          errorMessage,
        })
        .returning();
      return { error: errorMessage, document: failedDoc };
    }

    // 3b2. Resolve erpImage elements - fetch from FileStorageService and convert to base64
    const erpImageResult = await resolveErpImages(pdfmeTemplate, inputs, {
      readFile: (p: string) => this.fileStorage.read(p),
      fileExists: (p: string) => this.fileStorage.exists(p),
      listFiles: (p: string) => this.fileStorage.list(p),
      orgId,
    });
    pdfmeTemplate = erpImageResult.template as typeof pdfmeTemplate;
    inputs = erpImageResult.inputs;
    const erpImagePlaceholders = erpImageResult.placeholders || [];

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

    // 3h1. Resolve currencyField elements - format with symbol and dual-currency display
    const resolvedCurrency = resolveCurrencyFields(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedCurrency.template as typeof pdfmeTemplate;
    inputs = resolvedCurrency.inputs;

    // 3h2. Resolve missing images with placeholder rectangles
    const placeholderImages = this.resolveMissingImages(pdfmeTemplate, inputs);

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

    // 3j. Resolve fonts - load custom fonts or fall back to default
    const fontResult = await this.resolveFonts(pdfmeTemplate, orgId);

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

      const generateOptions: Record<string, unknown> = {};
      if (fontResult.font) {
        generateOptions.font = fontResult.font;
      }

      pdfBuffer = await generate({
        template: pdfmeTemplate,
        inputs,
        plugins,
        options: generateOptions,
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

    // 4b3. Apply placeholder image "Image not found" text overlay via pdf-lib
    const allPlaceholders = [...erpImagePlaceholders, ...placeholderImages];
    if (allPlaceholders.length > 0) {
      try {
        pdfBuffer = await this.applyPlaceholderOverlays(pdfBuffer, allPlaceholders);
      } catch (err: unknown) {
        console.error('Placeholder image overlay failed:', err);
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

    // 4d. Convert to PDF/A-3b (Ghostscript or pdf-lib fallback)
    let pdfaConversionFailed = false;
    let pdfaErrorMessage = '';
    try {
      const pdfaResult = await this.pdfaProcessor.convertToPdfA3b(pdfBuffer);
      pdfBuffer = new Uint8Array(pdfaResult.pdfBuffer);
    } catch (err: unknown) {
      pdfaConversionFailed = true;
      pdfaErrorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[RenderService] PDF/A-3b conversion failed: ${pdfaErrorMessage}`);
      console.error('[RenderService] Storing raw (non-PDF/A) PDF for debugging');
    }

    // 5. Compute SHA-256 hash
    const pdfHash = crypto
      .createHash('sha256')
      .update(pdfBuffer)
      .digest('hex');

    // 6. Store PDF via FileStorageService
    const docId = createId();

    if (pdfaConversionFailed) {
      // Store the raw PDF with _non-pdfa suffix for debugging
      const nonPdfaFilePath = `${orgId}/documents/${docId}_non-pdfa.pdf`;
      await this.writeWithRetry(nonPdfaFilePath, Buffer.from(pdfBuffer));

      // Create a failed GeneratedDocument record with the debug file path
      const [failedDoc] = await this.db
        .insert(generatedDocuments)
        .values({
          id: docId,
          orgId,
          templateId: dto.templateId,
          templateVer: template.version,
          entityType: dto.entityType || template.type,
          entityId: dto.entityId,
          filePath: nonPdfaFilePath,
          pdfHash,
          status: 'failed',
          outputChannel: dto.channel,
          triggeredBy: userId,
          inputSnapshot: inputs || dto.inputs || null,
          errorMessage: `PDF/A-3b conversion failed: ${pdfaErrorMessage}`,
        })
        .returning();

      return { error: `PDF/A-3b conversion failed: ${pdfaErrorMessage}`, document: failedDoc };
    }

    const filePath = `${orgId}/documents/${docId}.pdf`;
    await this.writeWithRetry(filePath, Buffer.from(pdfBuffer));

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
    const templateType = dto.entityType || 'document';

    // Check for already-running batch with same templateType + orgId
    const [existingBatch] = await this.db
      .select({ id: renderBatches.id, status: renderBatches.status, totalJobs: renderBatches.totalJobs, completedJobs: renderBatches.completedJobs })
      .from(renderBatches)
      .where(
        and(
          eq(renderBatches.orgId, orgId),
          eq(renderBatches.templateType, templateType),
          eq(renderBatches.status, 'running'),
        ),
      )
      .limit(1);

    if (existingBatch) {
      return {
        error: 'A bulk render is already in progress for this template type',
        existingBatchId: existingBatch.id,
        status: existingBatch.status,
        totalJobs: existingBatch.totalJobs,
        completedJobs: existingBatch.completedJobs,
        conflict: true,
      };
    }

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
        const buffer = await this.readWithRetry(doc.filePath);
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
    await this.writeWithRetry(mergedFilePath, Buffer.from(mergedBytes));

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
   * Resolve field bindings with fallbackValue support.
   * For each schema element, if the corresponding input value is missing or empty
   * and the element has a fallbackValue property, use the fallback value.
   * Without a fallbackValue, missing/empty bindings remain as empty string.
   */
  private resolveFieldBindings(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    inputs: Record<string, string>[],
  ): void {
    // Build a map of field name -> fallbackValue from schema elements
    const fallbackMap = new Map<string, string>();
    for (const page of pdfmeTemplate.schemas) {
      if (!Array.isArray(page)) continue;
      for (const element of page) {
        if (!element || typeof element !== 'object') continue;
        const el = element as Record<string, unknown>;
        const name = el.name as string | undefined;
        const fallbackValue = el.fallbackValue as string | undefined;
        if (name && fallbackValue !== undefined && fallbackValue !== null) {
          fallbackMap.set(name, String(fallbackValue));
        }
      }
    }

    // Apply fallback values to each input record
    for (const inputRecord of inputs) {
      // Ensure all schema fields exist in inputs; apply fallback for missing/empty values
      for (const page of pdfmeTemplate.schemas) {
        if (!Array.isArray(page)) continue;
        for (const element of page) {
          if (!element || typeof element !== 'object') continue;
          const el = element as Record<string, unknown>;
          const name = el.name as string | undefined;
          if (!name) continue;

          // If input is missing or empty, apply fallback or empty string
          if (!(name in inputRecord) || inputRecord[name] === '' || inputRecord[name] === undefined || inputRecord[name] === null) {
            const fallback = fallbackMap.get(name);
            inputRecord[name] = fallback !== undefined ? fallback : '';
          }
        }
      }
    }
  }

  /**
   * Resolve missing images with placeholder rectangles.
   * For any 'image' type element whose input is missing or empty (no data URI),
   * generates a placeholder PNG and records the element info for pdf-lib
   * post-processing (drawing "Image not found" text on the placeholder area).
   * This prevents render failures from missing image references.
   */
  private resolveMissingImages(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    inputs: Record<string, string>[],
  ): PlaceholderImageInfo[] {
    const placeholders: PlaceholderImageInfo[] = [];

    for (let pi = 0; pi < pdfmeTemplate.schemas.length; pi++) {
      const page = pdfmeTemplate.schemas[pi];
      if (!Array.isArray(page)) continue;
      for (const element of page) {
        if (!element || typeof element !== 'object') continue;
        const el = element as Record<string, unknown>;
        if (el.type !== 'image') continue;
        const name = el.name as string | undefined;
        if (!name) continue;

        const width = (el.width as number) || 50;
        const height = (el.height as number) || 50;
        const position = el.position as { x: number; y: number } | undefined;

        for (const inputRecord of inputs) {
          const val = inputRecord[name];
          if (!val || (typeof val === 'string' && !val.startsWith('data:'))) {
            inputRecord[name] = generatePlaceholderImage(width, height);
            if (position) {
              placeholders.push({
                pageIndex: pi,
                x: position.x,
                y: position.y,
                width,
                height,
                fieldName: name,
              });
            }
          }
        }
      }
    }

    return placeholders;
  }

  /**
   * Apply "Image not found" text overlays on placeholder images via pdf-lib.
   * Draws a dashed border rectangle and centered text on each placeholder area.
   */
  private async applyPlaceholderOverlays(
    pdfBuffer: Uint8Array,
    placeholders: PlaceholderImageInfo[],
  ): Promise<Uint8Array> {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    const MM_TO_PT = 2.8346; // 1mm = 2.8346 points

    for (const ph of placeholders) {
      const page = pages[ph.pageIndex];
      if (!page) continue;

      const pageHeight = page.getHeight();
      const x = ph.x * MM_TO_PT;
      const y = pageHeight - (ph.y * MM_TO_PT) - (ph.height * MM_TO_PT);
      const w = ph.width * MM_TO_PT;
      const h = ph.height * MM_TO_PT;

      // Draw light grey filled rectangle
      page.drawRectangle({
        x, y, width: w, height: h,
        color: rgb(0.94, 0.94, 0.94), // #f0f0f0
        borderColor: rgb(0.8, 0.8, 0.8), // #cccccc
        borderWidth: 0.5,
      });

      // Draw diagonal cross lines
      page.drawLine({
        start: { x, y: y + h }, end: { x: x + w, y },
        color: rgb(0.8, 0.8, 0.8), thickness: 0.3,
      });
      page.drawLine({
        start: { x, y }, end: { x: x + w, y: y + h },
        color: rgb(0.8, 0.8, 0.8), thickness: 0.3,
      });

      // Draw "Image not found" text centered in the rectangle
      const text = 'Image not found';
      const fontSize = Math.max(6, Math.min(10, w / 12));
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textX = x + (w - textWidth) / 2;
      const textY = y + (h - fontSize) / 2;

      page.drawText(text, {
        x: textX, y: textY,
        size: fontSize,
        font,
        color: rgb(0.6, 0.6, 0.6), // #999999
      });
    }

    return new Uint8Array(await pdfDoc.save());
  }

  /**
   * Resolve drawnSignature fields in the template.
   * Scans template schemas for drawnSignature type fields, fetches the user's
   * signature PNG from storage, and replaces input values with base64 data URIs.
   * Also converts the schema type to 'image' for pdfme compatibility.
   *
   * Supports configurable fallbackBehaviour when signature is missing:
   * - 'blank' (default): renders empty/transparent space
   * - 'placeholder': shows a signature placeholder image
   * - 'error': throws an error to fail the render
   */
  private async resolveDrawnSignatures(
    pdfmeTemplate: { basePdf: unknown; schemas: unknown[] },
    inputs: Record<string, string>[],
    orgId: string,
    userId: string,
  ): Promise<void> {
    // Find all drawnSignature fields in the template, along with their fallback config
    interface SignatureFieldInfo {
      name: string;
      fallbackBehaviour: 'blank' | 'placeholder' | 'error';
      width: number;
      height: number;
    }
    const signatureFields: SignatureFieldInfo[] = [];

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
              const f = field as Record<string, unknown>;
              const fallback = (f.fallbackBehaviour as string) || 'blank';
              signatureFields.push({
                name: f.name as string,
                fallbackBehaviour: fallback as 'blank' | 'placeholder' | 'error',
                width: (f.width as number) || 50,
                height: (f.height as number) || 20,
              });
              // Convert type to 'image' for pdfme compatibility
              (field as { type: string }).type = 'image';
            }
          }
        }
      }
    }

    if (signatureFields.length === 0) return;

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
      // Signature not found - use fallback behaviour
    }

    // Set the signature data in all input records
    for (const inputRecord of inputs) {
      for (const sigField of signatureFields) {
        if (signatureDataUri) {
          // Signature exists - use it
          inputRecord[sigField.name] = signatureDataUri;
        } else {
          // Signature missing - apply fallback behaviour
          switch (sigField.fallbackBehaviour) {
            case 'error':
              throw new Error(`Signature required but not found for field "${sigField.name}". User "${userId}" has no signature on file.`);
            case 'placeholder': {
              // Generate a signature placeholder (light grey box with "Sign here" text)
              // Uses a 1x1 transparent PNG; the resolveMissingImages step will overlay text
              inputRecord[sigField.name] = generatePlaceholderImage(sigField.width, sigField.height);
              break;
            }
            case 'blank':
            default: {
              // Generate a 1x1 transparent PNG to render blank/empty space
              // This minimal PNG prevents pdfme from failing on empty image input
              const transparentPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
              inputRecord[sigField.name] = `data:image/png;base64,${transparentPng}`;
              break;
            }
          }
        }
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

  /**
   * Resolve fonts for a template.
   *
   * Scans template schemas for fontName references, attempts to load custom fonts
   * from org file storage, and falls back to pdfme's built-in default font (Roboto)
   * for any fonts that cannot be found. Logs a warning for each missing font.
   *
   * Returns a Font map suitable for passing to pdfme generate() via options.font,
   * plus an array of warnings for any fonts that had to be substituted.
   */
  async resolveFonts(
    pdfmeTemplate: { schemas: unknown[]; basePdf: unknown; columns?: unknown[] },
    orgId: string,
  ): Promise<{ font: Record<string, { data: string | ArrayBuffer | Uint8Array; fallback?: boolean; subset?: boolean }> | null; warnings: FontWarning[] }> {
    const warnings: FontWarning[] = [];

    // 1. Extract all fontName references from template schemas
    const fontNames = new Set<string>();
    for (const page of pdfmeTemplate.schemas) {
      if (!Array.isArray(page)) continue;
      for (const element of page) {
        if (element && typeof element === 'object' && 'fontName' in element) {
          const fn = (element as { fontName?: string }).fontName;
          if (fn && typeof fn === 'string' && fn.trim()) {
            fontNames.add(fn.trim());
          }
        }
      }
    }

    // If no custom fonts referenced, let pdfme use its built-in default
    if (fontNames.size === 0) {
      return { font: null, warnings };
    }

    // 2. Get pdfme's built-in default font (Roboto) for fallback
    const { getDefaultFont } = await import('@pdfme/common');
    const defaultFont = getDefaultFont();
    // The default font map has exactly one entry with fallback: true
    const defaultFontName = Object.keys(defaultFont)[0]; // 'Roboto'
    const defaultFontData = defaultFont[defaultFontName];

    // 3. Build the font map, attempting to load each referenced font
    const fontMap: Record<string, { data: string | ArrayBuffer | Uint8Array; fallback?: boolean; subset?: boolean }> = {};

    // Always include the fallback font
    fontMap[defaultFontName] = { ...defaultFontData, fallback: true };

    for (const fontName of fontNames) {
      // Skip if it's the default font
      if (fontName === defaultFontName) continue;

      // Try to load from org font storage
      let loaded = false;
      try {
        // Try common font file extensions
        const extensions = ['.ttf', '.otf', '.woff2'];
        const fontDir = `${orgId}/fonts`;
        const files = await this.fileStorage.list(fontDir).catch(() => [] as string[]);

        for (const ext of extensions) {
          // Look for a file matching the font name (case-insensitive)
          const matchingFile = files.find((f: string) => {
            const baseName = path.basename(f, path.extname(f)).toLowerCase().replace(/[_-]/g, '');
            const searchName = fontName.toLowerCase().replace(/[_-\s]/g, '');
            return baseName.includes(searchName) || searchName.includes(baseName);
          });

          if (matchingFile) {
            try {
              const fontData = await this.fileStorage.read(matchingFile);
              fontMap[fontName] = { data: new Uint8Array(fontData), subset: true };
              loaded = true;
              break;
            } catch {
              // File exists but couldn't be read - continue to fallback
            }
          }
        }
      } catch {
        // Storage access failed - continue to fallback
      }

      if (!loaded) {
        // Font not found - log warning and map to fallback
        const warning: FontWarning = {
          fontName,
          message: `Font "${fontName}" not found in storage, falling back to ${defaultFontName}`,
        };
        warnings.push(warning);
        console.warn(`[RenderService] ${warning.message}`);

        // Register the missing font name pointing to the fallback font data
        // This prevents pdfme from throwing an error about unknown fonts
        fontMap[fontName] = { data: defaultFontData.data, subset: true };
      }
    }

    return { font: fontMap, warnings };
  }

  /**
   * Generate a preview PDF from a template with sample data.
   *
   * This endpoint works on any template status (draft or published).
   * It generates sample inputs from the template's field names,
   * runs the full render pipeline, and applies a "PREVIEW — NOT A LEGAL DOCUMENT"
   * watermark. The preview is stored temporarily and a download URL is returned.
   *
   * @param template - The template record (any status)
   * @param orgId - Tenant org ID
   * @param userId - User ID
   * @param channel - Output channel (email/print)
   * @param sampleRowCount - Number of sample line items (5, 15, or 30)
   */
  async generatePreview(
    template: { id: string; schema: unknown; type: string; version: number; name: string },
    orgId: string,
    userId: string,
    channel: string,
    sampleRowCount: number,
  ) {
    // 1. Build pdfme template from the stored schema
    const templateSchema = template.schema as Record<string, unknown>;
    let pdfmeTemplate = this.buildPdfmeTemplate(templateSchema);

    // 2. Generate sample inputs from template field names
    let inputs = [this.buildSampleInputs(pdfmeTemplate, sampleRowCount)];

    // 3. Run the full render pipeline (same as renderNow but without DB record)
    // 3a. Resolve field bindings with fallbackValue
    this.resolveFieldBindings(pdfmeTemplate, inputs);

    // 3b. Resolve drawnSignature fields
    await this.resolveDrawnSignatures(pdfmeTemplate, inputs, orgId, userId);

    // 3b2. Resolve erpImage elements
    const erpImageResult = await resolveErpImages(pdfmeTemplate, inputs, {
      readFile: (p: string) => this.fileStorage.read(p),
      fileExists: (p: string) => this.fileStorage.exists(p),
      listFiles: (p: string) => this.fileStorage.list(p),
      orgId,
    });
    pdfmeTemplate = erpImageResult.template as typeof pdfmeTemplate;
    inputs = erpImageResult.inputs;
    const previewErpPlaceholders = erpImageResult.placeholders || [];

    // 3c. Resolve lineItemsTable elements
    const resolvedLit = resolveLineItemsTables(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedLit.template as typeof pdfmeTemplate;
    inputs = resolvedLit.inputs;

    // 3d. Resolve qrBarcode elements
    const resolvedQr = resolveQrBarcodes(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedQr.template as typeof pdfmeTemplate;
    inputs = resolvedQr.inputs;

    // 3e. Resolve richText elements
    const richTextResult = resolveRichText(pdfmeTemplate, inputs);
    pdfmeTemplate = richTextResult.template as typeof pdfmeTemplate;
    inputs = richTextResult.inputs;
    const richTextInfo: RichTextRenderInfo[] = richTextResult.richTextInfo;

    // 3e2. Resolve signatureBlock elements
    const sigBlockResult = resolveSignatureBlocks(pdfmeTemplate, inputs);
    pdfmeTemplate = sigBlockResult.template as typeof pdfmeTemplate;
    inputs = sigBlockResult.inputs;

    // 3f. Resolve page scopes
    this.resolvePageScopes(pdfmeTemplate);

    // 3g. Resolve conditions
    this.resolveConditions(pdfmeTemplate, inputs);

    // 3g2. Resolve output channels
    this.resolveOutputChannels(pdfmeTemplate, channel);

    // 3h. Resolve calculated fields
    const resolvedCalc = resolveCalculatedFields(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedCalc.template as typeof pdfmeTemplate;
    inputs = resolvedCalc.inputs;

    // 3h1. Resolve currency fields
    const resolvedCurrency = resolveCurrencyFields(pdfmeTemplate, inputs);
    pdfmeTemplate = resolvedCurrency.template as typeof pdfmeTemplate;
    inputs = resolvedCurrency.inputs;

    // 3h2. Resolve missing images with placeholder rectangles
    const previewPlaceholders = this.resolveMissingImages(pdfmeTemplate, inputs);

    // 3i. Extract and remove watermark elements (template's own watermark)
    const _templateWatermark = extractWatermarkFromTemplate(pdfmeTemplate.schemas, inputs);
    pdfmeTemplate.schemas = pdfmeTemplate.schemas.map((page: unknown) => {
      if (!Array.isArray(page)) return page;
      return page.filter((field: unknown) => {
        if (field && typeof field === 'object' && 'type' in field) {
          return (field as { type: string }).type !== 'watermark';
        }
        return true;
      });
    });

    // 3j. Resolve fonts - load custom fonts or fall back to default
    const previewFontResult = await this.resolveFonts(pdfmeTemplate, orgId);

    // 4. Generate PDF
    let pdfBuffer: Uint8Array;
    const { generate } = await import('@pdfme/generator');
    const schemas = await import('@pdfme/schemas');

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
      drawnSignature: schemas.image,
    };

    const previewGenerateOptions: Record<string, unknown> = {};
    if (previewFontResult.font) {
      previewGenerateOptions.font = previewFontResult.font;
    }

    pdfBuffer = await generate({
      template: pdfmeTemplate,
      inputs,
      plugins,
      options: previewGenerateOptions,
    });

    // 4b. Apply rich text
    if (richTextInfo.length > 0) {
      try {
        pdfBuffer = await applyRichText(pdfBuffer, richTextInfo);
      } catch {
        // Continue without rich text
      }
    }

    // 4b3. Apply placeholder image overlays
    const allPreviewPlaceholders = [...previewErpPlaceholders, ...previewPlaceholders];
    if (allPreviewPlaceholders.length > 0) {
      try {
        pdfBuffer = await this.applyPlaceholderOverlays(pdfBuffer, allPreviewPlaceholders);
      } catch {
        // Continue without placeholder overlays
      }
    }

    // 5. Apply PREVIEW watermark (always, regardless of template's own watermark)
    const previewWatermarkConfig = {
      text: 'PREVIEW \u2014 NOT A LEGAL DOCUMENT',
      opacity: 0.15,
      rotation: 45,
      color: { r: 0.6, g: 0.6, b: 0.6 },
      fontSize: 48,
    };
    pdfBuffer = await applyWatermark(pdfBuffer, previewWatermarkConfig);

    // 6. Store preview temporarily
    const previewId = `prev_${createId()}`;
    const filePath = `${orgId}/previews/${previewId}.pdf`;
    await this.fileStorage.write(filePath, Buffer.from(pdfBuffer));

    // 7. Register preview with expiry metadata
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour
    const previewRecord: PreviewRecord = {
      previewId,
      orgId,
      filePath,
      expiresAt,
      createdAt: now.toISOString(),
    };
    this.previewRegistry.set(previewId, previewRecord);

    // 8. Return preview metadata
    return {
      previewId,
      downloadUrl: `/api/pdfme/render/download/${previewId}`,
      expiresAt,
      templateId: template.id,
      templateName: template.name,
      channel,
      sampleRowCount,
    };
  }

  /**
   * Get a preview PDF for download. Returns the PDF buffer if valid,
   * or an error object if expired, not found, or purged.
   */
  async getPreviewForDownload(previewId: string, orgId: string): Promise<
    | { buffer: Buffer; previewId: string }
    | { error: string; statusCode: number }
  > {
    const record = this.previewRegistry.get(previewId);

    // Not found in registry
    if (!record) {
      // Could be expired and purged, or never existed
      return { error: 'Preview not found or has expired', statusCode: 410 };
    }

    // Check org isolation
    if (record.orgId !== orgId) {
      return { error: 'Preview not found or has expired', statusCode: 410 };
    }

    // Check expiry
    if (new Date(record.expiresAt) < new Date()) {
      // Expired - clean up registry and try to delete file
      this.previewRegistry.delete(previewId);
      try {
        await this.fileStorage.delete(record.filePath);
      } catch {
        // File may already be gone
      }
      return { error: 'Preview has expired', statusCode: 410 };
    }

    // Try to read the file
    try {
      const buffer = await this.fileStorage.read(record.filePath);
      return { buffer, previewId };
    } catch {
      // File was purged from disk
      this.previewRegistry.delete(previewId);
      return { error: 'Preview file has been purged', statusCode: 410 };
    }
  }

  /**
   * Force-expire a preview for testing purposes.
   * Sets the expiresAt to a past date.
   */
  forceExpirePreview(previewId: string): boolean {
    const record = this.previewRegistry.get(previewId);
    if (!record) return false;
    record.expiresAt = new Date(Date.now() - 1000).toISOString(); // 1 second ago
    return true;
  }

  /**
   * Verify document integrity by comparing the stored SHA-256 hash with the
   * actual hash of the PDF file on disk.
   *
   * @param documentId - The ID of the generated document
   * @param orgId - Tenant org ID
   * @returns Verification result with integrity status
   */
  async verifyDocument(documentId: string, orgId: string) {
    // 1. Look up the document record
    const [doc] = await this.db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, documentId),
          eq(generatedDocuments.orgId, orgId),
        ),
      );

    if (!doc) {
      return { error: 'Document not found' };
    }

    // 2. Read the PDF file from storage
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.fileStorage.read(doc.filePath);
    } catch {
      return {
        documentId: doc.id,
        verified: false,
        status: 'file_missing',
        message: 'PDF file not found on disk',
        storedHash: doc.pdfHash,
      };
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return {
        documentId: doc.id,
        verified: false,
        status: 'file_missing',
        message: 'PDF file is empty or not found on disk',
        storedHash: doc.pdfHash,
      };
    }

    // 3. Compute the current SHA-256 hash of the file
    const currentHash = crypto
      .createHash('sha256')
      .update(pdfBuffer)
      .digest('hex');

    // 4. Compare hashes
    const verified = currentHash === doc.pdfHash;

    return {
      documentId: doc.id,
      verified,
      status: verified ? 'intact' : 'tampered',
      message: verified
        ? 'Document integrity confirmed — hash matches'
        : 'Document integrity check failed — PDF has been modified (tamper detected)',
      storedHash: doc.pdfHash,
      currentHash,
      filePath: doc.filePath,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Get a generated document for download. Returns the PDF buffer from disk cache.
   * No re-render is triggered — the previously generated PDF file is served directly.
   *
   * @param documentId - The ID of the generated document
   * @param orgId - Tenant org ID
   * @returns PDF buffer and metadata, or error object
   */
  async getDocumentForDownload(documentId: string, orgId: string): Promise<
    | { buffer: Buffer; documentId: string; pdfHash: string; filePath: string }
    | { error: string; statusCode: number }
  > {
    // 1. Look up the document record in the database
    const [doc] = await this.db
      .select()
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.id, documentId),
          eq(generatedDocuments.orgId, orgId),
        ),
      );

    if (!doc) {
      return { error: 'Document not found', statusCode: 404 };
    }

    if (doc.status === 'failed') {
      return { error: 'Document generation failed — no PDF available', statusCode: 404 };
    }

    if (!doc.filePath) {
      return { error: 'Document has no associated file', statusCode: 404 };
    }

    // 2. Read the cached PDF from disk (no re-render)
    try {
      const buffer = await this.fileStorage.read(doc.filePath);
      return { buffer, documentId: doc.id, pdfHash: doc.pdfHash, filePath: doc.filePath };
    } catch {
      return { error: 'Document file not found on disk', statusCode: 404 };
    }
  }

  /**
   * List generated documents for a specific template, optionally filtered by orgId.
   * Documents persist independently of template status (including archived templates).
   */
  async listDocumentsByTemplate(templateId: string, orgId: string): Promise<Array<{
    id: string;
    templateId: string;
    templateVer: number;
    entityType: string;
    entityId: string;
    status: string;
    outputChannel: string;
    createdAt: Date;
    pdfHash: string;
  }>> {
    const docs = await this.db
      .select({
        id: generatedDocuments.id,
        templateId: generatedDocuments.templateId,
        templateVer: generatedDocuments.templateVer,
        entityType: generatedDocuments.entityType,
        entityId: generatedDocuments.entityId,
        status: generatedDocuments.status,
        outputChannel: generatedDocuments.outputChannel,
        createdAt: generatedDocuments.createdAt,
        pdfHash: generatedDocuments.pdfHash,
      })
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.templateId, templateId),
          eq(generatedDocuments.orgId, orgId),
        ),
      );
    return docs;
  }

  /**
   * Build sample inputs from template field names for preview generation.
   * Generates realistic-looking sample values based on field name patterns.
   */
  private buildSampleInputs(
    template: { schemas: unknown[] },
    sampleRowCount: number,
  ): Record<string, string> {
    const inputs: Record<string, string> = {};

    if (Array.isArray(template.schemas)) {
      for (const page of template.schemas) {
        if (Array.isArray(page)) {
          for (const field of page) {
            if (field && typeof field === 'object' && 'name' in field) {
              const name = (field as { name: string }).name;
              const type = (field as { type?: string }).type || 'text';
              inputs[name] = this.generateSampleValue(name, type, sampleRowCount);
            }
          }
        }
      }
    }
    return inputs;
  }

  /**
   * Generate a sample value for a field based on its name and type.
   */
  private generateSampleValue(fieldName: string, fieldType: string, sampleRowCount: number): string {
    const lowerName = fieldName.toLowerCase();

    // Line items table - generate sample rows as JSON
    if (fieldType === 'lineItemsTable') {
      const items = [];
      for (let i = 1; i <= sampleRowCount; i++) {
        items.push({
          description: `Sample Item ${i}`,
          qty: Math.floor(Math.random() * 10) + 1,
          unitPrice: Math.floor(Math.random() * 10000) / 100,
          total: 0,
        });
        items[items.length - 1].total = items[items.length - 1].qty * items[items.length - 1].unitPrice;
      }
      return JSON.stringify(items);
    }

    // Common field name patterns
    if (lowerName.includes('date')) return '2026-03-15';
    if (lowerName.includes('number') || lowerName.includes('invoiceno') || lowerName.includes('inv_no')) return 'INV-2026-001';
    if (lowerName.includes('company') && lowerName.includes('name')) return 'Acme Corporation (Pty) Ltd';
    if (lowerName.includes('customer') && lowerName.includes('name')) return 'Sample Customer';
    if (lowerName.includes('name')) return 'Sample Name';
    if (lowerName.includes('email')) return 'sample@example.com';
    if (lowerName.includes('phone') || lowerName.includes('tel')) return '+27 11 555 0100';
    if (lowerName.includes('address')) return '123 Sample Street, Sandton, 2196';
    if (lowerName.includes('vat') && (lowerName.includes('no') || lowerName.includes('number'))) return '4123456789';
    if (lowerName.includes('total') || lowerName.includes('amount') || lowerName.includes('subtotal')) return '12,500.00';
    if (lowerName.includes('vat')) return '1,875.00';
    if (lowerName.includes('tax')) return '1,875.00';
    if (lowerName.includes('discount')) return '500.00';
    if (lowerName.includes('price') || lowerName.includes('rate')) return '250.00';
    if (lowerName.includes('qty') || lowerName.includes('quantity')) return '10';
    if (lowerName.includes('description') || lowerName.includes('desc')) return 'Sample description text';
    if (lowerName.includes('note') || lowerName.includes('comment')) return 'Sample note for preview';
    if (lowerName.includes('currency')) return 'ZAR';
    if (lowerName.includes('logo') || lowerName.includes('image') || lowerName.includes('stamp')) return '';
    if (lowerName.includes('signature')) return '';
    if (lowerName.includes('ref') || lowerName.includes('reference')) return 'REF-2026-001';
    if (lowerName.includes('terms')) return 'Payment due within 30 days';
    if (lowerName.includes('bank')) return 'First National Bank';
    if (lowerName.includes('account')) return '62123456789';
    if (lowerName.includes('branch')) return '250655';

    // Default sample value
    return `Sample ${fieldName}`;
  }
}
