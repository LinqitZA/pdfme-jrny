/**
 * RenderQueueController - Queue management and testing endpoints
 *
 * Provides endpoints to submit render jobs, check status, view DLQ,
 * and test retry behavior.
 */

import { Controller, Post, Get, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from './auth.guard';
import { RenderQueueService, RenderJobData } from './render-queue.service';

/** Tracks how many times a test job should fail before succeeding */
const failureSimulations: Map<string, { failCount: number; currentFails: number }> = new Map();

/** Tracks processing delay for concurrency test jobs (simKey -> delayMs) */
const concurrencySimulations: Map<string, number> = new Map();

@Controller('api/pdfme/queue')
@Public()
export class RenderQueueController {
  constructor(private readonly queueService: RenderQueueService) {
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
        throw new Error(
          `Simulated render failure (attempt ${attemptNumber}, fail ${sim.currentFails}/${sim.failCount})`,
        );
      }

      // Success - simulate render result
      return {
        documentId: `doc-${data.entityId}-${Date.now()}`,
        filePath: `${data.orgId}/documents/test-${data.entityId}.pdf`,
        pdfHash: `sha256-${Date.now()}`,
        status: 'done' as const,
        attempts: attemptNumber,
      };
    });
  }

  /**
   * Submit a render job to the queue
   */
  @Post('submit')
  async submitJob(@Body() body: RenderJobData & { delay?: number; priority?: number }) {
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
  @Post('test-retry')
  async testRetry(
    @Body() body: { failCount?: number; templateId?: string; entityId?: string; orgId?: string },
  ) {
    const failCount = body?.failCount ?? 1;
    const entityId = body?.entityId || `test-${Date.now()}`;
    const templateId = body?.templateId || 'test-template';
    const orgId = body?.orgId || 'test-org';

    // Register failure simulation
    const simKey = `${templateId}:${entityId}`;
    failureSimulations.set(simKey, { failCount, currentFails: 0 });

    const jobData: RenderJobData = {
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
  @Get('jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    const status = await this.queueService.getJobStatus(jobId);
    if (!status) {
      throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    }
    return status;
  }

  /**
   * Wait for a job to complete and return final status (for testing)
   */
  @Get('jobs/:jobId/wait')
  async waitForJob(
    @Param('jobId') jobId: string,
    @Query('timeout') timeout?: string,
  ) {
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
  @Get('dlq')
  async getDlqJobs(@Query('limit') limit?: string) {
    const jobs = await this.queueService.getDlqJobs(parseInt(limit || '20', 10));
    const count = await this.queueService.getDlqCount();
    return { count, jobs };
  }

  /**
   * Get queue statistics
   */
  @Get('stats')
  async getStats() {
    return this.queueService.getStats();
  }

  /**
   * Set per-tenant concurrency limit
   */
  @Post('concurrency')
  async setTenantConcurrency(
    @Body() body: { orgId: string; limit: number },
  ) {
    if (!body?.orgId || typeof body?.limit !== 'number' || body.limit < 1) {
      throw new HttpException('orgId and limit (>=1) are required', HttpStatus.BAD_REQUEST);
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
  @Get('concurrency/:orgId')
  async getTenantConcurrency(@Param('orgId') orgId: string) {
    return this.queueService.getTenantConcurrencyStatus(orgId);
  }

  /**
   * Submit concurrency test jobs with configurable processing delay
   */
  @Post('test-concurrency')
  async testConcurrency(
    @Body() body: { orgId: string; count?: number; delayMs?: number },
  ) {
    const orgId = body?.orgId || 'test-org';
    const count = body?.count || 10;
    const delayMs = body?.delayMs || 2000;

    const jobIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const entityId = `conc-test-${Date.now()}-${i}`;
      const templateId = `conc-tmpl-${i}`;

      // Register a simulation that takes delayMs to complete
      const simKey = `${templateId}:${entityId}`;
      concurrencySimulations.set(simKey, delayMs);

      const jobData: RenderJobData = {
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
  @Post('drain')
  async drain() {
    await this.queueService.drain();
    failureSimulations.clear();
    concurrencySimulations.clear();
    this.queueService.resetTenantConcurrency();
    return { drained: true };
  }
}
