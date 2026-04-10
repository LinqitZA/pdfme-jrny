"use strict";
/**
 * PrintJobService - Print job queue with reprint support
 *
 * Manages the lifecycle of print jobs:
 * PENDING -> RENDERED -> PRINTING -> COMPLETED/FAILED/PARTIAL
 *
 * Supports full reprint, range reprint, and single label reprint
 * using stored PDFs via FileStorageService.
 */
var PrintJobService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrintJobService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const cuid2_1 = require("@paralleldrive/cuid2");
const schema_1 = require("./db/schema");
const file_storage_service_1 = require("./file-storage.service");
const printer_service_1 = require("./printer.service");
let PrintJobService = PrintJobService_1 = class PrintJobService {
    db;
    storage;
    printerService;
    logger = new common_1.Logger(PrintJobService_1.name);
    retentionDays;
    constructor(db, storage, printerService) {
        this.db = db;
        this.storage = storage;
        this.printerService = printerService;
        this.retentionDays = parseInt(process.env.PRINT_JOB_RETENTION_DAYS || '7', 10);
    }
    /**
     * Create a new print job record in PENDING status.
     */
    async create(dto) {
        const id = (0, cuid2_1.createId)();
        const now = new Date();
        const record = {
            id,
            orgId: dto.orgId,
            templateId: dto.templateId || null,
            printerId: dto.printerId,
            status: 'pending',
            totalLabels: dto.totalLabels,
            labelsPrinted: 0,
            renderedPdfPath: null,
            inputsSnapshot: dto.inputsSnapshot ? JSON.parse(JSON.stringify(dto.inputsSnapshot)) : null,
            errorMessage: null,
            errorAt: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            createdBy: dto.createdBy,
        };
        await this.db.insert(schema_1.printJobs).values(record);
        return record;
    }
    /**
     * List print jobs with filtering and pagination.
     */
    async findAll(orgId, filters, limit = 20, cursor) {
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.printJobs.orgId, orgId)];
        if (filters?.status) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.printJobs.status, filters.status));
        }
        if (filters?.templateId) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.printJobs.templateId, filters.templateId));
        }
        if (filters?.printerId) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.printJobs.printerId, filters.printerId));
        }
        // Cursor-based pagination
        if (cursor) {
            try {
                const cursorDate = new Date(cursor);
                conditions.push((0, drizzle_orm_1.lt)(schema_1.printJobs.createdAt, cursorDate));
            }
            catch {
                // Invalid cursor, ignore
            }
        }
        const results = await this.db
            .select()
            .from(schema_1.printJobs)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.printJobs.createdAt))
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
    async findById(orgId, id) {
        const results = await this.db
            .select()
            .from(schema_1.printJobs)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.printJobs.id, id), (0, drizzle_orm_1.eq)(schema_1.printJobs.orgId, orgId)));
        return results[0] || null;
    }
    /**
     * Update print job status.
     */
    async updateStatus(id, status, extra) {
        const now = new Date();
        const updateData = {
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
            .update(schema_1.printJobs)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.printJobs.id, id));
    }
    /**
     * Store the rendered PDF for a print job.
     */
    async storePdf(orgId, jobId, pdfData) {
        const storagePath = `${orgId}/print-jobs/${jobId}.pdf`;
        await this.storage.write(storagePath, pdfData);
        await this.updateStatus(jobId, 'rendered', { renderedPdfPath: storagePath });
        return storagePath;
    }
    /**
     * Read the stored PDF for a print job.
     */
    async readPdf(pdfPath) {
        return this.storage.read(pdfPath);
    }
    /**
     * Extract a page range from a PDF using pdf-lib.
     * Pages are 1-indexed (fromPage=1 means first page).
     */
    async extractPageRange(pdfData, fromPage, toPage) {
        // Dynamic import of pdf-lib
        const { PDFDocument } = await Promise.resolve().then(() => tslib_1.__importStar(require('pdf-lib')));
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
    async reprint(orgId, jobId, options) {
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
        const printer = await this.printerService.findById(orgId, job.printerId);
        // Update job status to PRINTING
        await this.updateStatus(jobId, 'printing');
        // Try to send to printer (if printer exists and is reachable)
        let printError = null;
        if (printer) {
            try {
                await this.printerService.sendToPrinter(printer.host, printer.port, pdfData);
                await this.updateStatus(jobId, 'completed', {
                    labelsPrinted: job.totalLabels,
                    completedAt: new Date(),
                });
            }
            catch (err) {
                printError = err.message;
                await this.updateStatus(jobId, 'failed', {
                    errorMessage: err.message,
                });
                // Don't throw - return the result with error info so caller can still report pdfSize
            }
        }
        else {
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
    async delete(orgId, id) {
        const job = await this.findById(orgId, id);
        if (!job)
            return null;
        // Delete stored PDF if it exists
        if (job.renderedPdfPath) {
            try {
                await this.storage.delete(job.renderedPdfPath);
            }
            catch {
                // File may already be gone
            }
        }
        await this.db.delete(schema_1.printJobs).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.printJobs.id, id), (0, drizzle_orm_1.eq)(schema_1.printJobs.orgId, orgId)));
        return job;
    }
    /**
     * Retention cleanup - delete print jobs older than retentionDays.
     * Returns the number of deleted jobs.
     */
    async cleanupExpired() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.retentionDays);
        // Find expired jobs
        const expired = await this.db
            .select()
            .from(schema_1.printJobs)
            .where((0, drizzle_orm_1.lt)(schema_1.printJobs.createdAt, cutoff));
        let deleted = 0;
        for (const job of expired) {
            // Delete stored PDF
            if (job.renderedPdfPath) {
                try {
                    await this.storage.delete(job.renderedPdfPath);
                }
                catch {
                    // File may already be gone
                }
            }
            await this.db.delete(schema_1.printJobs).where((0, drizzle_orm_1.eq)(schema_1.printJobs.id, job.id));
            deleted++;
        }
        this.logger.log(`Retention cleanup: deleted ${deleted} expired print jobs (older than ${this.retentionDays} days)`);
        return deleted;
    }
};
exports.PrintJobService = PrintJobService;
exports.PrintJobService = PrintJobService = PrintJobService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)('DRIZZLE_DB')),
    tslib_1.__param(1, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__metadata("design:paramtypes", [Object, file_storage_service_1.FileStorageService,
        printer_service_1.PrinterService])
], PrintJobService);
//# sourceMappingURL=print-job.service.js.map