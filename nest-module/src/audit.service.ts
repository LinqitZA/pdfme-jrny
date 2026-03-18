/**
 * AuditService - Append-only audit trail
 *
 * Writes to AuditLog table on every state-changing action.
 * No UPDATE or DELETE operations on audit records.
 * Supports paginated query with filtering by entityType, entityId, action.
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc, lt, gte, lte, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import type { PdfmeDatabase } from './db/connection';
import { Pool } from 'pg';
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
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('PG_POOL') private readonly pool: Pool,
  ) {}

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
    if (params.from && !isNaN(params.from.getTime())) {
      conditions.push(gte(schema.auditLogs.createdAt, params.from));
    }
    if (params.to && !isNaN(params.to.getTime())) {
      conditions.push(lte(schema.auditLogs.createdAt, params.to));
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

  /**
   * Verify that append-only enforcement is active at the database level.
   * Checks for the existence of the UPDATE and DELETE prevention triggers.
   */
  async verifyAppendOnlyEnforcement(): Promise<{
    updateBlocked: boolean;
    deleteBlocked: boolean;
    triggers: string[];
  }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT trigger_name FROM information_schema.triggers
         WHERE event_object_table = 'audit_logs'
         AND trigger_schema = 'public'
         ORDER BY trigger_name`
      );
      const triggerNames = result.rows.map((r: any) => r.trigger_name);
      return {
        updateBlocked: triggerNames.includes('trg_audit_logs_no_update'),
        deleteBlocked: triggerNames.includes('trg_audit_logs_no_delete'),
        triggers: triggerNames,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Attempt a direct UPDATE on the audit_logs table.
   * This should always fail due to the database trigger.
   * Used for testing/verification only.
   */
  async attemptUpdate(id: string, newAction: string): Promise<{ success: boolean; error?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('UPDATE audit_logs SET action = $1 WHERE id = $2', [newAction, id]);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  }

  /**
   * Attempt a direct DELETE on the audit_logs table.
   * This should always fail due to the database trigger.
   * Used for testing/verification only.
   */
  async attemptDelete(id: string): Promise<{ success: boolean; error?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM audit_logs WHERE id = $1', [id]);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      client.release();
    }
  }
}
