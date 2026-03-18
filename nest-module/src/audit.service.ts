/**
 * AuditService - Append-only audit trail
 *
 * Writes to AuditLog table on every state-changing action.
 * No UPDATE or DELETE operations on audit records.
 * Supports paginated query with filtering by entityType, entityId, action.
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc, lt } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import type { PdfmeDatabase } from './db/connection';
import * as schema from './db/schema';

export interface CreateAuditLogDto {
  orgId: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryParams {
  orgId: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase) {}

  /**
   * Append a new audit log entry. Never updates or deletes.
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    const id = createId();
    await this.db.insert(schema.auditLogs).values({
      id,
      orgId: dto.orgId,
      entityType: dto.entityType,
      entityId: dto.entityId,
      action: dto.action,
      userId: dto.userId,
      metadata: dto.metadata || null,
    });
  }

  /**
   * Query audit logs with pagination and optional filters.
   * Results are returned in reverse chronological order.
   */
  async query(params: AuditQueryParams) {
    const limit = Math.min(params.limit || 20, 100);

    // Build filter conditions
    const conditions: any[] = [eq(schema.auditLogs.orgId, params.orgId)];

    if (params.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, params.entityType));
    }
    if (params.entityId) {
      conditions.push(eq(schema.auditLogs.entityId, params.entityId));
    }
    if (params.action) {
      conditions.push(eq(schema.auditLogs.action, params.action));
    }

    // Cursor-based pagination: cursor is the ID of the last item from previous page
    // Since we order by createdAt DESC, we need entries created before the cursor's createdAt
    if (params.cursor) {
      // Get the cursor record's createdAt
      const cursorRecord = await this.db
        .select({ createdAt: schema.auditLogs.createdAt })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.id, params.cursor))
        .limit(1);

      if (cursorRecord.length > 0) {
        conditions.push(lt(schema.auditLogs.createdAt, cursorRecord[0].createdAt));
      }
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    // Fetch limit + 1 to determine hasMore
    const rows = await this.db
      .select()
      .from(schema.auditLogs)
      .where(whereClause)
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : undefined;

    // Get total count for this filter
    const countResult = await this.db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions.filter((_, i) => i < conditions.length - (params.cursor ? 1 : 0))));

    return {
      data,
      pagination: {
        total: countResult.length,
        limit,
        cursor: nextCursor,
        hasMore,
      },
    };
  }
}
