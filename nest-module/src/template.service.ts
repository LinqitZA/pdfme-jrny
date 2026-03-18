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
