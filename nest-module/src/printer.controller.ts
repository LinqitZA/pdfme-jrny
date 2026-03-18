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

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { PrinterService, CreatePrinterDto } from './printer.service';
import { PrintJobService, ReprintOptions } from './print-job.service';
import { RenderService } from './render.service';
import { AuditService } from './audit.service';
import { RequirePermissions } from './auth.guard';

function decodeJwt(authHeader?: string): { sub: string; orgId: string; roles: string[] } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.slice(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return {
      sub: payload.sub || 'unknown',
      orgId: payload.orgId || '',
      roles: payload.roles || [],
    };
  } catch {
    return null;
  }
}

@Controller('api/pdfme')
export class PrinterController {
  constructor(
    private readonly printerService: PrinterService,
    private readonly printJobService: PrintJobService,
    private readonly renderService: RenderService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Printers ────────────────────────────────────────────────────

  @Get('printers')
  @RequirePermissions('printer:read')
  async listPrinters(@Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.printerService.findAll(user.orgId);
    return { data };
  }

  @Post('printers')
  @HttpCode(201)
  @RequirePermissions('printer:write')
  async createPrinter(@Body() body: CreatePrinterDto, @Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    if (!body.name || !body.host) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'name and host are required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // SSRF validation
    if (!PrinterService.validateHost(body.host)) {
      throw new HttpException(
        { statusCode: 422, error: 'Unprocessable Entity', message: `Printer host '${body.host}' is not on a private network. Only private IPs are allowed for security.` },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const printer = await this.printerService.create(user.orgId, body);
      return printer;
    } catch (err: any) {
      if (err.message?.startsWith('SSRF_BLOCKED')) {
        throw new HttpException(
          { statusCode: 422, error: 'Unprocessable Entity', message: err.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Delete('printers/:id')
  @RequirePermissions('printer:write')
  async deletePrinter(@Param('id') id: string, @Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const deleted = await this.printerService.delete(user.orgId, id);
    if (!deleted) {
      throw new HttpException({ statusCode: 404, error: 'Not Found', message: 'Printer not found' }, HttpStatus.NOT_FOUND);
    }
    return { deleted: true, id };
  }

  // ─── Print (trigger job) ─────────────────────────────────────────

  @Post('print')
  @HttpCode(201)
  @RequirePermissions('render:trigger')
  async print(
    @Body() body: { templateId: string; inputs?: Record<string, string>[]; printerId: string },
    @Req() req: any,
  ) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    if (!body.templateId || !body.printerId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'templateId and printerId are required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify printer exists
    const printer = await this.printerService.findById(user.orgId, body.printerId);
    if (!printer) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: 'Printer not found' },
        HttpStatus.NOT_FOUND,
      );
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
      const renderResult = await this.renderService.renderNow(
        {
          templateId: body.templateId,
          entityId: `print-job-${job.id}`,
          entityType: 'label',
          channel: 'print',
          inputs,
          storeInputSnapshot: true,
        },
        user.orgId,
        user.sub,
      );

      if (renderResult.error || !renderResult.document) {
        await this.printJobService.updateStatus(job.id, 'failed', {
          errorMessage: `Render failed: ${renderResult.error || 'Unknown error'}`,
        });
      } else {
        // Read the generated PDF from file storage
        const pdfDownload = await this.renderService.getDocumentForDownload(
          renderResult.document.id,
          user.orgId,
        );

        if ('error' in pdfDownload) {
          await this.printJobService.updateStatus(job.id, 'failed', {
            errorMessage: `PDF read failed: ${pdfDownload.error}`,
          });
        } else {
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
          } catch (printErr: any) {
            await this.printJobService.updateStatus(job.id, 'failed', {
              errorMessage: printErr.message,
            });
            // Still return the job - user can reprint later
          }
        }
      }
    } catch (renderErr: any) {
      await this.printJobService.updateStatus(job.id, 'failed', {
        errorMessage: `Render failed: ${renderErr.message}`,
      });
    }

    // Return the job with latest status
    const updatedJob = await this.printJobService.findById(user.orgId, job.id);
    return { jobId: job.id, ...updatedJob };
  }

  // ─── Print Jobs ──────────────────────────────────────────────────

  @Get('print-jobs')
  @RequirePermissions('printer:read')
  async listPrintJobs(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('templateId') templateId?: string,
    @Query('printerId') printerId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10) || 20, 1), 100);
    const filters = { status, templateId, printerId, fromDate, toDate };

    return this.printJobService.findAll(user.orgId, filters, limit, cursor);
  }

  // ─── Retention Cleanup (must be before :id routes) ───────────────

  @Post('print-jobs/cleanup')
  @HttpCode(200)
  @RequirePermissions('admin')
  async triggerCleanup(@Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const deleted = await this.printJobService.cleanupExpired();
    return { deletedJobs: deleted, retentionDays: parseInt(process.env.PRINT_JOB_RETENTION_DAYS || '7', 10) };
  }

  @Get('print-jobs/:id')
  @RequirePermissions('printer:read')
  async getPrintJob(@Param('id') id: string, @Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const job = await this.printJobService.findById(user.orgId, id);
    if (!job) {
      throw new HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, HttpStatus.NOT_FOUND);
    }
    return job;
  }

  @Post('print-jobs/:id/reprint')
  @HttpCode(200)
  @RequirePermissions('render:trigger')
  async reprintJob(
    @Param('id') id: string,
    @Body() body: { fromPage?: number; toPage?: number },
    @Req() req: any,
  ) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const job = await this.printJobService.findById(user.orgId, id);
    if (!job) {
      throw new HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, HttpStatus.NOT_FOUND);
    }

    if (!job.renderedPdfPath) {
      throw new HttpException(
        { statusCode: 422, error: 'Unprocessable Entity', message: 'No rendered PDF available for reprint' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const options: ReprintOptions = {};
    if (body.fromPage) options.fromPage = body.fromPage;
    if (body.toPage) options.toPage = body.toPage;

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
    } catch (err: any) {
      if (err.message === 'PRINT_JOB_NOT_FOUND') {
        throw new HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, HttpStatus.NOT_FOUND);
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

  @Delete('print-jobs/:id')
  @RequirePermissions('printer:write')
  async deletePrintJob(@Param('id') id: string, @Req() req: any) {
    const user = decodeJwt(req.headers.authorization);
    if (!user) {
      throw new HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Missing or invalid token' }, HttpStatus.UNAUTHORIZED);
    }

    const deleted = await this.printJobService.delete(user.orgId, id);
    if (!deleted) {
      throw new HttpException({ statusCode: 404, error: 'Not Found', message: 'Print job not found' }, HttpStatus.NOT_FOUND);
    }
    return { deleted: true, id };
  }

}
