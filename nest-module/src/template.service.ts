/**
 * TemplateService - CRUD, versioning, locking, validation for templates
 *
 * Uses Drizzle ORM with PostgreSQL for all data operations.
 * Multi-tenant: queries are scoped by orgId from JWT claims.
 * System templates (orgId=null) are visible to all orgs.
 */

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, or, ne, isNull, SQL } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { templates } from './db/schema';
import type { PdfmeDatabase } from './db/connection';

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

export interface SaveDraftDto {
  schema?: Record<string, unknown>;
  name?: string;
}

@Injectable()
export class TemplateService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase) {}

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
    return result;
  }

  /**
   * List templates for an org. Includes:
   * - Templates owned by the org (orgId matches)
   * - System templates (orgId IS NULL)
   * Excludes archived templates.
   */
  async findAll(orgId?: string) {
    const conditions: SQL[] = [ne(templates.status, 'archived')];

    if (orgId) {
      conditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }

    return this.db
      .select()
      .from(templates)
      .where(and(...conditions));
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
    return result || null;
  }
}
