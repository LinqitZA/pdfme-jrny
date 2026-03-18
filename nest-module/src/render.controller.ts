/**
 * RenderController - REST endpoints for PDF rendering
 *
 * Endpoints:
 * - POST   /api/pdfme/render/now                  (synchronous)
 * - POST   /api/pdfme/render/queue                (async)
 * - POST   /api/pdfme/render/bulk                 (batch)
 * - GET    /api/pdfme/render/status/:jobId        (poll status)
 * - GET    /api/pdfme/render/batch/:batchId       (batch status)
 * - GET    /api/pdfme/render/batch/:batchId/progress (SSE stream)
 * - POST   /api/pdfme/render/batch/:batchId/merge (merge PDFs)
 * - GET    /api/pdfme/render/download/:documentId (stream PDF)
 * - GET    /api/pdfme/render/verify/:documentId   (integrity check)
 * - GET    /api/pdfme/render/history              (document history)
 */

import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Controller('api/pdfme/render')
export class RenderController {
  @Post('now')
  async renderNow(
    @Body() body: any,
    @Req() req: any,
  ) {
    // Stub: will be fully implemented by coding agents
    // For now, validates auth is working and returns a placeholder response
    const user = req.user;
    if (!body.templateId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'templateId is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      status: 'not_implemented',
      message: 'Render endpoint is a stub. Full implementation pending.',
      orgId: user?.orgId,
    };
  }
}
