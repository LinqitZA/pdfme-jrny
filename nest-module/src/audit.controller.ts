/**
 * AuditController - Query audit log entries
 *
 * GET /api/pdfme/audit - Returns paginated audit log entries
 * Supports filtering by entityType, entityId, action, and date range (from/to).
 * Results in reverse chronological order.
 *
 * APPEND-ONLY: PUT and DELETE endpoints always return 403.
 */

import { Controller, Get, Put, Delete, Req, Query, Param, HttpException, HttpStatus } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('api/pdfme')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /api/pdfme/audit/policy - Returns the append-only policy status
   * Must be defined BEFORE audit/:id to avoid route conflict.
   */
  @Get('audit/policy')
  async getAuditPolicy() {
    const enforcement = await this.auditService.verifyAppendOnlyEnforcement();
    return {
      policy: 'append-only',
      description: 'AuditLog table rejects UPDATE and DELETE operations',
      enforcement,
    };
  }

  @Get('audit')
  async getAuditLogs(
    @Req() req: any,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const orgId = req.user.orgId;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;

    return this.auditService.query({
      orgId,
      entityType,
      entityId,
      action,
      limit: isNaN(limit) ? 20 : limit,
      cursor,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  /**
   * Attempt to update an audit log entry - ALWAYS fails (append-only enforcement)
   */
  @Put('audit/:id')
  async updateAuditLog(@Param('id') id: string) {
    throw new HttpException(
      { error: 'Forbidden', message: 'Audit log is append-only: UPDATE operations are not allowed' },
      HttpStatus.FORBIDDEN,
    );
  }

  /**
   * Attempt to delete an audit log entry - ALWAYS fails (append-only enforcement)
   */
  @Delete('audit/:id')
  async deleteAuditLog(@Param('id') id: string) {
    throw new HttpException(
      { error: 'Forbidden', message: 'Audit log is append-only: DELETE operations are not allowed' },
      HttpStatus.FORBIDDEN,
    );
  }
}
