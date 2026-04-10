"use strict";
/**
 * RenderController - REST endpoints for PDF rendering
 *
 * Endpoints:
 * - POST   /api/pdfme/render/now                    (synchronous render)
 * - POST   /api/pdfme/render/bulk                   (batch render - returns batchId)
 * - GET    /api/pdfme/render/batch/:batchId         (batch status)
 * - GET    /api/pdfme/render/batch/:batchId/progress (SSE progress stream)
 * - POST   /api/pdfme/render/batch/:batchId/merge   (merge batch PDFs)
 * - GET    /api/pdfme/render/history                (paginated render history)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const render_service_1 = require("./render.service");
const pdfa_processor_1 = require("./pdfa-processor");
const render_queue_service_1 = require("./render-queue.service");
const auth_guard_1 = require("./auth.guard");
const rate_limiter_service_1 = require("./rate-limiter.service");
let RenderController = class RenderController {
    renderService;
    pdfaProcessor;
    renderQueueService;
    rateLimiterService;
    constructor(renderService, pdfaProcessor, renderQueueService, rateLimiterService) {
        this.renderService = renderService;
        this.pdfaProcessor = pdfaProcessor;
        this.renderQueueService = renderQueueService;
        this.rateLimiterService = rateLimiterService;
    }
    async renderNow(body, req) {
        // Validate required fields with detailed error envelope
        const missingFields = [];
        if (!body.templateId)
            missingFields.push('templateId');
        if (!body.entityId)
            missingFields.push('entityId');
        if (!body.channel)
            missingFields.push('channel');
        if (missingFields.length > 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'templateId, entityId, and channel are required',
                details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate channel value (must be email or print)
        const VALID_CHANNELS = ['email', 'print'];
        if (body.channel && !VALID_CHANNELS.includes(body.channel)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: `Invalid channel: "${body.channel}". Must be one of: ${VALID_CHANNELS.join(', ')}`,
                details: [{ field: 'channel', reason: `must be one of: ${VALID_CHANNELS.join(', ')}` }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate templateId format (must be non-empty string)
        if (typeof body.templateId !== 'string' || body.templateId.trim() === '') {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'templateId must be a non-empty string',
                details: [{ field: 'templateId', reason: 'must be a non-empty string identifier' }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate layout parameter if provided
        if (body.layout !== undefined && body.layout !== 'single') {
            if (typeof body.layout !== 'object' || body.layout === null) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: "layout must be 'single' or an object with type: 'sheet'",
                    details: [{ field: 'layout', reason: "must be 'single' or {type: 'sheet', columns, rows}" }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
            const layout = body.layout;
            if (layout.type !== 'sheet') {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: "layout.type must be 'sheet'",
                    details: [{ field: 'layout.type', reason: "must be 'sheet'" }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
            if (!layout.columns || !layout.rows || typeof layout.columns !== 'number' || typeof layout.rows !== 'number' || layout.columns < 1 || layout.rows < 1) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: 'layout.columns and layout.rows must be positive integers',
                    details: [{ field: 'layout.columns/rows', reason: 'must be positive integers' }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
            if (layout.sheetSize && !['A4', 'Letter'].includes(layout.sheetSize)) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: "layout.sheetSize must be 'A4' or 'Letter'",
                    details: [{ field: 'layout.sheetSize', reason: "must be 'A4' or 'Letter'" }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
        }
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Rate limit: 60 req/min per tenant
        const rateCheck = this.rateLimiterService.checkAndRecord('render:now', user.orgId);
        if (!rateCheck.allowed) {
            const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000);
            throw new common_1.HttpException({
                statusCode: 429,
                error: 'Too Many Requests',
                message: `Rate limit exceeded: ${rateCheck.limit} requests per ${Math.round(rateCheck.windowMs / 1000)} seconds`,
                retryAfter: retryAfterSeconds,
            }, 429);
        }
        const result = await this.renderService.renderNow(body, user.orgId, user.sub);
        if ('error' in result && !('document' in result)) {
            const code = result.statusCode || 404;
            const errorLabels = {
                400: 'Bad Request',
                404: 'Not Found',
                413: 'Payload Too Large',
                422: 'Unprocessable Entity',
            };
            const errorLabel = errorLabels[code] || 'Error';
            throw new common_1.HttpException({
                statusCode: code,
                error: errorLabel,
                message: result.error,
                ...(result.templateStatus ? { templateStatus: result.templateStatus } : {}),
                ...(result.quotaExceeded ? {
                    quotaExceeded: true,
                    currentUsageBytes: result.currentUsageBytes,
                    quotaBytes: result.quotaBytes,
                } : {}),
            }, code);
        }
        if ('error' in result && 'document' in result) {
            // Serialize Date objects to ISO strings for proper JSON response
            const doc = result.document;
            const serializedDoc = {
                ...doc,
                createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
            };
            throw new common_1.HttpException({
                statusCode: 500,
                error: 'Internal Server Error',
                message: result.error,
                document: serializedDoc,
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
        // Add downloadUrl for the client to use
        if ('document' in result && result.document?.id) {
            // Serialize Date objects to ISO strings for proper JSON response
            const doc = result.document;
            const serializedDoc = {
                ...doc,
                createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
            };
            return {
                document: serializedDoc,
                downloadUrl: `/api/pdfme/render/document/${result.document.id}`,
            };
        }
        return result;
    }
    async renderBulk(body, req) {
        // Validate required fields with detailed error envelope
        {
            const missingFields = [];
            if (!body.templateId)
                missingFields.push('templateId');
            if (!body.entityIds || !Array.isArray(body.entityIds) || body.entityIds.length === 0)
                missingFields.push('entityIds');
            if (!body.channel)
                missingFields.push('channel');
            if (missingFields.length > 0) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: 'templateId, entityIds (non-empty array), and channel are required',
                    details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
                }, common_1.HttpStatus.BAD_REQUEST);
            }
        }
        // Validate channel value (must be email or print)
        {
            const VALID_CHANNELS = ['email', 'print'];
            if (body.channel && !VALID_CHANNELS.includes(body.channel)) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: `Invalid channel: "${body.channel}". Must be one of: ${VALID_CHANNELS.join(', ')}`,
                    details: [{ field: 'channel', reason: `must be one of: ${VALID_CHANNELS.join(', ')}` }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
        }
        // Validate entityIds entries are non-null, non-empty strings
        const invalidIndices = [];
        for (let i = 0; i < body.entityIds.length; i++) {
            const id = body.entityIds[i];
            if (id === null || id === undefined || typeof id !== 'string' || id.trim() === '') {
                invalidIndices.push(i);
            }
        }
        if (invalidIndices.length > 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'entityIds must contain only non-empty strings',
                details: [{ field: 'entityIds', reason: `Invalid entries at indices: ${invalidIndices.join(', ')}. Each entityId must be a non-empty string.` }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Feature #272: Validate entityIds uniqueness - reject duplicates
        const uniqueIds = new Set(body.entityIds);
        if (uniqueIds.size < body.entityIds.length) {
            const duplicates = [];
            const seen = new Set();
            for (const id of body.entityIds) {
                if (seen.has(id)) {
                    if (!duplicates.includes(id))
                        duplicates.push(id);
                }
                seen.add(id);
            }
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'entityIds must be unique. Duplicate IDs found.',
                details: [{
                        field: 'entityIds',
                        reason: `${duplicates.length} duplicate ID(s) found: ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? '...' : ''}`,
                        duplicates: duplicates.slice(0, 20),
                    }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (body.entityIds.length > 2000) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Maximum 2000 entityIds per request',
                details: [{ field: 'entityIds', reason: `array length ${body.entityIds.length} exceeds maximum of 2000` }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate onFailure parameter (must be continue or abort)
        {
            const VALID_ON_FAILURE = ['continue', 'abort'];
            if (body.onFailure !== undefined && body.onFailure !== null && body.onFailure !== '') {
                if (!VALID_ON_FAILURE.includes(body.onFailure)) {
                    throw new common_1.HttpException({
                        statusCode: 400,
                        error: 'Bad Request',
                        message: `Invalid onFailure: "${body.onFailure}". Must be one of: ${VALID_ON_FAILURE.join(', ')}`,
                        details: [{ field: 'onFailure', reason: `must be one of: ${VALID_ON_FAILURE.join(', ')}` }],
                    }, common_1.HttpStatus.BAD_REQUEST);
                }
            }
        }
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Rate limit: 5 req/hour per tenant
        const bulkRateCheck = this.rateLimiterService.checkAndRecord('render:bulk', user.orgId);
        if (!bulkRateCheck.allowed) {
            const retryAfterSeconds = Math.ceil(bulkRateCheck.retryAfterMs / 1000);
            throw new common_1.HttpException({
                statusCode: 429,
                error: 'Too Many Requests',
                message: `Rate limit exceeded: ${bulkRateCheck.limit} requests per ${Math.round(bulkRateCheck.windowMs / 1000)} seconds`,
                retryAfter: retryAfterSeconds,
            }, 429);
        }
        const result = await this.renderService.renderBulk(body, user.orgId, user.sub);
        // If there's an existing running batch, return 409 Conflict
        if (result.conflict) {
            throw new common_1.HttpException({
                statusCode: 409,
                error: 'Conflict',
                message: result.error,
                existingBatchId: result.existingBatchId,
                status: result.status,
                totalJobs: result.totalJobs,
                completedJobs: result.completedJobs,
            }, common_1.HttpStatus.CONFLICT);
        }
        return result;
    }
    async getBatchStatus(batchId, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const batch = await this.renderService.getBatchStatus(batchId, user.orgId);
        if (!batch) {
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: 'Batch not found',
            }, common_1.HttpStatus.NOT_FOUND);
        }
        return batch;
    }
    async getBatchProgress(batchId, req, res) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Verify batch exists
        const batch = await this.renderService.getBatchStatus(batchId, user.orgId);
        if (!batch) {
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: 'Batch not found',
            }, common_1.HttpStatus.NOT_FOUND);
        }
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        // If batch is already complete, send current status and close
        if (batch.status !== 'running') {
            res.write(`data: ${JSON.stringify({ type: 'batch_complete', status: batch.status, completedJobs: batch.completedJobs, failedJobs: batch.failedJobs, totalJobs: batch.totalJobs })}\n\n`);
            res.end();
            return;
        }
        // Listen for events
        const eventKey = `batch:${batchId}`;
        const listener = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (event.type === 'batch_complete') {
                // Clean up and close
                this.renderService.batchEvents.removeListener(eventKey, listener);
                res.end();
            }
        };
        this.renderService.batchEvents.on(eventKey, listener);
        // Clean up on client disconnect
        req.on('close', () => {
            this.renderService.batchEvents.removeListener(eventKey, listener);
        });
    }
    async downloadDocument(documentId, req, res) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.renderService.getDocumentForDownload(documentId, user.orgId);
        if ('error' in result) {
            throw new common_1.HttpException({
                statusCode: result.statusCode,
                error: result.statusCode === 404 ? 'Not Found' : 'Internal Server Error',
                message: result.error,
            }, result.statusCode);
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${documentId}.pdf"`);
        res.setHeader('Content-Length', result.buffer.length);
        res.setHeader('ETag', `"${result.pdfHash}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(result.buffer);
    }
    /**
     * Get the input snapshot for a generated document (for audit/reproduction)
     */
    async getDocumentSnapshot(documentId, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.renderService.getDocumentSnapshot(documentId, user.orgId);
        if ('error' in result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: result.error }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async downloadPreview(previewId, req, res) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.renderService.getPreviewForDownload(previewId, user.orgId);
        if ('error' in result) {
            throw new common_1.HttpException({
                statusCode: result.statusCode,
                error: result.statusCode === 410 ? 'Gone' : 'Not Found',
                message: result.error,
            }, result.statusCode);
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${previewId}.pdf"`);
        res.setHeader('Content-Length', result.buffer.length);
        res.send(result.buffer);
    }
    async listHistory(limitStr, cursor, entityType, status, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const limit = limitStr ? parseInt(limitStr, 10) : 10;
        const result = await this.renderService.listHistory(user.orgId, {
            limit: isNaN(limit) ? 10 : limit,
            cursor: cursor || undefined,
            entityType: entityType || undefined,
            status: status || undefined,
        });
        return result;
    }
    async listAllDocuments(entityType, status, limitStr, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const limit = limitStr ? parseInt(limitStr, 10) : 100;
        const result = await this.renderService.listDocuments(user.orgId, entityType, status, isNaN(limit) ? 100 : limit);
        return {
            ...result,
            ...(entityType ? { filter: { entityType } } : {}),
            ...(status ? { filter: { ...((entityType ? { entityType } : {})), status } } : {}),
        };
    }
    async listDocumentsByTemplate(templateId, status, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate status filter if provided
        const validStatuses = ['queued', 'generating', 'done', 'failed'];
        if (status && !validStatuses.includes(status)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: `Invalid status filter: ${status}. Valid values: ${validStatuses.join(', ')}`,
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const documents = await this.renderService.listDocumentsByTemplate(templateId, user.orgId, status);
        return {
            data: documents,
            pagination: { total: documents.length },
            ...(status ? { filter: { status } } : {}),
        };
    }
    async simulateStorageFailure(body) {
        const fileStorage = this.renderService.fileStorage;
        if (typeof fileStorage.setSimulatedFailures === 'function') {
            fileStorage.setSimulatedFailures(body.failureCount || 0);
            return {
                simulatedFailures: body.failureCount || 0,
                message: `Next ${body.failureCount || 0} storage operations will fail`,
            };
        }
        return { error: 'File storage adapter does not support failure simulation' };
    }
    async setRetryConfig(body) {
        this.renderService.setRetryConfig(body);
        return {
            config: this.renderService.getRetryConfig(),
        };
    }
    async getRetryConfig() {
        return {
            config: this.renderService.getRetryConfig(),
            lastRetryAttempts: this.renderService.lastRetryAttempts,
        };
    }
    async forceExpirePreview(body) {
        if (!body.previewId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'previewId is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const success = this.renderService.forceExpirePreview(body.previewId);
        return { expired: success, previewId: body.previewId };
    }
    async purgeExpiredPreviews() {
        const result = await this.renderService.purgeExpiredPreviews();
        return {
            ...result,
            lastPurge: this.renderService.lastPurgeResult,
        };
    }
    getPurgeStatus() {
        return {
            lastPurge: this.renderService.lastPurgeResult,
            registrySize: this.renderService.previewRegistry.size,
            purgeIntervalMs: this.renderService.purgeIntervalMs,
            retentionPeriodMs: this.renderService.retentionPeriodMs,
        };
    }
    async verifyDocument(documentId, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.renderService.verifyDocument(documentId, user.orgId);
        if ('error' in result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: result.error }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async validatePdfA(body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body.documentPath) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'documentPath is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        try {
            const fileStorage = this.renderService.fileStorage;
            const pdfBuffer = await fileStorage.read(body.documentPath);
            const result = await this.pdfaProcessor.validate(pdfBuffer);
            return result;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({ statusCode: 500, error: 'Internal Server Error', message: `Validation failed: ${msg}` }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async validatePdfUA(body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body.documentId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'documentId is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Get the document to find its file path
        const docResult = await this.renderService.getDocumentForDownload(body.documentId, user.orgId);
        if ('error' in docResult) {
            throw new common_1.HttpException({ statusCode: docResult.statusCode, error: 'Not Found', message: docResult.error }, docResult.statusCode);
        }
        const result = await this.pdfaProcessor.validatePdfUA(docResult.buffer);
        return result;
    }
    async forcePdfaFailure(body) {
        const msg = body.errorMessage !== undefined ? body.errorMessage : null;
        this.pdfaProcessor.setForceFailure(msg);
        return {
            forceFailure: msg !== null,
            errorMessage: msg,
        };
    }
    async checkFonts(body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body.templateId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'templateId is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Use the render service's resolveFonts to check font availability
        const result = await this.renderService.checkTemplateFonts(body.templateId, user.orgId);
        if ('error' in result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: result.error }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    /**
     * Format a currency value for testing/preview.
     * POST /api/pdfme/render/format-currency
     */
    formatCurrency(body) {
        const { formatCurrencyField, resolveCurrencySymbol } = require('../../packages/erp-schemas/src/currency-field');
        if (body.value === undefined || body.value === null) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'value is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const schema = {
            type: 'currencyField',
            name: 'test',
            currencyCode: body.currencyCode,
            currencySymbol: body.currencySymbol,
            symbolPosition: body.symbolPosition,
            thousandSeparator: body.thousandSeparator,
            decimalSeparator: body.decimalSeparator,
            decimalPlaces: body.decimalPlaces,
            showCurrencyCode: body.showCurrencyCode,
            dualCurrency: body.dualCurrency,
            position: { x: 0, y: 0 },
            width: 60,
            height: 15,
        };
        const context = {};
        if (body.dualCurrency?.exchangeRate) {
            context.exchangeRate = body.dualCurrency.exchangeRate;
        }
        const result = formatCurrencyField(Number(body.value), schema, undefined, context);
        return {
            formattedValue: result.formattedValue,
            rawValue: result.rawValue,
            currencyCode: result.currencyCode,
            currencySymbol: result.currencySymbol,
            dualCurrencyValue: result.dualCurrencyValue,
            dualCurrencyRaw: result.dualCurrencyRaw,
        };
    }
    /**
     * Submit an async render job to the queue.
     * Returns a jobId that can be polled via GET /render/status/:jobId
     * Available at both POST /render/queue and POST /render/async
     */
    async renderQueue(body, req) {
        return this.renderAsync(body, req);
    }
    /**
     * Submit an async render job to the queue (alias).
     * Returns a jobId that can be polled via GET /render/status/:jobId
     */
    async renderAsync(body, req) {
        // Validate required fields
        const missingFields = [];
        if (!body.templateId)
            missingFields.push('templateId');
        if (!body.entityId)
            missingFields.push('entityId');
        if (!body.channel)
            missingFields.push('channel');
        if (missingFields.length > 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'templateId, entityId, and channel are required',
                details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate channel value (must be email or print)
        {
            const VALID_CHANNELS = ['email', 'print'];
            if (body.channel && !VALID_CHANNELS.includes(body.channel)) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: `Invalid channel: "${body.channel}". Must be one of: ${VALID_CHANNELS.join(', ')}`,
                    details: [{ field: 'channel', reason: `must be one of: ${VALID_CHANNELS.join(', ')}` }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
        }
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const jobId = await this.renderQueueService.addJob({
            templateId: body.templateId,
            entityId: body.entityId,
            entityType: body.entityType || 'document',
            orgId: user.orgId,
            channel: body.channel,
            triggeredBy: user.sub || 'anonymous',
            inputs: body.inputs,
        });
        return {
            jobId,
            status: 'queued',
            message: 'Render job submitted. Poll GET /api/pdfme/render/status/' + jobId + ' for progress.',
        };
    }
    /**
     * Poll async render job status.
     * Returns normalized status: queued | generating | done | failed
     */
    async getRenderStatus(jobId) {
        const jobStatus = await this.renderQueueService.getJobStatus(jobId);
        if (!jobStatus) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Render job ${jobId} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        // Map BullMQ states to user-friendly status
        let status;
        switch (jobStatus.state) {
            case 'waiting':
            case 'delayed':
            case 'prioritized':
            case 'wait':
                status = 'queued';
                break;
            case 'active':
                status = 'generating';
                break;
            case 'completed':
                status = 'done';
                break;
            case 'failed':
                status = 'failed';
                break;
            default:
                status = 'queued';
        }
        return {
            jobId: jobStatus.id,
            status,
            attemptsMade: jobStatus.attemptsMade,
            maxAttempts: jobStatus.maxAttempts,
            result: jobStatus.result || null,
            error: jobStatus.failedReason || null,
            attemptLog: jobStatus.attemptLog,
        };
    }
    getFontCacheStats() {
        return this.renderService.getFontCacheStats();
    }
    clearFontCache() {
        const result = this.renderService.clearFontCache();
        return {
            ...result,
            message: `Cleared ${result.cleared} cached fonts, freed ${Math.round(result.freedBytes / 1024)} KB`,
        };
    }
    async mergeBatchPdfs(batchId, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.renderService.mergeBatchPdfs(batchId, user.orgId);
        if ('error' in result) {
            const status = result.error === 'Batch not found'
                ? common_1.HttpStatus.NOT_FOUND
                : result.error === 'Batch is still running'
                    ? common_1.HttpStatus.CONFLICT
                    : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            throw new common_1.HttpException({
                statusCode: status,
                error: result.error === 'Batch not found' ? 'Not Found' : result.error === 'Batch is still running' ? 'Conflict' : 'Internal Server Error',
                message: result.error,
            }, status);
        }
        return result;
    }
    /**
     * Reset rate limits for a tenant (testing utility)
     */
    resetRateLimit(body, req) {
        const user = req.user;
        const orgId = body.orgId || user?.orgId;
        if (body.endpoint && orgId) {
            this.rateLimiterService.reset(body.endpoint, orgId);
            return { reset: true, endpoint: body.endpoint, orgId };
        }
        // Reset all
        this.rateLimiterService.resetAll();
        return { reset: true, all: true };
    }
    /**
     * Get rate limit status for current tenant
     */
    getRateLimitStatus(req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        return {
            renderNow: this.rateLimiterService.getUsage('render:now', user.orgId),
            renderBulk: this.rateLimiterService.getUsage('render:bulk', user.orgId),
        };
    }
};
exports.RenderController = RenderController;
tslib_1.__decorate([
    (0, common_1.Post)('now'),
    (0, auth_guard_1.RequirePermissions)('render:trigger'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "renderNow", null);
tslib_1.__decorate([
    (0, common_1.Post)('bulk'),
    (0, common_1.HttpCode)(202),
    (0, auth_guard_1.RequirePermissions)('render:bulk'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "renderBulk", null);
tslib_1.__decorate([
    (0, common_1.Get)('batch/:batchId'),
    tslib_1.__param(0, (0, common_1.Param)('batchId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "getBatchStatus", null);
tslib_1.__decorate([
    (0, common_1.Get)('batch/:batchId/progress'),
    tslib_1.__param(0, (0, common_1.Param)('batchId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__param(2, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "getBatchProgress", null);
tslib_1.__decorate([
    (0, common_1.Get)('document/:documentId'),
    tslib_1.__param(0, (0, common_1.Param)('documentId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__param(2, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "downloadDocument", null);
tslib_1.__decorate([
    (0, common_1.Get)('document/:documentId/snapshot'),
    tslib_1.__param(0, (0, common_1.Param)('documentId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "getDocumentSnapshot", null);
tslib_1.__decorate([
    (0, common_1.Get)('download/:previewId'),
    tslib_1.__param(0, (0, common_1.Param)('previewId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__param(2, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "downloadPreview", null);
tslib_1.__decorate([
    (0, common_1.Get)('history'),
    tslib_1.__param(0, (0, common_1.Query)('limit')),
    tslib_1.__param(1, (0, common_1.Query)('cursor')),
    tslib_1.__param(2, (0, common_1.Query)('entityType')),
    tslib_1.__param(3, (0, common_1.Query)('status')),
    tslib_1.__param(4, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "listHistory", null);
tslib_1.__decorate([
    (0, common_1.Get)('documents'),
    tslib_1.__param(0, (0, common_1.Query)('entityType')),
    tslib_1.__param(1, (0, common_1.Query)('status')),
    tslib_1.__param(2, (0, common_1.Query)('limit')),
    tslib_1.__param(3, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "listAllDocuments", null);
tslib_1.__decorate([
    (0, common_1.Get)('documents/:templateId'),
    tslib_1.__param(0, (0, common_1.Param)('templateId')),
    tslib_1.__param(1, (0, common_1.Query)('status')),
    tslib_1.__param(2, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "listDocumentsByTemplate", null);
tslib_1.__decorate([
    (0, common_1.Post)('simulate-storage-failure'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "simulateStorageFailure", null);
tslib_1.__decorate([
    (0, common_1.Post)('retry-config'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "setRetryConfig", null);
tslib_1.__decorate([
    (0, common_1.Get)('retry-config'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "getRetryConfig", null);
tslib_1.__decorate([
    (0, common_1.Post)('force-expire-preview'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "forceExpirePreview", null);
tslib_1.__decorate([
    (0, common_1.Post)('purge-expired-previews'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "purgeExpiredPreviews", null);
tslib_1.__decorate([
    (0, common_1.Get)('purge-status'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "getPurgeStatus", null);
tslib_1.__decorate([
    (0, common_1.Get)('verify/:documentId'),
    tslib_1.__param(0, (0, common_1.Param)('documentId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "verifyDocument", null);
tslib_1.__decorate([
    (0, common_1.Post)('validate-pdfa'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "validatePdfA", null);
tslib_1.__decorate([
    (0, common_1.Post)('validate-pdfua'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "validatePdfUA", null);
tslib_1.__decorate([
    (0, common_1.Post)('force-pdfa-failure'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "forcePdfaFailure", null);
tslib_1.__decorate([
    (0, common_1.Post)('font-check'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "checkFonts", null);
tslib_1.__decorate([
    (0, common_1.Post)('format-currency'),
    (0, common_1.HttpCode)(200),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "formatCurrency", null);
tslib_1.__decorate([
    (0, common_1.Post)('queue'),
    (0, common_1.HttpCode)(202),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "renderQueue", null);
tslib_1.__decorate([
    (0, common_1.Post)('async'),
    (0, common_1.HttpCode)(202),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "renderAsync", null);
tslib_1.__decorate([
    (0, common_1.Get)('status/:jobId'),
    tslib_1.__param(0, (0, common_1.Param)('jobId')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "getRenderStatus", null);
tslib_1.__decorate([
    (0, common_1.Get)('font-cache/stats'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "getFontCacheStats", null);
tslib_1.__decorate([
    (0, common_1.Post)('font-cache/clear'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "clearFontCache", null);
tslib_1.__decorate([
    (0, common_1.Post)('batch/:batchId/merge'),
    tslib_1.__param(0, (0, common_1.Param)('batchId')),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderController.prototype, "mergeBatchPdfs", null);
tslib_1.__decorate([
    (0, common_1.Post)('rate-limit/reset'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "resetRateLimit", null);
tslib_1.__decorate([
    (0, common_1.Get)('rate-limit/status'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], RenderController.prototype, "getRateLimitStatus", null);
exports.RenderController = RenderController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/render'),
    tslib_1.__metadata("design:paramtypes", [render_service_1.RenderService,
        pdfa_processor_1.PdfaProcessor,
        render_queue_service_1.RenderQueueService,
        rate_limiter_service_1.RateLimiterService])
], RenderController);
//# sourceMappingURL=render.controller.js.map