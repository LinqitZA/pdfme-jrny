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

@Controller('api/pdfme/render')
export class RenderController {
  constructor(
    private readonly renderService: RenderService,
    private readonly pdfaProcessor: PdfaProcessor,
  ) {}

  @Post('now')
  async renderNow(
    @Body() body: RenderNowDto,
    @Req() req: any,
  ) {
    if (!body.templateId || !body.entityId || !body.channel) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId, entityId, and channel are required',
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
    if (!body.templateId || !body.entityIds || !Array.isArray(body.entityIds) || body.entityIds.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId and entityIds (non-empty array) are required',
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
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.channel) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'channel is required',
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
