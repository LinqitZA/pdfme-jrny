/**
 * RenderQueueService - Bull/BullMQ queue for async PDF rendering
 *
 * Jobs are retried up to 3 times (3 total attempts).
 * Failed jobs after all retries are moved to the dead-letter queue (DLQ).
 * Uses exponential backoff between retries.
 */

import { Injectable, Inject, Optional, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';

export interface RenderJobData {
  templateId: string;
  entityId: string;
  entityType: string;
  orgId: string;
  channel: string;
  triggeredBy: string;
  inputs?: Record<string, unknown>;
}

export interface RenderJobResult {
  documentId?: string;
  filePath?: string;
  pdfHash?: string;
  status: 'done' | 'failed';
  error?: string;
  attempts: number;
}

/** Callback type for processing render jobs */
export type RenderJobProcessor = (
  data: RenderJobData,
  attemptNumber: number,
) => Promise<RenderJobResult>;

const QUEUE_NAME = 'pdfme-render';
const DLQ_NAME = 'pdfme-render-dlq';
const MAX_ATTEMPTS = 3;
const BACKOFF_DELAY = 1000; // 1 second base delay

@Injectable()
export class RenderQueueService implements OnModuleDestroy {
  private queue: Queue;
  private dlq: Queue;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents | null = null;
  private processor: RenderJobProcessor | null = null;

  /** Track job attempts and results for testing */
  private jobAttemptLog: Map<
    string,
    Array<{ attempt: number; success: boolean; error?: string; timestamp: string }>
  > = new Map();

  /** Per-tenant concurrency limits (orgId -> max concurrent jobs) */
  private tenantConcurrencyLimits: Map<string, number> = new Map();

  /** Per-tenant active job counts (orgId -> count of currently processing jobs) */
  private tenantActiveJobs: Map<string, number> = new Map();

  /** Per-tenant peak concurrent tracking for verification (orgId -> max seen simultaneously) */
  private tenantPeakConcurrent: Map<string, number> = new Map();

  /** Default concurrency per tenant when no specific limit set */
  private defaultTenantConcurrency: number = 10;

  constructor() {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

    const connection = { host: redisHost, port: redisPort };

    this.queue = new Queue(QUEUE_NAME, {
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

    this.dlq = new Queue(DLQ_NAME, { connection });
  }

  /**
   * Register a job processor function.
   * The processor receives the job data and attempt number.
   */
  registerProcessor(processor: RenderJobProcessor): void {
    this.processor = processor;

    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const connection = { host: redisHost, port: redisPort };

    // Create worker to process jobs with per-tenant concurrency enforcement
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<RenderJobData>) => {
        const attemptNumber = job.attemptsMade + 1;
        const jobId = job.id || 'unknown';
        const orgId = job.data.orgId;

        // Per-tenant concurrency enforcement
        const tenantLimit = this.tenantConcurrencyLimits.get(orgId) ?? this.defaultTenantConcurrency;
        const currentActive = this.tenantActiveJobs.get(orgId) || 0;

        if (currentActive >= tenantLimit) {
          // Re-queue with a short delay to let active jobs complete
          console.log(
            `[pdfme-erp] Tenant ${orgId} at concurrency limit (${currentActive}/${tenantLimit}). Re-queuing job ${jobId}.`,
          );
          // Move job back to delayed state by throwing a special error that triggers retry
          await this.queue.add('render', job.data, {
            delay: 500, // Re-check in 500ms
            attempts: job.opts.attempts,
            backoff: job.opts.backoff,
            jobId: `${jobId}-requeue-${Date.now()}`,
          });
          // Return a skip result - job was re-queued
          return { status: 'done' as const, attempts: attemptNumber, documentId: 'requeued' };
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
          console.log(
            `[pdfme-erp] Processing render job ${jobId} (attempt ${attemptNumber}/${MAX_ATTEMPTS}) [tenant ${orgId}: ${newActive}/${tenantLimit} active]`,
          );

          const result = await processor(job.data, attemptNumber);

          // Log successful attempt
          this.jobAttemptLog.get(jobId)!.push({
            attempt: attemptNumber,
            success: true,
            timestamp: new Date().toISOString(),
          });

          return result;
        } catch (error: any) {
          // Log failed attempt
          this.jobAttemptLog.get(jobId)!.push({
            attempt: attemptNumber,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
          });

          console.warn(
            `[pdfme-erp] Render job ${jobId} failed (attempt ${attemptNumber}/${MAX_ATTEMPTS}): ${error.message}`,
          );

          // If this was the last attempt, move to DLQ
          if (attemptNumber >= MAX_ATTEMPTS) {
            console.error(
              `[pdfme-erp] Render job ${jobId} exhausted all ${MAX_ATTEMPTS} attempts. Moving to DLQ.`,
            );
            await this.moveToDlq(job, error.message);
          }

          throw error; // Re-throw so BullMQ handles the retry
        } finally {
          // Decrement active count for this tenant
          const active = this.tenantActiveJobs.get(orgId) || 1;
          this.tenantActiveJobs.set(orgId, Math.max(0, active - 1));
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.RENDER_QUEUE_CONCURRENCY || '20', 10),
      },
    );

    // Listen for events
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection });

    this.worker.on('error', (err) => {
      console.error('[pdfme-erp] Queue worker error:', err.message);
    });
  }

  /**
   * Add a render job to the queue.
   * Returns the job ID for tracking.
   */
  async addJob(data: RenderJobData, options?: { priority?: number; delay?: number }): Promise<string> {
    const job = await this.queue.add('render', data, {
      priority: options?.priority,
      delay: options?.delay,
    });
    return job.id || '';
  }

  /**
   * Get job status and attempt history
   */
  async getJobStatus(jobId: string): Promise<{
    id: string;
    state: string;
    attemptsMade: number;
    maxAttempts: number;
    data: RenderJobData;
    result?: RenderJobResult;
    failedReason?: string;
    attemptLog: Array<{ attempt: number; success: boolean; error?: string; timestamp: string }>;
  } | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();

    return {
      id: job.id || jobId,
      state,
      attemptsMade: job.attemptsMade,
      maxAttempts: MAX_ATTEMPTS,
      data: job.data,
      result: job.returnvalue as RenderJobResult | undefined,
      failedReason: job.failedReason || undefined,
      attemptLog: this.jobAttemptLog.get(job.id || jobId) || [],
    };
  }

  /**
   * Get all jobs in the DLQ
   */
  async getDlqJobs(limit = 20): Promise<Array<{
    id: string;
    data: RenderJobData;
    error: string;
    failedAt: string;
    originalJobId: string;
    attempts: number;
  }>> {
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
  async getDlqCount(): Promise<number> {
    return this.dlq.count();
  }

  /**
   * Move a failed job to the dead-letter queue
   */
  private async moveToDlq(job: Job<RenderJobData>, errorMessage: string): Promise<void> {
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
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    dlq: number;
  }> {
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
  async waitForJob(jobId: string, timeoutMs = 30000): Promise<RenderJobResult | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const job = await this.queue.getJob(jobId);
      if (!job) return null;

      const state = await job.getState();

      if (state === 'completed') {
        return job.returnvalue as RenderJobResult;
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
  clearAttemptLog(): void {
    this.jobAttemptLog.clear();
  }

  /**
   * Get attempt log for a job (for testing)
   */
  getAttemptLog(jobId: string): Array<{ attempt: number; success: boolean; error?: string; timestamp: string }> {
    return this.jobAttemptLog.get(jobId) || [];
  }

  /**
   * Set per-tenant concurrency limit
   */
  setTenantConcurrency(orgId: string, limit: number): void {
    this.tenantConcurrencyLimits.set(orgId, limit);
    console.log(`[pdfme-erp] Set tenant ${orgId} concurrency limit to ${limit}`);
  }

  /**
   * Get per-tenant concurrency limit
   */
  getTenantConcurrency(orgId: string): number {
    return this.tenantConcurrencyLimits.get(orgId) ?? this.defaultTenantConcurrency;
  }

  /**
   * Get active job count for a tenant
   */
  getTenantActiveCount(orgId: string): number {
    return this.tenantActiveJobs.get(orgId) || 0;
  }

  /**
   * Get peak concurrent jobs seen for a tenant (for testing verification)
   */
  getTenantPeakConcurrent(orgId: string): number {
    return this.tenantPeakConcurrent.get(orgId) || 0;
  }

  /**
   * Get per-tenant concurrency status
   */
  getTenantConcurrencyStatus(orgId: string): {
    orgId: string;
    limit: number;
    active: number;
    peak: number;
  } {
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
  resetTenantConcurrency(): void {
    this.tenantConcurrencyLimits.clear();
    this.tenantActiveJobs.clear();
    this.tenantPeakConcurrent.clear();
  }

  /**
   * Drain all jobs from main queue and DLQ (for testing)
   */
  async drain(): Promise<void> {
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
}
