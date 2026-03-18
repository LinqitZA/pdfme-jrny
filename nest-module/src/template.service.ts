/**
 * TemplateService - CRUD, versioning, locking, validation for templates
 *
 * Uses Drizzle ORM with PostgreSQL for all data operations.
 * Multi-tenant: queries are scoped by orgId from JWT claims.
 * System templates (orgId=null) are visible to all orgs.
 */

import { Injectable, Inject, Optional } from '@nestjs/common';
import { eq, and, or, ne, isNull, lt, SQL, asc, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { templates } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { AuditService } from './audit.service';

export interface CreateTemplateDto {
  orgId?: string | null;
  type: string;
  name: string;
  schema: Record<string, unknown>;
  createdBy: string;
  status?: string;
}

export interface UpdateTemplateDto {
  name?: string;
  schema?: Record<string, unknown>;
  status?: string;
  type?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface SaveDraftDto {
  schema?: Record<string, unknown>;
  name?: string;
}

@Injectable()
export class TemplateService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Create a new template. Defaults to status=draft, version=1.
   */
  async create(dto: CreateTemplateDto) {
    const id = createId();
    const now = new Date();
    const [result] = await this.db
      .insert(templates)
      .values({
        id,
        orgId: dto.orgId ?? null,
        type: dto.type,
        name: dto.name,
        schema: dto.schema,
        status: dto.status || 'draft',
        version: 1,
        createdBy: dto.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Audit log
    if (this.auditService && result) {
      await this.auditService.log({
        orgId: result.orgId || '',
        entityType: 'template',
        entityId: result.id,
        action: 'template.created',
        userId: dto.createdBy,
        metadata: { name: result.name, type: result.type },
      });
    }

    return result;
  }

  /**
   * List templates for an org with cursor-based pagination.
   * Includes:
   * - Templates owned by the org (orgId matches)
   * - System templates (orgId IS NULL)
   * Excludes archived templates.
   *
   * Cursor is based on createdAt descending + id for stable ordering.
   * The cursor format is: base64(JSON({createdAt, id}))
   */
  async findAll(orgId?: string, options?: { limit?: number; cursor?: string }) {
    const limit = options?.limit ?? 100;
    const conditions: SQL[] = [ne(templates.status, 'archived')];

    if (orgId) {
      conditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }

    // Decode cursor if provided
    if (options?.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(options.cursor, 'base64').toString());
        // Cursor-based: get items after the cursor position (createdAt DESC, id DESC)
        const cursorDate = new Date(decoded.createdAt);
        conditions.push(
          or(
            lt(templates.createdAt, cursorDate),
            and(eq(templates.createdAt, cursorDate), lt(templates.id, decoded.id)),
          )!,
        );
      } catch {
        // Invalid cursor — ignore and start from beginning
      }
    }

    // Fetch limit + 1 to check if there are more results
    const rows = await this.db
      .select()
      .from(templates)
      .where(and(...conditions))
      .orderBy(desc(templates.createdAt), desc(templates.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.createdAt, id: lastItem.id }),
      ).toString('base64');
    }

    // Count total (without cursor filter, just org + status filter)
    const countConditions: SQL[] = [ne(templates.status, 'archived')];
    if (orgId) {
      countConditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }
    const allRows = await this.db
      .select({ id: templates.id })
      .from(templates)
      .where(and(...countConditions));
    const total = allRows.length;

    return {
      data,
      pagination: {
        total,
        limit,
        hasMore,
        nextCursor,
      },
    };
  }

  /**
   * List system templates (orgId IS NULL). No pagination needed - small fixed set.
   */
  async findSystemTemplates() {
    return this.db
      .select()
      .from(templates)
      .where(and(isNull(templates.orgId), ne(templates.status, 'archived')))
      .orderBy(asc(templates.name));
  }

  /**
   * Find a template by ID. For a specific org, also allows access to system templates.
   */
  async findById(id: string, orgId?: string) {
    const conditions: SQL[] = [eq(templates.id, id)];

    if (orgId) {
      conditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }

    const [result] = await this.db
      .select()
      .from(templates)
      .where(and(...conditions));
    return result || null;
  }

  /**
   * Update a template's fields.
   */
  async update(id: string, dto: UpdateTemplateDto, orgId?: string) {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.schema !== undefined) updateData.schema = dto.schema;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.type !== undefined) updateData.type = dto.type;

    const conditions: SQL[] = [eq(templates.id, id)];
    if (orgId) {
      conditions.push(eq(templates.orgId, orgId));
    }

    const [result] = await this.db
      .update(templates)
      .set(updateData)
      .where(and(...conditions))
      .returning();
    return result || null;
  }

  /**
   * Save draft changes to a template. Updates schema and/or name,
   * keeps status as 'draft', and updates the updatedAt timestamp.
   */
  async saveDraft(id: string, dto: SaveDraftDto, orgId?: string) {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (dto.schema !== undefined) updateData.schema = dto.schema;
    if (dto.name !== undefined) updateData.name = dto.name;

    const conditions: SQL[] = [eq(templates.id, id)];
    if (orgId) {
      conditions.push(eq(templates.orgId, orgId));
    }

    const [result] = await this.db
      .update(templates)
      .set(updateData)
      .where(and(...conditions))
      .returning();
    return result || null;
  }

  /**
   * Publish a template: sets status to 'published' and publishedVer to current version.
   * Only draft templates can be published.
   */
  async publish(id: string, orgId?: string) {
    // First find the template to check its current status
    const template = await this.findById(id, orgId);
    if (!template) return null;

    if (template.status === 'published') {
      // Already published — return as-is (idempotent)
      return template;
    }

    if (template.status === 'archived') {
      return { error: 'Cannot publish an archived template' };
    }

    const [result] = await this.db
      .update(templates)
      .set({
        status: 'published',
        publishedVer: template.version,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    // Audit log
    if (this.auditService && result) {
      await this.auditService.log({
        orgId: result.orgId || '',
        entityType: 'template',
        entityId: result.id,
        action: 'template.published',
        userId: result.createdBy,
        metadata: { name: result.name, version: result.publishedVer },
      });
    }

    return result || null;
  }

  /**
   * Soft-delete a template by setting status to 'archived'.
   * Only org-owned templates can be archived (not system templates).
   */
  async softDelete(id: string, orgId?: string) {
    const conditions: SQL[] = [eq(templates.id, id)];
    if (orgId) {
      conditions.push(eq(templates.orgId, orgId));
    }

    const [result] = await this.db
      .update(templates)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    // Audit log
    if (this.auditService && result) {
      await this.auditService.log({
        orgId: result.orgId || '',
        entityType: 'template',
        entityId: result.id,
        action: 'template.archived',
        userId: result.createdBy,
        metadata: { name: result.name },
      });
    }

    return result || null;
  }
}
