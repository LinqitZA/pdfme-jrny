/**
 * AuditController - Query audit log entries
 *
 * GET /api/pdfme/audit - Returns paginated audit log entries
 * Supports filtering by entityType, entityId, action, and date range (from/to).
 * Results in reverse chronological order.
 */

import { Controller, Get, Req, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('api/pdfme')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

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
}
