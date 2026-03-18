/**
 * PrintJobService - Print job queue with reprint support
 *
 * Manages the lifecycle of print jobs:
 * PENDING -> RENDERED -> PRINTING -> COMPLETED/FAILED/PARTIAL
 *
 * Supports full reprint, range reprint, and single label reprint
 * using stored PDFs via FileStorageService.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, desc, lt, lte, or, SQL } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { printJobs } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { FileStorageService } from './file-storage.service';
import { PrinterService } from './printer.service';

export interface CreatePrintJobDto {
  orgId: string;
  templateId?: string;
  printerId: string;
  totalLabels: number;
  inputsSnapshot?: any;
  createdBy: string;
}

export interface ReprintOptions {
  fromPage?: number;
  toPage?: number;
}

export interface PrintJobFilter {
  status?: string;
  templateId?: string;
  printerId?: string;
  fromDate?: string;
  toDate?: string;
}

@Injectable()
export class PrintJobService {
  private readonly logger = new Logger(PrintJobService.name);
  private readonly retentionDays: number;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly storage: FileStorageService,
    private readonly printerService: PrinterService,
  ) {
    this.retentionDays = parseInt(process.env.PRINT_JOB_RETENTION_DAYS || '7', 10);
  }

  /**
   * Create a new print job record in PENDING status.
   */
  async create(dto: CreatePrintJobDto) {
    const id = createId();
    const now = new Date();
    const record = {
      id,
      orgId: dto.orgId,
      templateId: dto.templateId || null,
      printerId: dto.printerId,
      status: 'pending' as const,
      totalLabels: dto.totalLabels,
      labelsPrinted: 0,
      renderedPdfPath: null as string | null,
      inputsSnapshot: dto.inputsSnapshot ? JSON.parse(JSON.stringify(dto.inputsSnapshot)) : null,
      errorMessage: null as string | null,
      errorAt: null as Date | null,
      createdAt: now,
      updatedAt: now,
      completedAt: null as Date | null,
      createdBy: dto.createdBy,
    };

    await this.db.insert(printJobs).values(record);
    return record;
  }

  /**
   * List print jobs with filtering and pagination.
   */
  async findAll(orgId: string, filters?: PrintJobFilter, limit = 20, cursor?: string) {
    const conditions: SQL[] = [eq(printJobs.orgId, orgId)];

    if (filters?.status) {
      conditions.push(eq(printJobs.status, filters.status));
    }
    if (filters?.templateId) {
      conditions.push(eq(printJobs.templateId, filters.templateId));
    }
    if (filters?.printerId) {
      conditions.push(eq(printJobs.printerId, filters.printerId));
    }

    // Cursor-based pagination
    if (cursor) {
      try {
        const cursorDate = new Date(cursor);
        conditions.push(lt(printJobs.createdAt, cursorDate));
      } catch {
        // Invalid cursor, ignore
      }
    }

    const results = await this.db
      .select()
      .from(printJobs)
      .where(and(...conditions))
      .orderBy(desc(printJobs.createdAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const data = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore && data.length > 0
      ? data[data.length - 1].createdAt.toISOString()
      : null;

    return {
      data,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    };
  }

  /**
   * Get a single print job by ID (org-scoped).
   */
  async findById(orgId: string, id: string) {
    const results = await this.db
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, id), eq(printJobs.orgId, orgId)));
    return results[0] || null;
  }

  /**
   * Update print job status.
   */
  async updateStatus(
    id: string,
    status: string,
    extra?: {
      labelsPrinted?: number;
      errorMessage?: string;
      renderedPdfPath?: string;
      completedAt?: Date;
    },
  ) {
    const now = new Date();
    const updateData: Record<string, any> = {
      status,
      updatedAt: now,
    };

    if (extra?.labelsPrinted !== undefined) {
      updateData.labelsPrinted = extra.labelsPrinted;
    }
    if (extra?.errorMessage) {
      updateData.errorMessage = extra.errorMessage;
      updateData.errorAt = now;
    }
    if (extra?.renderedPdfPath) {
      updateData.renderedPdfPath = extra.renderedPdfPath;
    }
    if (extra?.completedAt) {
      updateData.completedAt = extra.completedAt;
    }

    await this.db
      .update(printJobs)
      .set(updateData)
      .where(eq(printJobs.id, id));
  }

  /**
   * Store the rendered PDF for a print job.
   */
  async storePdf(orgId: string, jobId: string, pdfData: Buffer): Promise<string> {
    const storagePath = `${orgId}/print-jobs/${jobId}.pdf`;
    await this.storage.write(storagePath, pdfData);
    await this.updateStatus(jobId, 'rendered', { renderedPdfPath: storagePath });
    return storagePath;
  }

  /**
   * Read the stored PDF for a print job.
   */
  async readPdf(pdfPath: string): Promise<Buffer> {
    return this.storage.read(pdfPath);
  }

  /**
   * Extract a page range from a PDF using pdf-lib.
   * Pages are 1-indexed (fromPage=1 means first page).
   */
  async extractPageRange(pdfData: Buffer, fromPage: number, toPage: number): Promise<Buffer> {
    // Dynamic import of pdf-lib
    const { PDFDocument } = await import('pdf-lib');

    const srcDoc = await PDFDocument.load(pdfData);
    const totalPages = srcDoc.getPageCount();

    // Clamp range
    const start = Math.max(1, fromPage);
    const end = Math.min(totalPages, toPage);

    if (start > end || start > totalPages) {
      throw new Error(`Invalid page range: ${fromPage}-${toPage} (document has ${totalPages} pages)`);
    }

    const newDoc = await PDFDocument.create();
    // pdf-lib uses 0-indexed pages
    const pageIndices = [];
    for (let i = start - 1; i < end; i++) {
      pageIndices.push(i);
    }

    const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const pdfBytes = await newDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Reprint a job - full or range.
   * Returns the PDF data that was sent (or would be sent) to the printer.
   */
  async reprint(orgId: string, jobId: string, options?: ReprintOptions) {
    const job = await this.findById(orgId, jobId);
    if (!job) {
      throw new Error('PRINT_JOB_NOT_FOUND');
    }

    if (!job.renderedPdfPath) {
      throw new Error('NO_RENDERED_PDF: Print job has no stored PDF');
    }

    // Read the stored PDF
    let pdfData = await this.readPdf(job.renderedPdfPath);

    // Extract page range if specified
    if (options?.fromPage || options?.toPage) {
      const from = options.fromPage || 1;
      const to = options.toPage || job.totalLabels;
      pdfData = await this.extractPageRange(pdfData, from, to);
    }

    // Look up the printer
    const printer = await this.printerService.findById(orgId, job.printerId!);

    // Update job status to PRINTING
    await this.updateStatus(jobId, 'printing');

    // Try to send to printer (if printer exists and is reachable)
    let printError: string | null = null;
    if (printer) {
      try {
        await this.printerService.sendToPrinter(printer.host, printer.port, pdfData);
        await this.updateStatus(jobId, 'completed', {
          labelsPrinted: job.totalLabels,
          completedAt: new Date(),
        });
      } catch (err: any) {
        printError = err.message;
        await this.updateStatus(jobId, 'failed', {
          errorMessage: err.message,
        });
        // Don't throw - return the result with error info so caller can still report pdfSize
      }
    } else {
      printError = 'Printer not found or removed';
      await this.updateStatus(jobId, 'failed', {
        errorMessage: printError,
      });
    }

    return { job, pdfData, pdfSize: pdfData.length, printError };
  }

  /**
   * Delete a print job and its stored PDF.
   */
  async delete(orgId: string, id: string) {
    const job = await this.findById(orgId, id);
    if (!job) return null;

    // Delete stored PDF if it exists
    if (job.renderedPdfPath) {
      try {
        await this.storage.delete(job.renderedPdfPath);
      } catch {
        // File may already be gone
      }
    }

    await this.db.delete(printJobs).where(and(eq(printJobs.id, id), eq(printJobs.orgId, orgId)));
    return job;
  }

  /**
   * Retention cleanup - delete print jobs older than retentionDays.
   * Returns the number of deleted jobs.
   */
  async cleanupExpired(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);

    // Find expired jobs
    const expired = await this.db
      .select()
      .from(printJobs)
      .where(lt(printJobs.createdAt, cutoff));

    let deleted = 0;
    for (const job of expired) {
      // Delete stored PDF
      if (job.renderedPdfPath) {
        try {
          await this.storage.delete(job.renderedPdfPath);
        } catch {
          // File may already be gone
        }
      }
      await this.db.delete(printJobs).where(eq(printJobs.id, job.id));
      deleted++;
    }

    this.logger.log(`Retention cleanup: deleted ${deleted} expired print jobs (older than ${this.retentionDays} days)`);
    return deleted;
  }
}
