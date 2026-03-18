/**
 * RenderController - REST endpoints for PDF rendering
 *
 * Endpoints:
 * - POST   /api/pdfme/render/now                    (synchronous render)
 * - POST   /api/pdfme/render/bulk                   (batch render - returns batchId)
 * - GET    /api/pdfme/render/batch/:batchId         (batch status)
 * - GET    /api/pdfme/render/batch/:batchId/progress (SSE progress stream)
 * - POST   /api/pdfme/render/batch/:batchId/merge   (merge batch PDFs)
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { RenderService, RenderNowDto, RenderBulkDto } from './render.service';
import { PdfaProcessor } from './pdfa-processor';
import { RenderQueueService } from './render-queue.service';

@Controller('api/pdfme/render')
export class RenderController {
  constructor(
    private readonly renderService: RenderService,
    private readonly pdfaProcessor: PdfaProcessor,
    private readonly renderQueueService: RenderQueueService,
  ) {}

  @Post('now')
  async renderNow(
    @Body() body: RenderNowDto,
    @Req() req: any,
  ) {
    // Validate required fields with detailed error envelope
    const missingFields: string[] = [];
    if (!body.templateId) missingFields.push('templateId');
    if (!body.entityId) missingFields.push('entityId');
    if (!body.channel) missingFields.push('channel');
    if (missingFields.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId, entityId, and channel are required',
          details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    // Validate templateId format (must be non-empty string)
    if (typeof body.templateId !== 'string' || body.templateId.trim() === '') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId must be a non-empty string',
          details: [{ field: 'templateId', reason: 'must be a non-empty string identifier' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.renderNow(
      body,
      user.orgId,
      user.sub,
    );

    if ('error' in result && !('document' in result)) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: result.error,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if ('error' in result && 'document' in result) {
      throw new HttpException(
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: result.error,
          document: result.document,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return result;
  }

  @Post('bulk')
  @HttpCode(202)
  async renderBulk(
    @Body() body: RenderBulkDto,
    @Req() req: any,
  ) {
    // Validate required fields with detailed error envelope
    {
      const missingFields: string[] = [];
      if (!body.templateId) missingFields.push('templateId');
      if (!body.entityIds || !Array.isArray(body.entityIds) || body.entityIds.length === 0) missingFields.push('entityIds');
      if (!body.channel) missingFields.push('channel');
      if (missingFields.length > 0) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'Bad Request',
            message: 'templateId, entityIds (non-empty array), and channel are required',
            details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Validate entityIds entries are non-null, non-empty strings
    const invalidIndices: number[] = [];
    for (let i = 0; i < body.entityIds.length; i++) {
      const id = body.entityIds[i];
      if (id === null || id === undefined || typeof id !== 'string' || id.trim() === '') {
        invalidIndices.push(i);
      }
    }
    if (invalidIndices.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'entityIds must contain only non-empty strings',
          details: [{ field: 'entityIds', reason: `Invalid entries at indices: ${invalidIndices.join(', ')}. Each entityId must be a non-empty string.` }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (body.entityIds.length > 2000) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Maximum 2000 entityIds per request',
          details: [{ field: 'entityIds', reason: `array length ${body.entityIds.length} exceeds maximum of 2000` }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.renderBulk(
      body,
      user.orgId,
      user.sub,
    );

    // If there's an existing running batch, return 409 Conflict
    if (result.conflict) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'Conflict',
          message: result.error,
          existingBatchId: result.existingBatchId,
          status: result.status,
          totalJobs: result.totalJobs,
          completedJobs: result.completedJobs,
        },
        HttpStatus.CONFLICT,
      );
    }

    return result;
  }

  @Get('batch/:batchId')
  async getBatchStatus(
    @Param('batchId') batchId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const batch = await this.renderService.getBatchStatus(batchId, user.orgId);

    if (!batch) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: 'Batch not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return batch;
  }

  @Get('batch/:batchId/progress')
  async getBatchProgress(
    @Param('batchId') batchId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify batch exists
    const batch = await this.renderService.getBatchStatus(batchId, user.orgId);
    if (!batch) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: 'Batch not found',
        },
        HttpStatus.NOT_FOUND,
      );
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
    const listener = (event: any) => {
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

  @Get('document/:documentId')
  async downloadDocument(
    @Param('documentId') documentId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.getDocumentForDownload(documentId, user.orgId);

    if ('error' in result) {
      throw new HttpException(
        {
          statusCode: result.statusCode,
          error: result.statusCode === 404 ? 'Not Found' : 'Internal Server Error',
          message: result.error,
        },
        result.statusCode,
      );
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${documentId}.pdf"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('ETag', `"${result.pdfHash}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.buffer);
  }

  @Get('download/:previewId')
  async downloadPreview(
    @Param('previewId') previewId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.getPreviewForDownload(previewId, user.orgId);

    if ('error' in result) {
      throw new HttpException(
        {
          statusCode: result.statusCode,
          error: result.statusCode === 410 ? 'Gone' : 'Not Found',
          message: result.error,
        },
        result.statusCode,
      );
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${previewId}.pdf"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.send(result.buffer);
  }

  @Post('simulate-storage-failure')
  async simulateStorageFailure(
    @Body() body: { failureCount: number },
  ) {
    const fileStorage = (this.renderService as any).fileStorage;
    if (typeof fileStorage.setSimulatedFailures === 'function') {
      fileStorage.setSimulatedFailures(body.failureCount || 0);
      return {
        simulatedFailures: body.failureCount || 0,
        message: `Next ${body.failureCount || 0} storage operations will fail`,
      };
    }
    return { error: 'File storage adapter does not support failure simulation' };
  }

  @Post('retry-config')
  async setRetryConfig(
    @Body() body: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number },
  ) {
    this.renderService.setRetryConfig(body);
    return {
      config: this.renderService.getRetryConfig(),
    };
  }

  @Get('retry-config')
  async getRetryConfig() {
    return {
      config: this.renderService.getRetryConfig(),
      lastRetryAttempts: this.renderService.lastRetryAttempts,
    };
  }

  @Post('force-expire-preview')
  async forceExpirePreview(
    @Body() body: { previewId: string },
  ) {
    if (!body.previewId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'previewId is required' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const success = this.renderService.forceExpirePreview(body.previewId);
    return { expired: success, previewId: body.previewId };
  }

  @Get('verify/:documentId')
  async verifyDocument(
    @Param('documentId') documentId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.verifyDocument(documentId, user.orgId);

    if ('error' in result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: result.error },
        HttpStatus.NOT_FOUND,
      );
    }

    return result;
  }

  @Post('validate-pdfa')
  async validatePdfA(
    @Body() body: { documentPath: string },
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.documentPath) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'documentPath is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const fileStorage = (this.renderService as any).fileStorage;
      const pdfBuffer = await fileStorage.read(body.documentPath);
      const result = await this.pdfaProcessor.validate(pdfBuffer);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        { statusCode: 500, error: 'Internal Server Error', message: `Validation failed: ${msg}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('force-pdfa-failure')
  async forcePdfaFailure(
    @Body() body: { errorMessage?: string | null },
  ) {
    const msg = body.errorMessage !== undefined ? body.errorMessage : null;
    this.pdfaProcessor.setForceFailure(msg);
    return {
      forceFailure: msg !== null,
      errorMessage: msg,
    };
  }

  @Post('font-check')
  async checkFonts(
    @Body() body: { templateId: string },
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.templateId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'templateId is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Use the render service's resolveFonts to check font availability
    const result = await this.renderService.checkTemplateFonts(body.templateId, user.orgId);

    if ('error' in result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: result.error },
        HttpStatus.NOT_FOUND,
      );
    }

    return result;
  }

  /**
   * Format a currency value for testing/preview.
   * POST /api/pdfme/render/format-currency
   */
  @Post('format-currency')
  @HttpCode(200)
  formatCurrency(
    @Body() body: {
      value: number;
      currencyCode?: string;
      currencySymbol?: string;
      symbolPosition?: 'before' | 'after';
      thousandSeparator?: string;
      decimalSeparator?: string;
      decimalPlaces?: number;
      showCurrencyCode?: boolean;
      dualCurrency?: {
        enabled: boolean;
        targetCurrencyCode: string;
        targetCurrencySymbol?: string;
        exchangeRate: number;
        format?: 'below' | 'inline';
        symbolPosition?: 'before' | 'after';
        decimalPlaces?: number;
      };
    },
  ) {
    const { formatCurrencyField, resolveCurrencySymbol } = require('../../packages/erp-schemas/src/currency-field');

    if (body.value === undefined || body.value === null) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'value is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const schema = {
      type: 'currencyField' as const,
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

    const context: Record<string, unknown> = {};
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
   */
  @Post('async')
  @HttpCode(202)
  async renderAsync(
    @Body() body: RenderNowDto,
    @Req() req: any,
  ) {
    // Validate required fields
    const missingFields: string[] = [];
    if (!body.templateId) missingFields.push('templateId');
    if (!body.entityId) missingFields.push('entityId');
    if (!body.channel) missingFields.push('channel');
    if (missingFields.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId, entityId, and channel are required',
          details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const jobId = await this.renderQueueService.addJob({
      templateId: body.templateId,
      entityId: body.entityId,
      entityType: body.entityType || 'document',
      orgId: user.orgId,
      channel: body.channel,
      triggeredBy: user.sub || 'anonymous',
      inputs: body.inputs as Record<string, unknown>,
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
  @Get('status/:jobId')
  async getRenderStatus(
    @Param('jobId') jobId: string,
  ) {
    const jobStatus = await this.renderQueueService.getJobStatus(jobId);

    if (!jobStatus) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Render job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    // Map BullMQ states to user-friendly status
    let status: 'queued' | 'generating' | 'done' | 'failed';
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

  @Post('batch/:batchId/merge')
  async mergeBatchPdfs(
    @Param('batchId') batchId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.renderService.mergeBatchPdfs(batchId, user.orgId);

    if ('error' in result) {
      const status = result.error === 'Batch not found'
        ? HttpStatus.NOT_FOUND
        : result.error === 'Batch is still running'
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_SERVER_ERROR;

      throw new HttpException(
        {
          statusCode: status,
          error: result.error === 'Batch not found' ? 'Not Found' : result.error === 'Batch is still running' ? 'Conflict' : 'Internal Server Error',
          message: result.error,
        },
        status,
      );
    }

    return result;
  }
}
