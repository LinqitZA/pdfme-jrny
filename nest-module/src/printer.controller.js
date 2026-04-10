"use strict";
/**
 * PrinterController - REST endpoints for printer management and print jobs
 *
 * Endpoints:
 * - GET    /api/pdfme/printers              (list configured printers)
 * - POST   /api/pdfme/printers              (add a printer)
 * - DELETE /api/pdfme/printers/:id          (remove a printer)
 * - POST   /api/pdfme/print                 (send a print job)
 * - GET    /api/pdfme/print-jobs            (list print jobs)
 * - GET    /api/pdfme/print-jobs/:id        (get job details)
 * - POST   /api/pdfme/print-jobs/:id/reprint (reprint a job)
 * - DELETE /api/pdfme/print-jobs/:id        (delete a job)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const printer_service_1 = require("./printer.service");
const print_job_service_1 = require("./print-job.service");
const render_service_1 = require("./render.service");
const audit_service_1 = require("./audit.service");
const auth_guard_1 = require("./auth.guard");
function decodeJwt(authHeader) {
    if (!authHeader?.startsWith('Bearer '))
        return null;
    try {
        const token = authHeader.slice(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return {
            sub: payload.sub || 'unknown',
            orgId: payload.orgId || '',
            roles: payload.roles || [],
        };
    }
    catch {
        return null;
    }
}
let PrinterController = class PrinterController {
    printerService;
    printJobService;
    renderService;
    auditService;
    constructor(printerService, printJobService, renderService, auditService) {
        this.printerService = printerService;
        this.printJobService = printJobService;
        this.renderService = renderService;
        this.auditService = auditService;
    }
    // ─── Printers ────────────────────────────────────────────────────
    async listPrinters(req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const data = await this.printerService.findAll(user.orgId);
        return { data };
    }
    async createPrinter(body, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        if (!body.name || !body.host) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'name and host are required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // SSRF validation
        if (!printer_service_1.PrinterService.validateHost(body.host)) {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: `Printer host '${body.host}' is not on a private network. Only private IPs are allowed for security.` }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        try {
            const printer = await this.printerService.create(user.orgId, body);
            return printer;
        }
        catch (err) {
            if (err.message?.startsWith('SSRF_BLOCKED')) {
                throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: err.message }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
            }
            throw err;
        }
    }
    async deletePrinter(id, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const deleted = await this.printerService.delete(user.orgId, id);
        if (!deleted) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Printer not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        return { deleted: true, id };
    }
    // ─── Print (trigger job) ─────────────────────────────────────────
    async print(body, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        if (!body.templateId || !body.printerId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'templateId and printerId are required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Verify printer exists
        const printer = await this.printerService.findById(user.orgId, body.printerId);
        if (!printer) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Printer not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        const inputs = body.inputs || [{}];
        const totalLabels = inputs.length;
        // Create print job record (PENDING)
        const job = await this.printJobService.create({
            orgId: user.orgId,
            templateId: body.templateId,
            printerId: body.printerId,
            totalLabels,
            inputsSnapshot: inputs,
            createdBy: user.sub,
        });
        // Render PDF
        try {
            const renderResult = await this.renderService.renderNow({
                templateId: body.templateId,
                entityId: `print-job-${job.id}`,
                entityType: 'label',
                channel: 'print',
                inputs,
                storeInputSnapshot: true,
            }, user.orgId, user.sub);
            if (renderResult.error || !renderResult.document) {
                await this.printJobService.updateStatus(job.id, 'failed', {
                    errorMessage: `Render failed: ${renderResult.error || 'Unknown error'}`,
                });
            }
            else {
                // Read the generated PDF from file storage
                const pdfDownload = await this.renderService.getDocumentForDownload(renderResult.document.id, user.orgId);
                if ('error' in pdfDownload) {
                    await this.printJobService.updateStatus(job.id, 'failed', {
                        errorMessage: `PDF read failed: ${pdfDownload.error}`,
                    });
                }
                else {
                    // Store the rendered PDF in print-job storage
                    await this.printJobService.storePdf(user.orgId, job.id, pdfDownload.buffer);
                    // Update to PRINTING status
                    await this.printJobService.updateStatus(job.id, 'printing');
                    // Send to printer
                    try {
                        await this.printerService.sendToPrinter(printer.host, printer.port, pdfDownload.buffer);
                        await this.printJobService.updateStatus(job.id, 'completed', {
                            labelsPrinted: totalLabels,
                            completedAt: new Date(),
                        });
                    }
                    catch (printErr) {
                        await this.printJobService.updateStatus(job.id, 'failed', {
                            errorMessage: printErr.message,
                        });
                        // Still return the job - user can reprint later
                    }
                }
            }
        }
        catch (renderErr) {
            await this.printJobService.updateStatus(job.id, 'failed', {
                errorMessage: `Render failed: ${renderErr.message}`,
            });
        }
        // Return the job with latest status
        const updatedJob = await this.printJobService.findById(user.orgId, job.id);
        return { jobId: job.id, ...updatedJob };
    }
    // ─── Print Jobs ──────────────────────────────────────────────────
    async listPrintJobs(req, status, templateId, printerId, fromDate, toDate, limitStr, cursor) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const limit = Math.min(Math.max(parseInt(limitStr || '20', 10) || 20, 1), 100);
        const filters = { status, templateId, printerId, fromDate, toDate };
        return this.printJobService.findAll(user.orgId, filters, limit, cursor);
    }
    // ─── Retention Cleanup (must be before :id routes) ───────────────
    async triggerCleanup(req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const deleted = await this.printJobService.cleanupExpired();
        return { deletedJobs: deleted, retentionDays: parseInt(process.env.PRINT_JOB_RETENTION_DAYS || '7', 10) };
    }
    async getPrintJob(id, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const job = await this.printJobService.findById(user.orgId, id);
        if (!job) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        return job;
    }
    async reprintJob(id, body, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const job = await this.printJobService.findById(user.orgId, id);
        if (!job) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        if (!job.renderedPdfPath) {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'No rendered PDF available for reprint' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const options = {};
        if (body.fromPage)
            options.fromPage = body.fromPage;
        if (body.toPage)
            options.toPage = body.toPage;
        try {
            const result = await this.printJobService.reprint(user.orgId, id, options);
            const updatedJob = await this.printJobService.findById(user.orgId, id);
            return {
                jobId: id,
                status: updatedJob?.status || 'unknown',
                pdfSize: result.pdfSize,
                reprinted: !result.printError,
                pageRange: options.fromPage ? { from: options.fromPage, to: options.toPage || job.totalLabels } : 'full',
                ...(result.printError ? { error: result.printError } : {}),
            };
        }
        catch (err) {
            if (err.message === 'PRINT_JOB_NOT_FOUND') {
                throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, common_1.HttpStatus.NOT_FOUND);
            }
            // If something unexpected fails, return error info
            const updatedJob = await this.printJobService.findById(user.orgId, id);
            return {
                jobId: id,
                status: updatedJob?.status || 'failed',
                error: err.message,
                reprinted: false,
            };
        }
    }
    async deletePrintJob(id, req) {
        const user = decodeJwt(req.headers.authorization);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const deleted = await this.printJobService.delete(user.orgId, id);
        if (!deleted) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, common_1.HttpStatus.NOT_FOUND);
        }
        return { deleted: true, id };
    }
};
exports.PrinterController = PrinterController;
tslib_1.__decorate([
    (0, common_1.Get)('printers'),
    (0, auth_guard_1.RequirePermissions)('printer:read'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "listPrinters", null);
tslib_1.__decorate([
    (0, common_1.Post)('printers'),
    (0, common_1.HttpCode)(201),
    (0, auth_guard_1.RequirePermissions)('printer:write'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "createPrinter", null);
tslib_1.__decorate([
    (0, common_1.Delete)('printers/:id'),
    (0, auth_guard_1.RequirePermissions)('printer:write'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "deletePrinter", null);
tslib_1.__decorate([
    (0, common_1.Post)('print'),
    (0, common_1.HttpCode)(201),
    (0, auth_guard_1.RequirePermissions)('render:trigger'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "print", null);
tslib_1.__decorate([
    (0, common_1.Get)('print-jobs'),
    (0, auth_guard_1.RequirePermissions)('printer:read'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('status')),
    tslib_1.__param(2, (0, common_1.Query)('templateId')),
    tslib_1.__param(3, (0, common_1.Query)('printerId')),
    tslib_1.__param(4, (0, common_1.Query)('fromDate')),
    tslib_1.__param(5, (0, common_1.Query)('toDate')),
    tslib_1.__param(6, (0, common_1.Query)('limit')),
    tslib_1.__param(7, (0, common_1.Query)('cursor')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "listPrintJobs", null);
tslib_1.__decorate([
    (0, common_1.Post)('print-jobs/cleanup'),
    (0, common_1.HttpCode)(200),
    (0, auth_guard_1.RequirePermissions)('admin'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "triggerCleanup", null);
tslib_1.__decorate([
    (0, common_1.Get)('print-jobs/:id'),
    (0, auth_guard_1.RequirePermissions)('printer:read'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "getPrintJob", null);
tslib_1.__decorate([
    (0, common_1.Post)('print-jobs/:id/reprint'),
    (0, common_1.HttpCode)(200),
    (0, auth_guard_1.RequirePermissions)('render:trigger'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "reprintJob", null);
tslib_1.__decorate([
    (0, common_1.Delete)('print-jobs/:id'),
    (0, auth_guard_1.RequirePermissions)('printer:write'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], PrinterController.prototype, "deletePrintJob", null);
exports.PrinterController = PrinterController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme'),
    tslib_1.__metadata("design:paramtypes", [printer_service_1.PrinterService,
        print_job_service_1.PrintJobService,
        render_service_1.RenderService,
        audit_service_1.AuditService])
], PrinterController);
//# sourceMappingURL=printer.controller.js.map