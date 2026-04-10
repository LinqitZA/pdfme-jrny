"use strict";
/**
 * RenderQueueService - Bull/BullMQ queue for async PDF rendering
 *
 * Jobs are retried up to 3 times (3 total attempts).
 * Failed jobs after all retries are moved to the dead-letter queue (DLQ).
 * Uses exponential backoff between retries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderQueueService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const bullmq_1 = require("bullmq");
const QUEUE_NAME = 'pdfme-render';
const DLQ_NAME = 'pdfme-render-dlq';
const MAX_ATTEMPTS = 3;
const BACKOFF_DELAY = 1000; // 1 second base delay
let RenderQueueService = class RenderQueueService {
    queue;
    dlq;
    worker = null;
    queueEvents = null;
    processor = null;
    /** Track job attempts and results for testing */
    jobAttemptLog = new Map();
    /** Per-tenant concurrency limits (orgId -> max concurrent jobs) */
    tenantConcurrencyLimits = new Map();
    /** Per-tenant active job counts (orgId -> count of currently processing jobs) */
    tenantActiveJobs = new Map();
    /** Per-tenant peak concurrent tracking for verification (orgId -> max seen simultaneously) */
    tenantPeakConcurrent = new Map();
    /** Default concurrency per tenant when no specific limit set */
    defaultTenantConcurrency = 10;
    constructor() {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const connection = { host: redisHost, port: redisPort };
        this.queue = new bullmq_1.Queue(QUEUE_NAME, {
            connection,
            defaultJobOptions: {
                attempts: MAX_ATTEMPTS,
                backoff: {
                    type: 'exponential',
                    delay: BACKOFF_DELAY,
                },
                removeOnComplete: { count: 1000 },
                removeOnFail: false, // Keep failed jobs for DLQ inspection
            },
        });
        this.dlq = new bullmq_1.Queue(DLQ_NAME, { connection });
    }
    /**
     * Register a job processor function.
     * The processor receives the job data and attempt number.
     */
    registerProcessor(processor) {
        this.processor = processor;
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const connection = { host: redisHost, port: redisPort };
        // Create worker to process jobs with per-tenant concurrency enforcement
        this.worker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
            const attemptNumber = job.attemptsMade + 1;
            const jobId = job.id || 'unknown';
            const orgId = job.data.orgId;
            // Per-tenant concurrency enforcement
            const tenantLimit = this.tenantConcurrencyLimits.get(orgId) ?? this.defaultTenantConcurrency;
            const currentActive = this.tenantActiveJobs.get(orgId) || 0;
            if (currentActive >= tenantLimit) {
                // Re-queue with a short delay to let active jobs complete
                console.log(`[pdfme-erp] Tenant ${orgId} at concurrency limit (${currentActive}/${tenantLimit}). Re-queuing job ${jobId}.`);
                // Move job back to delayed state by throwing a special error that triggers retry
                await this.queue.add('render', job.data, {
                    delay: 500, // Re-check in 500ms
                    attempts: job.opts.attempts,
                    backoff: job.opts.backoff,
                    jobId: `${jobId}-requeue-${Date.now()}`,
                });
                // Return a skip result - job was re-queued
                return { status: 'done', attempts: attemptNumber, documentId: 'requeued' };
            }
            // Increment active count for this tenant
            this.tenantActiveJobs.set(orgId, currentActive + 1);
            const newActive = currentActive + 1;
            // Track peak concurrency
            const currentPeak = this.tenantPeakConcurrent.get(orgId) || 0;
            if (newActive > currentPeak) {
                this.tenantPeakConcurrent.set(orgId, newActive);
            }
            // Initialize attempt log for this job
            if (!this.jobAttemptLog.has(jobId)) {
                this.jobAttemptLog.set(jobId, []);
            }
            try {
                console.log(`[pdfme-erp] Processing render job ${jobId} (attempt ${attemptNumber}/${MAX_ATTEMPTS}) [tenant ${orgId}: ${newActive}/${tenantLimit} active]`);
                const result = await processor(job.data, attemptNumber);
                // Log successful attempt
                this.jobAttemptLog.get(jobId).push({
                    attempt: attemptNumber,
                    success: true,
                    timestamp: new Date().toISOString(),
                });
                return result;
            }
            catch (error) {
                // Log failed attempt
                this.jobAttemptLog.get(jobId).push({
                    attempt: attemptNumber,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                });
                console.warn(`[pdfme-erp] Render job ${jobId} failed (attempt ${attemptNumber}/${MAX_ATTEMPTS}): ${error.message}`);
                // If this was the last attempt, move to DLQ
                if (attemptNumber >= MAX_ATTEMPTS) {
                    console.error(`[pdfme-erp] Render job ${jobId} exhausted all ${MAX_ATTEMPTS} attempts. Moving to DLQ.`);
                    await this.moveToDlq(job, error.message);
                }
                throw error; // Re-throw so BullMQ handles the retry
            }
            finally {
                // Decrement active count for this tenant
                const active = this.tenantActiveJobs.get(orgId) || 1;
                this.tenantActiveJobs.set(orgId, Math.max(0, active - 1));
            }
        }, {
            connection,
            concurrency: parseInt(process.env.RENDER_QUEUE_CONCURRENCY || '20', 10),
        });
        // Listen for events
        this.queueEvents = new bullmq_1.QueueEvents(QUEUE_NAME, { connection });
        this.worker.on('error', (err) => {
            console.error('[pdfme-erp] Queue worker error:', err.message);
        });
    }
    /**
     * Add a render job to the queue.
     * Returns the job ID for tracking.
     */
    async addJob(data, options) {
        const job = await this.queue.add('render', data, {
            priority: options?.priority,
            delay: options?.delay,
        });
        return job.id || '';
    }
    /**
     * Get job status and attempt history
     */
    async getJobStatus(jobId) {
        const job = await this.queue.getJob(jobId);
        if (!job)
            return null;
        const state = await job.getState();
        return {
            id: job.id || jobId,
            state,
            attemptsMade: job.attemptsMade,
            maxAttempts: MAX_ATTEMPTS,
            data: job.data,
            result: job.returnvalue,
            failedReason: job.failedReason || undefined,
            attemptLog: this.jobAttemptLog.get(job.id || jobId) || [],
        };
    }
    /**
     * Get all jobs in the DLQ
     */
    async getDlqJobs(limit = 20) {
        const jobs = await this.dlq.getJobs(['waiting', 'delayed', 'completed'], 0, limit);
        return jobs.map((job) => ({
            id: job.id || '',
            data: job.data.originalData,
            error: job.data.error,
            failedAt: job.data.failedAt,
            originalJobId: job.data.originalJobId,
            attempts: job.data.attempts,
        }));
    }
    /**
     * Get DLQ count
     */
    async getDlqCount() {
        return this.dlq.count();
    }
    /**
     * Move a failed job to the dead-letter queue
     */
    async moveToDlq(job, errorMessage) {
        await this.dlq.add('failed-render', {
            originalJobId: job.id,
            originalData: job.data,
            error: errorMessage,
            attempts: job.attemptsMade + 1,
            failedAt: new Date().toISOString(),
        });
    }
    /**
     * Get queue statistics
     */
    async getStats() {
        const [waiting, active, completed, failed, delayed, dlq] = await Promise.all([
            this.queue.getWaitingCount(),
            this.queue.getActiveCount(),
            this.queue.getCompletedCount(),
            this.queue.getFailedCount(),
            this.queue.getDelayedCount(),
            this.dlq.count(),
        ]);
        return { waiting, active, completed, failed, delayed, dlq };
    }
    /**
     * Wait for a specific job to complete (for testing)
     */
    async waitForJob(jobId, timeoutMs = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const job = await this.queue.getJob(jobId);
            if (!job)
                return null;
            const state = await job.getState();
            if (state === 'completed') {
                return job.returnvalue;
            }
            if (state === 'failed') {
                return {
                    status: 'failed',
                    error: job.failedReason || 'Unknown error',
                    attempts: job.attemptsMade,
                };
            }
            // Wait a bit before checking again
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return null; // Timeout
    }
    /**
     * Clear the attempt log (for testing)
     */
    clearAttemptLog() {
        this.jobAttemptLog.clear();
    }
    /**
     * Get attempt log for a job (for testing)
     */
    getAttemptLog(jobId) {
        return this.jobAttemptLog.get(jobId) || [];
    }
    /**
     * Set per-tenant concurrency limit
     */
    setTenantConcurrency(orgId, limit) {
        this.tenantConcurrencyLimits.set(orgId, limit);
        console.log(`[pdfme-erp] Set tenant ${orgId} concurrency limit to ${limit}`);
    }
    /**
     * Get per-tenant concurrency limit
     */
    getTenantConcurrency(orgId) {
        return this.tenantConcurrencyLimits.get(orgId) ?? this.defaultTenantConcurrency;
    }
    /**
     * Get active job count for a tenant
     */
    getTenantActiveCount(orgId) {
        return this.tenantActiveJobs.get(orgId) || 0;
    }
    /**
     * Get peak concurrent jobs seen for a tenant (for testing verification)
     */
    getTenantPeakConcurrent(orgId) {
        return this.tenantPeakConcurrent.get(orgId) || 0;
    }
    /**
     * Get per-tenant concurrency status
     */
    getTenantConcurrencyStatus(orgId) {
        return {
            orgId,
            limit: this.getTenantConcurrency(orgId),
            active: this.getTenantActiveCount(orgId),
            peak: this.getTenantPeakConcurrent(orgId),
        };
    }
    /**
     * Reset per-tenant concurrency tracking (for testing)
     */
    resetTenantConcurrency() {
        this.tenantConcurrencyLimits.clear();
        this.tenantActiveJobs.clear();
        this.tenantPeakConcurrent.clear();
    }
    /**
     * Drain all jobs from main queue and DLQ (for testing)
     */
    async drain() {
        await this.queue.drain();
        await this.dlq.drain();
        this.jobAttemptLog.clear();
        this.tenantActiveJobs.clear();
        this.tenantPeakConcurrent.clear();
    }
    async onModuleDestroy() {
        if (this.worker) {
            await this.worker.close();
        }
        if (this.queueEvents) {
            await this.queueEvents.close();
        }
        await this.queue.close();
        await this.dlq.close();
    }
};
exports.RenderQueueService = RenderQueueService;
exports.RenderQueueService = RenderQueueService = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__metadata("design:paramtypes", [])
], RenderQueueService);
//# sourceMappingURL=render-queue.service.js.map