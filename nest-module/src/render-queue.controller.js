"use strict";
/**
 * RenderQueueController - Queue management and testing endpoints
 *
 * Provides endpoints to submit render jobs, check status, view DLQ,
 * and test retry behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderQueueController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("./auth.guard");
const render_queue_service_1 = require("./render-queue.service");
/** Tracks how many times a test job should fail before succeeding */
const failureSimulations = new Map();
/** Tracks processing delay for concurrency test jobs (simKey -> delayMs) */
const concurrencySimulations = new Map();
let RenderQueueController = class RenderQueueController {
    queueService;
    constructor(queueService) {
        this.queueService = queueService;
        // Register a test processor
        this.queueService.registerProcessor(async (data, attemptNumber) => {
            const simKey = `${data.templateId}:${data.entityId}`;
            // Check for concurrency simulation (adds processing delay)
            const concDelay = concurrencySimulations.get(simKey);
            if (concDelay && concDelay > 0) {
                await new Promise((resolve) => setTimeout(resolve, concDelay));
            }
            const sim = failureSimulations.get(simKey);
            if (sim && sim.currentFails < sim.failCount) {
                sim.currentFails++;
                throw new Error(`Simulated render failure (attempt ${attemptNumber}, fail ${sim.currentFails}/${sim.failCount})`);
            }
            // Success - simulate render result
            return {
                documentId: `doc-${data.entityId}-${Date.now()}`,
                filePath: `${data.orgId}/documents/test-${data.entityId}.pdf`,
                pdfHash: `sha256-${Date.now()}`,
                status: 'done',
                attempts: attemptNumber,
            };
        });
    }
    /**
     * Submit a render job to the queue
     */
    async submitJob(body) {
        const { delay, priority, ...jobData } = body;
        const jobId = await this.queueService.addJob(jobData, { delay, priority });
        return { jobId, queued: true, delay: delay || 0 };
    }
    /**
     * Submit a test job that fails a configurable number of times before succeeding
     *
     * Body: { failCount: number, templateId?, entityId?, orgId? }
     * - failCount=0: succeeds immediately
     * - failCount=1: fails once, succeeds on retry 2
     * - failCount=2: fails twice, succeeds on retry 3
     * - failCount=3: fails all 3 attempts, moved to DLQ
     */
    async testRetry(body) {
        const failCount = body?.failCount ?? 1;
        const entityId = body?.entityId || `test-${Date.now()}`;
        const templateId = body?.templateId || 'test-template';
        const orgId = body?.orgId || 'test-org';
        // Register failure simulation
        const simKey = `${templateId}:${entityId}`;
        failureSimulations.set(simKey, { failCount, currentFails: 0 });
        const jobData = {
            templateId,
            entityId,
            entityType: 'test',
            orgId,
            channel: 'print',
            triggeredBy: 'test-user',
        };
        const jobId = await this.queueService.addJob(jobData);
        return {
            jobId,
            queued: true,
            failCount,
            maxAttempts: 3,
            expectedOutcome: failCount < 3 ? 'success_after_retries' : 'moved_to_dlq',
        };
    }
    /**
     * Get job status including attempt history
     */
    async getJobStatus(jobId) {
        const status = await this.queueService.getJobStatus(jobId);
        if (!status) {
            throw new common_1.HttpException('Job not found', common_1.HttpStatus.NOT_FOUND);
        }
        return status;
    }
    /**
     * Wait for a job to complete and return final status (for testing)
     */
    async waitForJob(jobId, timeout) {
        const timeoutMs = parseInt(timeout || '30000', 10);
        const result = await this.queueService.waitForJob(jobId, timeoutMs);
        const status = await this.queueService.getJobStatus(jobId);
        return {
            result,
            jobStatus: status,
        };
    }
    /**
     * Get DLQ jobs
     */
    async getDlqJobs(limit) {
        const jobs = await this.queueService.getDlqJobs(parseInt(limit || '20', 10));
        const count = await this.queueService.getDlqCount();
        return { count, jobs };
    }
    /**
     * Get queue statistics
     */
    async getStats() {
        return this.queueService.getStats();
    }
    /**
     * Set per-tenant concurrency limit
     */
    async setTenantConcurrency(body) {
        if (!body?.orgId || typeof body?.limit !== 'number' || body.limit < 1) {
            throw new common_1.HttpException('orgId and limit (>=1) are required', common_1.HttpStatus.BAD_REQUEST);
        }
        this.queueService.setTenantConcurrency(body.orgId, body.limit);
        return {
            orgId: body.orgId,
            limit: body.limit,
            set: true,
        };
    }
    /**
     * Get per-tenant concurrency status
     */
    async getTenantConcurrency(orgId) {
        return this.queueService.getTenantConcurrencyStatus(orgId);
    }
    /**
     * Submit concurrency test jobs with configurable processing delay
     */
    async testConcurrency(body) {
        const orgId = body?.orgId || 'test-org';
        const count = body?.count || 10;
        const delayMs = body?.delayMs || 2000;
        const jobIds = [];
        for (let i = 0; i < count; i++) {
            const entityId = `conc-test-${Date.now()}-${i}`;
            const templateId = `conc-tmpl-${i}`;
            // Register a simulation that takes delayMs to complete
            const simKey = `${templateId}:${entityId}`;
            concurrencySimulations.set(simKey, delayMs);
            const jobData = {
                templateId,
                entityId,
                entityType: 'concurrency-test',
                orgId,
                channel: 'print',
                triggeredBy: 'concurrency-tester',
            };
            const jobId = await this.queueService.addJob(jobData);
            jobIds.push(jobId);
        }
        return {
            orgId,
            jobIds,
            count,
            delayMs,
            submitted: true,
        };
    }
    /**
     * Drain all queues (for testing cleanup)
     */
    async drain() {
        await this.queueService.drain();
        failureSimulations.clear();
        concurrencySimulations.clear();
        this.queueService.resetTenantConcurrency();
        return { drained: true };
    }
};
exports.RenderQueueController = RenderQueueController;
tslib_1.__decorate([
    (0, common_1.Post)('submit'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "submitJob", null);
tslib_1.__decorate([
    (0, common_1.Post)('test-retry'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "testRetry", null);
tslib_1.__decorate([
    (0, common_1.Get)('jobs/:jobId'),
    tslib_1.__param(0, (0, common_1.Param)('jobId')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "getJobStatus", null);
tslib_1.__decorate([
    (0, common_1.Get)('jobs/:jobId/wait'),
    tslib_1.__param(0, (0, common_1.Param)('jobId')),
    tslib_1.__param(1, (0, common_1.Query)('timeout')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "waitForJob", null);
tslib_1.__decorate([
    (0, common_1.Get)('dlq'),
    tslib_1.__param(0, (0, common_1.Query)('limit')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "getDlqJobs", null);
tslib_1.__decorate([
    (0, common_1.Get)('stats'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "getStats", null);
tslib_1.__decorate([
    (0, common_1.Post)('concurrency'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "setTenantConcurrency", null);
tslib_1.__decorate([
    (0, common_1.Get)('concurrency/:orgId'),
    tslib_1.__param(0, (0, common_1.Param)('orgId')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "getTenantConcurrency", null);
tslib_1.__decorate([
    (0, common_1.Post)('test-concurrency'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "testConcurrency", null);
tslib_1.__decorate([
    (0, common_1.Post)('drain'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], RenderQueueController.prototype, "drain", null);
exports.RenderQueueController = RenderQueueController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/queue'),
    (0, auth_guard_1.Public)(),
    tslib_1.__metadata("design:paramtypes", [render_queue_service_1.RenderQueueService])
], RenderQueueController);
//# sourceMappingURL=render-queue.controller.js.map