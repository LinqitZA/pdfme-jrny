/**
 * TemplateService - CRUD, versioning, locking, validation for templates
 *
 * Uses Drizzle ORM with PostgreSQL for all data operations.
 * Multi-tenant: queries are scoped by orgId from JWT claims.
 * System templates (orgId=null) are visible to all orgs.
 */

import { Injectable, Inject, Optional, BadRequestException } from '@nestjs/common';
import { eq, and, or, ne, isNull, lt, SQL, asc, desc, inArray, ilike } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { templates, templateVersions } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { AuditService } from './audit.service';
import { FileStorageService } from './file-storage.service';

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

export interface TemplateExportPackage {
  version: 1;
  exportedAt: string;
  template: {
    type: string;
    name: string;
    schema: Record<string, unknown>;
    status: string;
    version: number;
  };
  assets: {
    images: Array<{ path: string; mimeType: string; data: string }>; // base64
    fonts: Array<{ path: string; mimeType: string; data: string }>;  // base64
  };
}

export interface LockResult {
  locked: boolean;
  lockedBy: string;
  lockedAt: Date;
  expiresAt: Date;
}

const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class TemplateService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Optional() private readonly auditService?: AuditService,
    @Optional() @Inject('FILE_STORAGE') private readonly storage?: FileStorageService,
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
  async findAll(orgId?: string, options?: { limit?: number; cursor?: string; type?: string; status?: string; sort?: 'createdAt' | 'name' | 'updatedAt' | 'type'; order?: 'asc' | 'desc'; search?: string }) {
    const limit = options?.limit ?? 100;
    // When an explicit status filter is provided, use it; otherwise exclude archived
    const conditions: SQL[] = options?.status
      ? [eq(templates.status, options.status)]
      : [ne(templates.status, 'archived')];

    if (orgId) {
      conditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }

    if (options?.type) {
      conditions.push(eq(templates.type, options.type));
    }

    // Search by name (case-insensitive partial match)
    if (options?.search && options.search.trim()) {
      // Strip null bytes which cause PostgreSQL errors
      const sanitized = options.search.trim().replace(/\0/g, '');
      if (sanitized) {
        conditions.push(ilike(templates.name, `%${sanitized}%`));
      }
    }

    // Determine sort column and direction
    const sortColumnMap = {
      createdAt: templates.createdAt,
      name: templates.name,
      updatedAt: templates.updatedAt,
      type: templates.type,
    };
    const sortCol = sortColumnMap[options?.sort || 'createdAt'] || templates.createdAt;
    const sortDir = options?.order === 'asc' ? asc : desc;

    // Decode cursor if provided
    if (options?.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(options.cursor, 'base64').toString());
        if (!decoded.createdAt || !decoded.id) {
          throw new Error('Cursor missing required fields');
        }
        const cursorDate = new Date(decoded.createdAt);
        if (isNaN(cursorDate.getTime())) {
          throw new Error('Cursor contains invalid date');
        }
        // Cursor-based: get items after the cursor position (createdAt DESC, id DESC)
        conditions.push(
          or(
            lt(templates.createdAt, cursorDate),
            and(eq(templates.createdAt, cursorDate), lt(templates.id, decoded.id)),
          )!,
        );
      } catch {
        throw new BadRequestException('Invalid cursor parameter. The cursor value is malformed or expired.');
      }
    }

    // Fetch limit + 1 to check if there are more results
    const rows = await this.db
      .select()
      .from(templates)
      .where(and(...conditions))
      .orderBy(sortDir(sortCol), desc(templates.id))
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

    // Count total (without cursor filter, just org + status + type filter)
    const countConditions: SQL[] = options?.status
      ? [eq(templates.status, options.status)]
      : [ne(templates.status, 'archived')];
    if (orgId) {
      countConditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }
    if (options?.type) {
      countConditions.push(eq(templates.type, options.type));
    }
    if (options?.search && options.search.trim()) {
      countConditions.push(ilike(templates.name, `%${options.search.trim()}%`));
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
   * Get distinct template types for the given org (plus system templates).
   * Used to populate filter dropdowns from real database data.
   */
  async getDistinctTypes(orgId?: string): Promise<string[]> {
    const conditions: SQL[] = [ne(templates.status, 'archived')];
    if (orgId) {
      conditions.push(or(eq(templates.orgId, orgId), isNull(templates.orgId))!);
    }

    const rows = await this.db
      .select({ type: templates.type })
      .from(templates)
      .where(and(...conditions));

    const types = [...new Set(rows.map(r => r.type).filter(Boolean))].sort();
    return types;
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
      status: 'draft',
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
  /**
   * Validate a template schema for publishing readiness.
   * Checks for: invalid bindings, empty schemas, missing required fields, etc.
   * Returns array of validation errors (empty = valid).
   */
  validateTemplateForPublish(template: { name: string; type: string; schema: Record<string, unknown> }): Array<{ field: string; message: string }> {
    const errors: Array<{ field: string; message: string }> = [];

    // Check template name
    if (!template.name || typeof template.name !== 'string' || template.name.trim().length === 0) {
      errors.push({ field: 'name', message: 'Template name is required' });
    }

    // Check template type
    if (!template.type || typeof template.type !== 'string' || template.type.trim().length === 0) {
      errors.push({ field: 'type', message: 'Template type is required' });
    }

    // Check schema exists
    if (!template.schema || typeof template.schema !== 'object') {
      errors.push({ field: 'schema', message: 'Template schema is required' });
      return errors;
    }

    const schema = template.schema;

    // Check pages/schemas array exists and has content
    const pages = (schema.pages || schema.schemas) as unknown[] | undefined;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      errors.push({ field: 'schema.pages', message: 'Template must have at least one page' });
      return errors;
    }

    // Validate bindings in elements
    const bindingPattern = /\{\{([^}]*)\}\}/g;
    const validBindingPattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

    const walkElements = (obj: unknown, path: string) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => walkElements(item, `${path}[${idx}]`));
        return;
      }
      const record = obj as Record<string, unknown>;

      // Check string values for invalid bindings
      for (const [key, val] of Object.entries(record)) {
        if (typeof val === 'string') {
          let match;
          bindingPattern.lastIndex = 0;
          while ((match = bindingPattern.exec(val)) !== null) {
            const binding = match[1].trim();
            if (!binding) {
              errors.push({
                field: `${path}.${key}`,
                message: `Empty binding expression: {{}}`,
              });
            } else if (!validBindingPattern.test(binding)) {
              errors.push({
                field: `${path}.${key}`,
                message: `Invalid binding expression: {{${binding}}}`,
              });
            }
          }
        } else if (typeof val === 'object') {
          walkElements(val, `${path}.${key}`);
        }
      }
    };

    pages.forEach((page, pageIdx) => {
      if (!page || typeof page !== 'object') {
        errors.push({ field: `schema.pages[${pageIdx}]`, message: 'Page must be an object' });
        return;
      }
      const pageObj = page as Record<string, unknown>;
      const elements = pageObj.elements as unknown[] | undefined;

      // Check for elements with position validation
      if (elements && Array.isArray(elements)) {
        elements.forEach((el, elIdx) => {
          if (!el || typeof el !== 'object') return;
          const elem = el as Record<string, unknown>;
          const elPath = `schema.pages[${pageIdx}].elements[${elIdx}]`;

          // Check element type
          if (!elem.type || typeof elem.type !== 'string') {
            errors.push({ field: `${elPath}.type`, message: 'Element must have a type' });
          }

          // Check position
          const pos = elem.position as Record<string, unknown> | undefined;
          if (pos) {
            if (typeof pos.x !== 'number' || pos.x < 0) {
              errors.push({ field: `${elPath}.position.x`, message: 'Position x must be a non-negative number' });
            }
            if (typeof pos.y !== 'number' || pos.y < 0) {
              errors.push({ field: `${elPath}.position.y`, message: 'Position y must be a non-negative number' });
            }
          }

          // Check for bindings in element content/value/text
          walkElements(elem, elPath);
        });
      }
    });

    return errors;
  }

  async publish(id: string, orgId?: string, validate: boolean = true) {
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

    // Validate template before publishing
    if (validate) {
      const validationErrors = this.validateTemplateForPublish({
        name: template.name,
        type: template.type,
        schema: template.schema as Record<string, unknown>,
      });
      if (validationErrors.length > 0) {
        return { validationErrors };
      }
    }

    // Increment version number on each publish
    const newVersion = template.version + 1;

    const [result] = await this.db
      .update(templates)
      .set({
        status: 'published',
        version: newVersion,
        publishedVer: newVersion,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    // Create version history entry
    if (result) {
      await this.createVersionEntry({
        id: result.id,
        orgId: result.orgId,
        version: result.version,
        status: 'published',
        schema: result.schema,
        createdBy: result.createdBy,
      }, 'Published');
    }

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

  // ─── Version History ──────────────────────────────────────────────────

  /**
   * Create a version history entry for a template.
   * Called on publish and other significant actions.
   */
  async createVersionEntry(template: {
    id: string;
    orgId: string | null;
    version: number;
    status: string;
    schema: unknown;
    createdBy: string;
  }, changeNote?: string) {
    const id = createId();
    await this.db.insert(templateVersions).values({
      id,
      templateId: template.id,
      orgId: template.orgId,
      version: template.version,
      status: template.status,
      schema: template.schema as Record<string, unknown>,
      savedBy: template.createdBy,
      savedAt: new Date(),
      changeNote: changeNote || null,
    });

    // Purge old versions beyond the cap of 50
    await this.purgeOldVersions(template.id, 50);

    return id;
  }

  /**
   * Purge old version entries beyond the cap.
   * Keeps the most recent `maxVersions` entries and deletes the rest.
   */
  private async purgeOldVersions(templateId: string, maxVersions: number) {
    // Get all versions for this template ordered by savedAt desc
    const allVersions = await this.db
      .select({ id: templateVersions.id, savedAt: templateVersions.savedAt })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, templateId))
      .orderBy(desc(templateVersions.savedAt));

    if (allVersions.length <= maxVersions) return;

    // Delete versions beyond the cap
    const idsToDelete = allVersions.slice(maxVersions).map(v => v.id);
    if (idsToDelete.length > 0) {
      await this.db
        .delete(templateVersions)
        .where(inArray(templateVersions.id, idsToDelete));
    }
  }

  /**
   * Get version history for a template, ordered by version descending.
   * Capped at 50 entries.
   */
  async getVersionHistory(templateId: string, orgId?: string) {
    const conditions: SQL[] = [eq(templateVersions.templateId, templateId)];
    if (orgId) {
      conditions.push(
        or(eq(templateVersions.orgId, orgId), isNull(templateVersions.orgId))!,
      );
    }

    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(and(...conditions))
      .orderBy(desc(templateVersions.savedAt))
      .limit(50);

    return rows;
  }

  /**
   * Get a specific version of a template by version number.
   * Returns null if not found.
   */
  async getVersionByNumber(templateId: string, versionNumber: number, orgId?: string) {
    const conditions: SQL[] = [
      eq(templateVersions.templateId, templateId),
      eq(templateVersions.version, versionNumber),
    ];
    if (orgId) {
      conditions.push(
        or(eq(templateVersions.orgId, orgId), isNull(templateVersions.orgId))!,
      );
    }

    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(and(...conditions))
      .limit(1);

    return rows.length > 0 ? rows[0] : null;
  }

  // ─── Template Export / Import ────────────────────────────────────────

  /**
   * Extract asset references (image paths, font paths) from a template schema.
   * Scans for assetPath, src, basePdf references that point to storage.
   */
  private extractAssetPaths(schema: Record<string, unknown>): { images: string[]; fonts: string[] } {
    const images: Set<string> = new Set();
    const fonts: Set<string> = new Set();

    const walk = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }
      const record = obj as Record<string, unknown>;
      // Check for asset paths
      for (const key of ['assetPath', 'src', 'imageSrc', 'logoPath']) {
        const val = record[key];
        if (typeof val === 'string' && val.length > 0 && !val.startsWith('data:') && !val.startsWith('http')) {
          // Likely a storage path reference
          const ext = val.split('.').pop()?.toLowerCase() || '';
          if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext)) {
            images.add(val);
          }
        }
      }
      // Check for font paths
      for (const key of ['fontPath', 'fontSrc']) {
        const val = record[key];
        if (typeof val === 'string' && val.length > 0 && !val.startsWith('data:') && !val.startsWith('http')) {
          const ext = val.split('.').pop()?.toLowerCase() || '';
          if (['ttf', 'otf', 'woff2'].includes(ext)) {
            fonts.add(val);
          }
        }
      }
      // Recurse
      for (const v of Object.values(record)) {
        walk(v);
      }
    };

    walk(schema);
    return { images: [...images], fonts: [...fonts] };
  }

  /**
   * Export a template as a self-contained JSON package with embedded fonts and images.
   */
  async exportTemplate(id: string, orgId?: string): Promise<TemplateExportPackage | null> {
    const template = await this.findById(id, orgId);
    if (!template) return null;

    const { images: imagePaths, fonts: fontPaths } = this.extractAssetPaths(
      template.schema as Record<string, unknown>,
    );

    const MIME_MAP: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
      '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    };

    const resolveExt = (p: string) => {
      const dotIdx = p.lastIndexOf('.');
      return dotIdx >= 0 ? p.slice(dotIdx).toLowerCase() : '';
    };

    const embeddedImages: TemplateExportPackage['assets']['images'] = [];
    const embeddedFonts: TemplateExportPackage['assets']['fonts'] = [];

    if (this.storage) {
      for (const imgPath of imagePaths) {
        try {
          const exists = await this.storage.exists(imgPath);
          if (exists) {
            const buffer = await this.storage.read(imgPath);
            const ext = resolveExt(imgPath);
            embeddedImages.push({
              path: imgPath,
              mimeType: MIME_MAP[ext] || 'application/octet-stream',
              data: buffer.toString('base64'),
            });
          }
        } catch {
          // Skip assets that can't be read
        }
      }

      for (const fontPath of fontPaths) {
        try {
          const exists = await this.storage.exists(fontPath);
          if (exists) {
            const buffer = await this.storage.read(fontPath);
            const ext = resolveExt(fontPath);
            embeddedFonts.push({
              path: fontPath,
              mimeType: MIME_MAP[ext] || 'application/octet-stream',
              data: buffer.toString('base64'),
            });
          }
        } catch {
          // Skip fonts that can't be read
        }
      }
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      template: {
        type: template.type,
        name: template.name,
        schema: template.schema as Record<string, unknown>,
        status: template.status,
        version: template.version,
      },
      assets: {
        images: embeddedImages,
        fonts: embeddedFonts,
      },
    };
  }

  /**
   * Validate font data: checks for valid TTF/OTF/WOFF2 magic bytes.
   * Returns true if the font appears valid, false otherwise.
   */
  private validateFontData(buffer: Buffer, mimeType: string): { valid: boolean; error?: string } {
    if (buffer.length < 4) {
      return { valid: false, error: 'Font file too small (< 4 bytes)' };
    }

    // Check magic bytes for known font formats
    const magic = buffer.slice(0, 4);

    // TTF: starts with 0x00 0x01 0x00 0x00 or 'true' (0x74 0x72 0x75 0x65)
    const isTtf = (magic[0] === 0x00 && magic[1] === 0x01 && magic[2] === 0x00 && magic[3] === 0x00) ||
                  (magic[0] === 0x74 && magic[1] === 0x72 && magic[2] === 0x75 && magic[3] === 0x65);

    // OTF: starts with 'OTTO' (0x4F 0x54 0x54 0x4F)
    const isOtf = magic[0] === 0x4F && magic[1] === 0x54 && magic[2] === 0x54 && magic[3] === 0x4F;

    // WOFF2: starts with 'wOF2' (0x77 0x4F 0x46 0x32)
    const isWoff2 = magic[0] === 0x77 && magic[1] === 0x4F && magic[2] === 0x46 && magic[3] === 0x32;

    // WOFF: starts with 'wOFF' (0x77 0x4F 0x46 0x46)
    const isWoff = magic[0] === 0x77 && magic[1] === 0x4F && magic[2] === 0x46 && magic[3] === 0x46;

    if (mimeType === 'font/ttf' && !isTtf) {
      return { valid: false, error: 'Invalid TTF font: bad magic bytes' };
    }
    if (mimeType === 'font/otf' && !isOtf) {
      return { valid: false, error: 'Invalid OTF font: bad magic bytes' };
    }
    if (mimeType === 'font/woff2' && !isWoff2) {
      return { valid: false, error: 'Invalid WOFF2 font: bad magic bytes' };
    }

    // Accept if it matches any known font format
    if (!isTtf && !isOtf && !isWoff2 && !isWoff) {
      return { valid: false, error: 'Unrecognized font format: invalid magic bytes' };
    }

    return { valid: true };
  }

  /**
   * Import a template from a self-contained JSON export package.
   * Validates fonts, restores assets to storage, and creates the template as draft.
   */
  async importTemplate(
    pkg: TemplateExportPackage,
    orgId: string,
    createdBy: string,
  ): Promise<{ id: string; status: string; name: string; type: string; version: number; createdAt: Date; fontValidation?: { total: number; valid: number; invalid: number; errors: string[] }; assetsExtracted?: { images: number; fonts: number } }> {
    const fontValidationErrors: string[] = [];
    let validFonts = 0;
    let invalidFonts = 0;
    let extractedImages = 0;
    let extractedFonts = 0;

    // Validate and restore assets to storage
    if (this.storage) {
      // Process images
      for (const img of pkg.assets.images) {
        try {
          const buffer = Buffer.from(img.data, 'base64');
          // Remap path to new org
          const pathParts = img.path.split('/');
          const newPath = pathParts.length > 1
            ? `${orgId}/${pathParts.slice(1).join('/')}`
            : `${orgId}/assets/${pathParts[pathParts.length - 1]}`;
          await this.storage.write(newPath, buffer);
          extractedImages++;
        } catch {
          // Continue even if an asset fails
        }
      }

      // Validate and process fonts
      for (const font of pkg.assets.fonts) {
        try {
          const buffer = Buffer.from(font.data, 'base64');

          // Validate font data
          const validation = this.validateFontData(buffer, font.mimeType);
          if (!validation.valid) {
            invalidFonts++;
            fontValidationErrors.push(`${font.path}: ${validation.error}`);
            continue; // Skip invalid fonts
          }

          validFonts++;
          const pathParts = font.path.split('/');
          const newPath = pathParts.length > 1
            ? `${orgId}/${pathParts.slice(1).join('/')}`
            : `${orgId}/fonts/${pathParts[pathParts.length - 1]}`;
          await this.storage.write(newPath, buffer);
          extractedFonts++;
        } catch {
          invalidFonts++;
          fontValidationErrors.push(`${font.path}: Failed to process font data`);
        }
      }
    }

    // Create the template as draft
    const result = await this.create({
      orgId,
      type: pkg.template.type,
      name: pkg.template.name,
      schema: pkg.template.schema,
      createdBy,
      status: 'draft', // Always import as draft
    });

    return {
      id: result.id,
      status: result.status,
      name: result.name,
      type: result.type,
      version: result.version,
      createdAt: result.createdAt,
      fontValidation: {
        total: (pkg.assets.fonts || []).length,
        valid: validFonts,
        invalid: invalidFonts,
        errors: fontValidationErrors,
      },
      assetsExtracted: {
        images: extractedImages,
        fonts: extractedFonts,
      },
    };
  }

  // ─── Template Locking ────────────────────────────────────────────────

  /**
   * Acquire a pessimistic edit lock on a template.
   * Lock duration: 30 minutes from acquisition.
   * If already locked by same user, refreshes (heartbeat).
   * If locked by another user and not expired, returns error.
   */
  async acquireLock(id: string, userId: string, orgId?: string): Promise<LockResult | { error: string; lockedBy: string; lockedAt: Date; expiresAt: Date }> {
    const template = await this.findById(id, orgId);
    if (!template) {
      return { error: 'Template not found', lockedBy: '', lockedAt: new Date(), expiresAt: new Date() };
    }

    const now = new Date();

    // Check if already locked by someone else
    if (template.lockedBy && template.lockedBy !== userId && template.lockedAt) {
      const lockExpiry = new Date(template.lockedAt.getTime() + LOCK_DURATION_MS);
      if (now < lockExpiry) {
        // Lock is still active and held by someone else
        return {
          error: `Template is locked by another user`,
          lockedBy: template.lockedBy,
          lockedAt: template.lockedAt,
          expiresAt: lockExpiry,
        };
      }
      // Lock has expired — we can take it over
    }

    // Acquire or renew the lock
    const [result] = await this.db
      .update(templates)
      .set({
        lockedBy: userId,
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(templates.id, id))
      .returning();

    const expiresAt = new Date(now.getTime() + LOCK_DURATION_MS);

    return {
      locked: true,
      lockedBy: userId,
      lockedAt: now,
      expiresAt,
    };
  }

  /**
   * Release a lock on a template.
   * Only the lock holder can release it (or an admin can force-release).
   */
  async releaseLock(id: string, userId: string, force: boolean = false, orgId?: string): Promise<{ released: boolean; error?: string }> {
    const template = await this.findById(id, orgId);
    if (!template) {
      return { released: false, error: 'Template not found' };
    }

    if (!template.lockedBy) {
      return { released: true }; // Already unlocked
    }

    if (template.lockedBy !== userId && !force) {
      return { released: false, error: 'Lock is held by another user' };
    }

    await this.db
      .update(templates)
      .set({
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id));

    return { released: true };
  }

  /**
   * Check if a template is locked by another user.
   * Returns null if the template is not locked or locked by the requesting user.
   * Returns lock info if locked by a different user (active, non-expired lock).
   */
  async checkLockConflict(id: string, userId: string, orgId?: string): Promise<{ lockedBy: string; lockedAt: Date; expiresAt: Date } | null> {
    const template = await this.findById(id, orgId);
    if (!template) return null;

    if (!template.lockedBy || !template.lockedAt) return null;

    // Same user — no conflict
    if (template.lockedBy === userId) return null;

    const expiresAt = new Date(template.lockedAt.getTime() + LOCK_DURATION_MS);
    const now = new Date();

    // Expired lock — no conflict
    if (now >= expiresAt) return null;

    // Active lock held by another user — conflict!
    return {
      lockedBy: template.lockedBy,
      lockedAt: template.lockedAt,
      expiresAt,
    };
  }

  /**
   * Get the current lock status of a template.
   */
  async getLockStatus(id: string, orgId?: string): Promise<{ locked: boolean; lockedBy: string | null; lockedAt: Date | null; expiresAt: Date | null; expired: boolean }> {
    const template = await this.findById(id, orgId);
    if (!template) {
      return { locked: false, lockedBy: null, lockedAt: null, expiresAt: null, expired: false };
    }

    if (!template.lockedBy || !template.lockedAt) {
      return { locked: false, lockedBy: null, lockedAt: null, expiresAt: null, expired: false };
    }

    const expiresAt = new Date(template.lockedAt.getTime() + LOCK_DURATION_MS);
    const expired = new Date() >= expiresAt;

    return {
      locked: !expired,
      lockedBy: template.lockedBy,
      lockedAt: template.lockedAt,
      expiresAt,
      expired,
    };
  }
}
