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
import { Parser } from 'expr-eval';
import { templates, templateVersions, userSignatures } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { AuditService } from './audit.service';
import { FileStorageService } from './file-storage.service';
import { FieldSchemaRegistry } from './field-schema.registry';

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
  saveMode?: string;
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
    @Optional() @Inject('FIELD_SCHEMA_REGISTRY') private readonly fieldSchemaRegistry?: FieldSchemaRegistry,
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
   * Fork (clone) a template, creating a new draft copy with forkedFromId set.
   */
  async forkTemplate(sourceId: string, orgId: string, userId: string, newName?: string) {
    // Get the source template
    const conditions: any[] = [eq(templates.id, sourceId)];
    // Allow forking from own org or system templates
    const [source] = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, sourceId))
      .limit(1);

    if (!source) return null;

    // Check org access: must be same org or system template
    if (source.orgId && source.orgId !== orgId) return null;

    const id = createId();
    const now = new Date();
    const [result] = await this.db
      .insert(templates)
      .values({
        id,
        orgId,
        type: source.type,
        name: newName || `${source.name} (Fork)`,
        schema: source.schema,
        status: 'draft',
        version: 1,
        forkedFromId: sourceId,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Audit log: template forked
    if (this.auditService && result) {
      await this.auditService.log({
        orgId: result.orgId || '',
        entityType: 'template',
        entityId: result.id,
        action: 'template.forked',
        userId,
        metadata: { sourceTemplateId: sourceId, sourceName: source.name },
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
  async saveDraft(id: string, dto: SaveDraftDto, orgId?: string, userId?: string) {
    // Check current template status to determine if we should keep published status
    const existing = await this.findById(id, orgId);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // If template is published and has a publishedSchema, keep status as 'published'
    // so the published version remains accessible for rendering while editing draft
    if (existing && existing.status === 'published' && existing.publishedSchema) {
      // Keep status as 'published' — publishedSchema is used for rendering
      // Only update the working schema (draft edits)
    } else {
      updateData.status = 'draft';
    }

    if (dto.schema !== undefined) updateData.schema = dto.schema;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.saveMode !== undefined) updateData.saveMode = dto.saveMode;

    // saveMode=newVersion: increment the version number to create a new draft version
    if (dto.saveMode === 'newVersion' && existing) {
      updateData.version = existing.version + 1;
    }

    const conditions: SQL[] = [eq(templates.id, id)];
    if (orgId) {
      conditions.push(eq(templates.orgId, orgId));
    }

    const [result] = await this.db
      .update(templates)
      .set(updateData)
      .where(and(...conditions))
      .returning();

    // Create a version history entry on each save
    if (result) {
      await this.createVersionEntry({
        id: result.id,
        orgId: result.orgId,
        version: result.version,
        status: 'draft',
        schema: result.schema,
        createdBy: userId || 'unknown',
      }, dto.saveMode === 'newVersion' ? 'New version save' : 'Draft save');

      // Audit log: template updated
      if (this.auditService) {
        await this.auditService.log({
          orgId: result.orgId || '',
          entityType: 'template',
          entityId: result.id,
          action: 'template.updated',
          userId: userId || 'unknown',
        });
      }
    }

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
  /**
   * Try to parse and evaluate an expression string using expr-eval.
   * Returns null if valid, or an error message string if invalid.
   * Known functions are registered as stubs so they don't cause false positives.
   * Unknown variables are allowed (they represent field references at runtime).
   */
  private validateExpression(expression: string): string | null {
    try {
      const parser = new Parser({
        operators: {
          add: true, concatenate: true, conditional: true,
          divide: true, factorial: false, multiply: true,
          power: true, remainder: true, subtract: true,
          logical: true, comparison: true, 'in': false, assignment: false,
        },
      });
      // Register known function names so they don't cause eval errors
      const knownFunctions = [
        'IF', 'AND', 'OR', 'NOT', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER',
        'TRIM', 'CONCAT', 'LEN', 'FORMAT', 'ROUND', 'ABS', 'TODAY', 'YEAR',
        'MONTH', 'DAY', 'DATEDIFF', 'FORMAT_CURRENCY', 'FORMAT_DATE', 'FORMAT_NUMBER',
      ];
      for (const fn of knownFunctions) {
        parser.functions[fn] = (..._args: unknown[]) => 0;
      }

      const parsed = parser.parse(expression);

      // Try to evaluate with dummy values for all variables
      // This catches unknown function calls like INVALID()
      const vars = parsed.variables({ withMembers: false });
      const dummyContext: Record<string, number> = {};
      for (const v of vars) {
        dummyContext[v] = 0;
      }
      parsed.evaluate(dummyContext);

      return null;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return message;
    }
  }

  /**
   * Get all known field keys for a given template type from the field schema registry.
   * Returns null if no registry or no schema for this type (skip validation).
   */
  private getKnownFieldKeys(templateType: string): Set<string> | null {
    if (!this.fieldSchemaRegistry) return null;
    const fieldGroups = this.fieldSchemaRegistry.resolve(templateType);
    if (!fieldGroups) return null;

    const keys = new Set<string>();
    const walkGroups = (groups: Array<{ key: string; label: string; fields: Array<{ key: string }>; children?: unknown[] }>) => {
      for (const group of groups) {
        for (const field of group.fields) {
          keys.add(field.key);
          // Also add the base key without array notation for line items
          // e.g. lineItems[].description -> lineItems.description (also valid in bindings)
          if (field.key.includes('[]')) {
            keys.add(field.key.replace('[]', ''));
          }
        }
        if (group.children && Array.isArray(group.children)) {
          walkGroups(group.children as any);
        }
      }
    };
    walkGroups(fieldGroups as any);
    return keys;
  }

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

    // Build set of known field keys for binding validation (#268)
    const knownFields = this.getKnownFieldKeys(template.type);

    // Validate bindings in elements
    const bindingPattern = /\{\{([^}]*)\}\}/g;
    const validBindingPattern = /^[a-zA-Z_][a-zA-Z0-9_.\[\]]*$/;
    // Feature #386: Also detect single-curly {field} bindings for orphaned element detection
    const singleBindingPattern = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;

    // Track orphaned elements for Feature #386 reporting
    const orphanedElements: Array<{ element: string; field: string; binding: string }> = [];

    const walkElements = (obj: unknown, path: string, elementName?: string) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => walkElements(item, `${path}[${idx}]`, elementName));
        return;
      }
      const record = obj as Record<string, unknown>;

      // Check string values for invalid bindings
      for (const [key, val] of Object.entries(record)) {
        if (typeof val === 'string') {
          let match;
          // Check double-curly bindings {{field}}
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
            } else if (knownFields && !knownFields.has(binding)) {
              // Feature #268: Check binding against known field schema
              errors.push({
                field: `${path}.${key}`,
                message: `Unresolvable binding: {{${binding}}} - field '${binding}' is not defined in the '${template.type}' field schema`,
              });
              // Feature #386: Track as orphaned element
              orphanedElements.push({
                element: elementName || path,
                field: `${path}.${key}`,
                binding: binding,
              });
            }
          }

          // Feature #386: Check single-curly bindings {field} for orphaned element detection
          if (knownFields && key === 'content') {
            singleBindingPattern.lastIndex = 0;
            while ((match = singleBindingPattern.exec(val)) !== null) {
              const binding = match[0]; // full match like {fieldName}
              const fieldRef = match[1]; // inner field name

              // Skip if this is actually inside a double-curly (already checked above)
              const matchStart = match.index;
              if (matchStart > 0 && val[matchStart - 1] === '{') continue;
              if (matchStart + match[0].length < val.length && val[matchStart + match[0].length] === '}') continue;

              // Check if the field reference exists in known fields
              if (!knownFields.has(fieldRef)) {
                errors.push({
                  field: `${path}.${key}`,
                  message: `Orphaned element: references field '${fieldRef}' which is not defined in the '${template.type}' field schema. This element may reference a deleted or renamed field.`,
                });
                orphanedElements.push({
                  element: elementName || path,
                  field: `${path}.${key}`,
                  binding: fieldRef,
                });
              }
            }
          }
        } else if (typeof val === 'object') {
          walkElements(val, `${path}.${key}`, elementName);
        }
      }
    };

    // Track total element count across all pages
    let totalElementCount = 0;

    pages.forEach((page, pageIdx) => {
      if (!page || typeof page !== 'object') {
        errors.push({ field: `schema.pages[${pageIdx}]`, message: 'Page must be an object' });
        return;
      }
      const pageObj = page as Record<string, unknown>;
      const elements = pageObj.elements as unknown[] | undefined;

      // Check that page has elements
      if (!elements || !Array.isArray(elements) || elements.length === 0) {
        errors.push({
          field: `schema.pages[${pageIdx}].elements`,
          message: `Page ${pageIdx + 1} has no elements. Each page must contain at least one element.`,
        });
      } else {
        totalElementCount += elements.length;
      }

      // Check for elements with position validation
      if (elements && Array.isArray(elements)) {
        elements.forEach((el, elIdx) => {
          if (!el || typeof el !== 'object') return;
          const elem = el as Record<string, unknown>;
          const elPath = `schema.pages[${pageIdx}].elements[${elIdx}]`;
          const elemType = elem.type as string;

          // Check element type
          if (!elemType || typeof elemType !== 'string') {
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

          // Feature #267: Validate expressions in calculated fields and conditional visibility
          if (elemType === 'calculated' || elemType === 'calculated-field') {
            const expression = (elem.expression || elem.content) as string | undefined;
            if (expression && typeof expression === 'string' && expression.trim()) {
              // Don't validate pure binding references like {{field.name}}
              const exprStr = expression.trim();
              const isPureBinding = /^\{\{[^}]+\}\}$/.test(exprStr);
              if (!isPureBinding) {
                const exprError = this.validateExpression(exprStr);
                if (exprError) {
                  errors.push({
                    field: `${elPath}.expression`,
                    message: `Invalid expression: ${exprError}`,
                  });
                }
              }
            }
          }

          // Validate conditionalVisibility expressions
          const condVis = elem.conditionalVisibility as Record<string, unknown> | string | undefined;
          if (condVis && typeof condVis === 'object' && condVis.type === 'expression') {
            const condExpr = condVis.expression as string | undefined;
            if (condExpr && typeof condExpr === 'string' && condExpr.trim()) {
              const exprError = this.validateExpression(condExpr.trim());
              if (exprError) {
                errors.push({
                  field: `${elPath}.conditionalVisibility.expression`,
                  message: `Invalid conditional visibility expression: ${exprError}`,
                });
              }
            }
          }

          // Feature #269: Validate line items table column widths
          if (elemType === 'line-items-table' || elemType === 'lineItemsTable' || elemType === 'line_items_table' || elemType === 'grouped-table') {
            const columns = elem.columns as Array<Record<string, unknown>> | undefined;
            if (columns && Array.isArray(columns) && columns.length > 0) {
              const totalWidth = columns.reduce((sum: number, col: Record<string, unknown>) => {
                const w = typeof col.width === 'number' ? col.width : 0;
                return sum + w;
              }, 0);
              const elementWidth = (typeof elem.width === 'number' ? elem.width : typeof elem.w === 'number' ? elem.w : null);
              if (elementWidth !== null && elementWidth > 0) {
                // Allow a small tolerance (0.5mm) for floating point rounding
                const diff = Math.abs(totalWidth - elementWidth);
                if (diff > 0.5) {
                  errors.push({
                    field: `${elPath}.columns`,
                    message: `Column widths sum to ${totalWidth}mm but element width is ${elementWidth}mm. Column widths must sum to the element width.`,
                  });
                }
              }
            }
          }

          // Feature #271: Validate page scope on elements
          const pageScope = (elem.pageScope || elem.page_scope) as string | undefined;
          if (pageScope && typeof pageScope === 'string' && pageScope !== 'all') {
            const validScopes = ['all', 'first', 'last', 'notFirst', 'not_first'];
            if (!validScopes.includes(pageScope)) {
              errors.push({
                field: `${elPath}.pageScope`,
                message: `Invalid page scope '${pageScope}'. Must be one of: ${validScopes.join(', ')}`,
              });
            } else if (pages.length === 1) {
              // Single-page template with non-default scope is unreachable or redundant
              if (pageScope === 'notFirst' || pageScope === 'not_first') {
                errors.push({
                  field: `${elPath}.pageScope`,
                  message: `Unreachable page scope: '${pageScope}' on a single-page template. This element will never be visible because there is no page after the first.`,
                });
              } else if (pageScope === 'last' || pageScope === 'first') {
                errors.push({
                  field: `${elPath}.pageScope`,
                  message: `Redundant page scope: '${pageScope}' on a single-page template. On a single page, '${pageScope}' is equivalent to 'all'. Consider using 'all' or removing the scope.`,
                });
              }
            }
          }

          // Check for bindings in element content/value/text
          walkElements(elem, elPath, (elem.name as string) || `element[${elIdx}]`);
        });
      }
    });

    // After iterating all pages, check total element count
    if (totalElementCount === 0 && errors.length === 0) {
      errors.push({
        field: 'schema',
        message: 'Template has no elements across any page. Add at least one element to publish.',
      });
    }

    // Feature #386: Attach orphaned elements info to the errors array for the caller
    // Store orphanedElements on the array for the validate endpoint to access
    (errors as any).__orphanedElements = orphanedElements;

    return errors;
  }

  async publish(id: string, orgId?: string, validate: boolean = true) {
    // First find the template to check its current status
    const template = await this.findById(id, orgId);
    if (!template) return null;

    if (template.status === 'published') {
      // Check if draft schema differs from published schema (re-publish scenario)
      const draftSchemaStr = JSON.stringify(template.schema);
      const publishedSchemaStr = template.publishedSchema ? JSON.stringify(template.publishedSchema) : null;
      if (publishedSchemaStr && draftSchemaStr === publishedSchemaStr) {
        // Already published with same schema — return as-is (idempotent)
        return template;
      }
      // Schema has changed since last publish — proceed with re-publish
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
        publishedSchema: template.schema, // snapshot the current schema for rendering
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
  async softDelete(id: string, orgId?: string, userId?: string) {
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
        userId: userId || result.createdBy,
        metadata: { name: result.name, previousStatus: 'draft' },
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

  /**
   * Restore a template to a historical version.
   * Creates a new draft with the schema from the specified version.
   * Does not affect the published version.
   */
  async restoreVersion(templateId: string, versionNumber: number, orgId: string, userId: string) {
    // 1. Verify template exists and belongs to org
    const [template] = await this.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.orgId, orgId)))
      .limit(1);

    if (!template) return null;

    // 2. Get the historical version
    const historicalVersion = await this.getVersionByNumber(templateId, versionNumber, orgId);
    if (!historicalVersion) return { error: 'version_not_found', versionNumber };

    // 3. Update the template with the historical schema, set to draft
    const now = new Date();
    const [result] = await this.db
      .update(templates)
      .set({
        schema: historicalVersion.schema,
        status: 'draft',
        updatedAt: now,
      })
      .where(eq(templates.id, templateId))
      .returning();

    // 4. Create a version entry for the restore action
    if (result) {
      await this.createVersionEntry({
        id: result.id,
        orgId: result.orgId || '',
        version: result.version,
        status: result.status,
        schema: result.schema as Record<string, unknown>,
        createdBy: userId,
      }, `Restored from version ${versionNumber}`);
    }

    // 5. Audit log
    if (this.auditService && result) {
      await this.auditService.log({
        orgId: result.orgId || '',
        entityType: 'template',
        entityId: result.id,
        action: 'template.restored',
        userId,
        metadata: { restoredVersion: versionNumber, name: result.name },
      });
    }

    return result;
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
   * Validate font data: checks for valid TTF/OTF/WOFF2 magic bytes and fsType license compliance.
   * Returns true if the font appears valid and is licensed for embedding, false otherwise.
   */
  private validateFontData(buffer: Buffer, mimeType: string): { valid: boolean; error?: string; fsType?: number | null; restricted?: boolean } {
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

    // Check fsType embedding permission (TTF/OTF only — WOFF2 doesn't expose OS/2 table directly)
    if (isTtf || isOtf) {
      const fsType = this.readFsTypeFromFont(buffer);
      if (fsType !== null) {
        const check = this.checkFsType(fsType);
        if (!check.allowed) {
          return {
            valid: false,
            error: `Font embedding restricted: ${check.description}. fsType=0x${fsType.toString(16).padStart(4, '0')}. This font cannot be used for PDF generation.`,
            fsType,
            restricted: true,
          };
        }
        return { valid: true, fsType };
      }
    }

    return { valid: true, fsType: null };
  }

  /**
   * Read fsType from a TTF/OTF font's OS/2 table.
   * Returns the fsType value, or null if not found.
   */
  private readFsTypeFromFont(buffer: Buffer): number | null {
    if (buffer.length < 12) return null;

    const numTables = buffer.readUInt16BE(4);
    const tableOffset = 12;

    for (let i = 0; i < numTables; i++) {
      const entryOffset = tableOffset + i * 16;
      if (entryOffset + 16 > buffer.length) break;

      const tag = buffer.toString('ascii', entryOffset, entryOffset + 4);

      if (tag === 'OS/2') {
        const os2Offset = buffer.readUInt32BE(entryOffset + 8);
        // fsType is at offset 8 within the OS/2 table
        const fsTypeOffset = os2Offset + 8;
        if (fsTypeOffset + 2 > buffer.length) return null;
        return buffer.readUInt16BE(fsTypeOffset);
      }
    }

    return null;
  }

  /**
   * Check fsType embedding permission bits.
   * Returns whether embedding is allowed and a description.
   */
  private checkFsType(fsType: number): { allowed: boolean; description: string } {
    // Installable embedding (most permissive)
    if (fsType === 0x0000) {
      return { allowed: true, description: 'Installable embedding (no restrictions)' };
    }

    const restricted = (fsType & 0x0002) !== 0;
    const previewPrint = (fsType & 0x0004) !== 0;
    const editable = (fsType & 0x0008) !== 0;

    // Restricted license embedding - font cannot be embedded
    if (restricted && !previewPrint && !editable) {
      return { allowed: false, description: 'Restricted License embedding — font cannot be embedded in documents' };
    }

    // Preview & Print is OK for PDF generation
    if (previewPrint) {
      return { allowed: true, description: 'Preview & Print embedding allowed' };
    }

    // Editable embedding is also fine
    if (editable) {
      return { allowed: true, description: 'Editable embedding allowed' };
    }

    // Default: allow
    return { allowed: true, description: `fsType=0x${fsType.toString(16).padStart(4, '0')}` };
  }

  /**
   * Import a template from a self-contained JSON export package.
   * Validates fonts, restores assets to storage, and creates the template as draft.
   */
  async importTemplate(
    pkg: TemplateExportPackage,
    orgId: string,
    createdBy: string,
  ): Promise<{ id: string; status: string; name: string; type: string; version: number; createdAt: Date; fontValidation?: { total: number; valid: number; invalid: number; errors: string[] }; assetsExtracted?: { images: number; fonts: number }; assetsSkipped?: { images: number; fonts: number } }> {
    const fontValidationErrors: string[] = [];
    let validFonts = 0;
    let invalidFonts = 0;
    let extractedImages = 0;
    let extractedFonts = 0;

    // Validate and restore assets to storage (with deduplication)
    let skippedImages = 0;
    let skippedFonts = 0;
    if (this.storage) {
      // Process images - skip if identical content already exists at target path
      for (const img of pkg.assets.images) {
        try {
          const buffer = Buffer.from(img.data, 'base64');
          // Remap path to new org
          const pathParts = img.path.split('/');
          const newPath = pathParts.length > 1
            ? `${orgId}/${pathParts.slice(1).join('/')}`
            : `${orgId}/assets/${pathParts[pathParts.length - 1]}`;

          // Deduplication: check if asset already exists with same content
          const exists = await this.storage.exists(newPath);
          if (exists) {
            try {
              const existingBuffer = await this.storage.read(newPath);
              if (existingBuffer.length === buffer.length && existingBuffer.equals(buffer)) {
                skippedImages++;
                continue; // Identical asset already exists, skip
              }
            } catch {
              // Can't read existing file, overwrite it
            }
          }

          await this.storage.write(newPath, buffer);
          extractedImages++;
        } catch {
          // Continue even if an asset fails
        }
      }

      // Validate and process fonts - skip if identical content already exists
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

          // Deduplication: check if font already exists with same content
          const exists = await this.storage.exists(newPath);
          if (exists) {
            try {
              const existingBuffer = await this.storage.read(newPath);
              if (existingBuffer.length === buffer.length && existingBuffer.equals(buffer)) {
                skippedFonts++;
                continue; // Identical font already exists, skip
              }
            } catch {
              // Can't read existing file, overwrite it
            }
          }

          await this.storage.write(newPath, buffer);
          extractedFonts++;
        } catch {
          invalidFonts++;
          fontValidationErrors.push(`${font.path}: Failed to process font data`);
        }
      }
    }

    // Deduplicate name: if a template with the same name exists in this org, add suffix
    let importName = pkg.template.name;
    const existingWithName = await this.db
      .select({ name: templates.name })
      .from(templates)
      .where(
        and(
          or(eq(templates.orgId, orgId), isNull(templates.orgId)),
          ilike(templates.name, `${importName}%`),
        ),
      );
    if (existingWithName.length > 0) {
      const existingNames = new Set(existingWithName.map((t) => t.name));
      // Try (Import), (Import 2), (Import 3), etc.
      let suffix = '';
      let counter = 1;
      do {
        suffix = counter === 1 ? ' (Import)' : ` (Import ${counter})`;
        counter++;
      } while (existingNames.has(`${importName}${suffix}`));
      importName = `${importName}${suffix}`;
    }

    // Create the template as draft
    const result = await this.create({
      orgId,
      type: pkg.template.type,
      name: importName,
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
      assetsSkipped: {
        images: skippedImages,
        fonts: skippedFonts,
      },
    };
  }

  // ─── Org Backup Export ──────────────────────────────────────────────

  /**
   * Export a comprehensive backup of all org data as a JSON package.
   * Includes all templates, assets (images + fonts), signatures, and locale config.
   */
  async backupOrg(
    orgId: string,
    localeConfig?: { locale: string; currency: string; timezone: string },
  ): Promise<{
    version: number;
    exportedAt: string;
    orgId: string;
    templates: Array<{ id: string; name: string; type: string; status: string; version: number; schema: unknown; createdAt: Date; updatedAt: Date }>;
    assets: { images: Array<{ path: string; data: string; mimeType: string }>; fonts: Array<{ path: string; data: string; mimeType: string }> };
    signatures: Array<{ id: string; userId: string; filePath: string; capturedAt: Date; data: string }>;
    localeConfig: { locale: string; currency: string; timezone: string } | null;
  }> {
    const exportedAt = new Date().toISOString();

    // 1. Fetch all templates for the org (including archived)
    const orgTemplates = await this.db
      .select()
      .from(templates)
      .where(
        or(eq(templates.orgId, orgId), isNull(templates.orgId)),
      );

    const templateData = orgTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      version: t.version,
      schema: t.schema,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    // 2. Fetch all assets (images + fonts) from storage
    const images: Array<{ path: string; data: string; mimeType: string }> = [];
    const fonts: Array<{ path: string; data: string; mimeType: string }> = [];

    const MIME_MAP: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
      '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    };

    if (this.storage) {
      // List and read images
      try {
        const imageFiles = await this.storage.list(`${orgId}/assets`);
        for (const filePath of imageFiles) {
          try {
            const buffer = await this.storage.read(filePath);
            const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '');
            images.push({
              path: filePath,
              data: buffer.toString('base64'),
              mimeType: MIME_MAP[ext] || 'application/octet-stream',
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // No images directory
      }

      // List and read fonts
      try {
        const fontFiles = await this.storage.list(`${orgId}/fonts`);
        for (const filePath of fontFiles) {
          try {
            const buffer = await this.storage.read(filePath);
            const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '');
            fonts.push({
              path: filePath,
              data: buffer.toString('base64'),
              mimeType: MIME_MAP[ext] || 'application/octet-stream',
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // No fonts directory
      }
    }

    // 3. Fetch all signatures for the org
    const orgSignatures = await this.db
      .select()
      .from(userSignatures)
      .where(eq(userSignatures.orgId, orgId));

    const signatureData: Array<{ id: string; userId: string; filePath: string; capturedAt: Date; data: string }> = [];
    for (const sig of orgSignatures) {
      let sigBase64 = '';
      if (this.storage) {
        try {
          const buffer = await this.storage.read(sig.filePath);
          sigBase64 = buffer.toString('base64');
        } catch {
          // Skip if file not found
        }
      }
      signatureData.push({
        id: sig.id,
        userId: sig.userId,
        filePath: sig.filePath,
        capturedAt: sig.capturedAt,
        data: sigBase64,
      });
    }

    return {
      version: 1,
      exportedAt,
      orgId,
      templates: templateData,
      assets: { images, fonts },
      signatures: signatureData,
      localeConfig: localeConfig || null,
    };
  }

  // ─── Org Backup Export as ZIP ──────────────────────────────────────

  /**
   * Export a comprehensive backup of all org data as a ZIP archive.
   * ZIP structure:
   *   manifest.json          — metadata (version, exportedAt, orgId, localeConfig)
   *   templates/             — one JSON file per template
   *   assets/images/         — binary image files
   *   assets/fonts/          — binary font files
   *   signatures/            — binary signature files + index.json
   */
  async backupOrgAsZip(
    orgId: string,
    localeConfig?: { locale: string; currency: string; timezone: string },
  ): Promise<Buffer> {
    const archiver = (await import('archiver')).default;

    const exportedAt = new Date().toISOString();

    // 1. Fetch all templates for the org
    const orgTemplates = await this.db
      .select()
      .from(templates)
      .where(
        or(eq(templates.orgId, orgId), isNull(templates.orgId)),
      );

    // 2. Create archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    const bufferPromise = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(err));
    });

    // 3. Add manifest
    const manifest = {
      version: 1,
      exportedAt,
      orgId,
      templateCount: orgTemplates.length,
      localeConfig: localeConfig || null,
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // 4. Add templates (one JSON file per template)
    const templateIndex: Array<{ id: string; name: string; type: string; status: string; file: string }> = [];
    for (const t of orgTemplates) {
      const filename = `templates/${t.id}.json`;
      const templateJson = {
        id: t.id,
        name: t.name,
        type: t.type,
        status: t.status,
        version: t.version,
        schema: t.schema,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
      archive.append(JSON.stringify(templateJson, null, 2), { name: filename });
      templateIndex.push({ id: t.id, name: t.name, type: t.type, status: t.status, file: filename });
    }
    archive.append(JSON.stringify(templateIndex, null, 2), { name: 'templates/index.json' });

    // 5. Add assets (images + fonts) as binary files
    const assetIndex: { images: string[]; fonts: string[] } = { images: [], fonts: [] };

    if (this.storage) {
      // Images
      try {
        const imageFiles = await this.storage.list(`${orgId}/assets`);
        for (const filePath of imageFiles) {
          try {
            const buffer = await this.storage.read(filePath);
            const zipPath = `assets/images/${filePath.split('/').pop() || filePath}`;
            archive.append(buffer, { name: zipPath });
            assetIndex.images.push(zipPath);
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // No images directory
      }

      // Fonts
      try {
        const fontFiles = await this.storage.list(`${orgId}/fonts`);
        for (const filePath of fontFiles) {
          try {
            const buffer = await this.storage.read(filePath);
            const zipPath = `assets/fonts/${filePath.split('/').pop() || filePath}`;
            archive.append(buffer, { name: zipPath });
            assetIndex.fonts.push(zipPath);
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // No fonts directory
      }
    }
    archive.append(JSON.stringify(assetIndex, null, 2), { name: 'assets/index.json' });

    // 6. Add signatures
    const orgSignatures = await this.db
      .select()
      .from(userSignatures)
      .where(eq(userSignatures.orgId, orgId));

    const sigIndex: Array<{ id: string; userId: string; file: string; capturedAt: Date }> = [];
    for (const sig of orgSignatures) {
      if (this.storage) {
        try {
          const buffer = await this.storage.read(sig.filePath);
          const filename = `signatures/${sig.id}_${sig.filePath.split('/').pop() || 'sig'}`;
          archive.append(buffer, { name: filename });
          sigIndex.push({ id: sig.id, userId: sig.userId, file: filename, capturedAt: sig.capturedAt });
        } catch {
          // Skip unreadable signature files
        }
      }
    }
    archive.append(JSON.stringify(sigIndex, null, 2), { name: 'signatures/index.json' });

    // 7. Finalize
    await archive.finalize();
    return bufferPromise;
  }

  // ─── Org Backup Import ──────────────────────────────────────────────

  /**
   * Import a comprehensive backup package into an org.
   * Creates all templates as drafts, restores assets (images + fonts),
   * and restores signatures with their file data.
   */
  async importBackup(
    backup: {
      version: number;
      exportedAt: string;
      orgId: string;
      templates: Array<{ id: string; name: string; type: string; status: string; version: number; schema: unknown; createdAt: Date; updatedAt: Date }>;
      assets: { images: Array<{ path: string; data: string; mimeType: string }>; fonts: Array<{ path: string; data: string; mimeType: string }> };
      signatures: Array<{ id: string; userId: string; filePath: string; capturedAt: Date; data: string }>;
      localeConfig: { locale: string; currency: string; timezone: string } | null;
    },
    targetOrgId: string,
    importedBy: string,
  ): Promise<{
    templatesCreated: number;
    assetsRestored: { images: number; fonts: number };
    signaturesRestored: number;
    templates: Array<{ id: string; name: string; type: string; status: string }>;
    fontValidation?: { total: number; accepted: number; rejected: number; errors: string[] };
  }> {
    const createdTemplates: Array<{ id: string; name: string; type: string; status: string }> = [];
    const fontValidationErrors: string[] = [];
    let acceptedFonts = 0;
    let rejectedFonts = 0;
    const rejectedFontPaths = new Set<string>();

    // 1. Import all templates as drafts
    for (const tpl of backup.templates) {
      // Deduplicate name
      let importName = tpl.name;
      const existingWithName = await this.db
        .select({ name: templates.name })
        .from(templates)
        .where(
          and(
            or(eq(templates.orgId, targetOrgId), isNull(templates.orgId)),
            ilike(templates.name, `${importName}%`),
          ),
        );
      if (existingWithName.length > 0) {
        const existingNames = new Set(existingWithName.map((t) => t.name));
        if (existingNames.has(importName)) {
          let counter = 1;
          let suffix = '';
          do {
            suffix = counter === 1 ? ' (Import)' : ` (Import ${counter})`;
            counter++;
          } while (existingNames.has(`${importName}${suffix}`));
          importName = `${importName}${suffix}`;
        }
      }

      const result = await this.create({
        orgId: targetOrgId,
        type: tpl.type,
        name: importName,
        schema: tpl.schema as Record<string, unknown>,
        createdBy: importedBy,
        status: 'draft',
      });
      createdTemplates.push({ id: result.id, name: result.name, type: result.type, status: result.status });
    }

    // 2. Restore assets (images + fonts with license validation)
    let restoredImages = 0;
    let restoredFonts = 0;

    if (this.storage) {
      for (const img of (backup.assets?.images || [])) {
        try {
          const buffer = Buffer.from(img.data, 'base64');
          const pathParts = img.path.split('/');
          const newPath = pathParts.length > 1
            ? `${targetOrgId}/${pathParts.slice(1).join('/')}`
            : `${targetOrgId}/assets/${pathParts[pathParts.length - 1]}`;
          await this.storage.write(newPath, buffer);
          restoredImages++;
        } catch {
          // Skip failed assets
        }
      }

      for (const font of (backup.assets?.fonts || [])) {
        try {
          const buffer = Buffer.from(font.data, 'base64');

          // Validate font format and fsType license compliance
          const validation = this.validateFontData(buffer, font.mimeType);
          if (!validation.valid) {
            rejectedFonts++;
            const errorMsg = validation.restricted
              ? `${font.path}: Font rejected — ${validation.error}`
              : `${font.path}: ${validation.error}`;
            fontValidationErrors.push(errorMsg);
            rejectedFontPaths.add(font.path);
            continue; // Skip restricted/invalid fonts
          }

          acceptedFonts++;
          const pathParts = font.path.split('/');
          const newPath = pathParts.length > 1
            ? `${targetOrgId}/${pathParts.slice(1).join('/')}`
            : `${targetOrgId}/fonts/${pathParts[pathParts.length - 1]}`;
          await this.storage.write(newPath, buffer);
          restoredFonts++;
        } catch {
          rejectedFonts++;
          fontValidationErrors.push(`${font.path}: Failed to process font data`);
        }
      }
    }

    // 3. Restore signatures
    let signaturesRestored = 0;
    for (const sig of (backup.signatures || [])) {
      try {
        // Write signature file to storage
        if (this.storage && sig.data) {
          const buffer = Buffer.from(sig.data, 'base64');
          const pathParts = sig.filePath.split('/');
          const newPath = pathParts.length > 1
            ? `${targetOrgId}/${pathParts.slice(1).join('/')}`
            : `${targetOrgId}/signatures/${pathParts[pathParts.length - 1]}`;

          await this.storage.write(newPath, buffer);

          // Insert signature record
          const newId = createId();
          await this.db.insert(userSignatures).values({
            id: newId,
            orgId: targetOrgId,
            userId: sig.userId,
            filePath: newPath,
            capturedAt: new Date(sig.capturedAt),
          });
          signaturesRestored++;
        }
      } catch {
        // Skip failed signatures
      }
    }

    const totalFonts = (backup.assets?.fonts || []).length;
    return {
      templatesCreated: createdTemplates.length,
      assetsRestored: { images: restoredImages, fonts: restoredFonts },
      signaturesRestored,
      templates: createdTemplates,
      fontValidation: totalFonts > 0 ? {
        total: totalFonts,
        accepted: acceptedFonts,
        rejected: rejectedFonts,
        errors: fontValidationErrors,
      } : undefined,
    };
  }

  // ─── Import from ZIP ────────────────────────────────────────────────

  /**
   * Import a backup from a ZIP archive.
   * Parses the ZIP, extracts templates/assets/fonts/signatures,
   * and delegates to the existing importBackup method.
   */
  async importBackupFromZip(
    zipBuffer: Buffer,
    targetOrgId: string,
    importedBy: string,
  ): Promise<{
    templatesCreated: number;
    assetsRestored: { images: number; fonts: number };
    signaturesRestored: number;
    templates: Array<{ id: string; name: string; type: string; status: string }>;
    fontValidation?: { total: number; accepted: number; rejected: number; errors: string[] };
  }> {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    // 1. Read manifest
    const manifestEntry = zip.getEntry('manifest.json');
    let manifest: any = {};
    if (manifestEntry) {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    }

    // 2. Read template index and individual template files
    const templateFiles: Array<{ id: string; name: string; type: string; status: string; version: number; schema: unknown; createdAt: Date; updatedAt: Date }> = [];
    const tplIndexEntry = zip.getEntry('templates/index.json');
    if (tplIndexEntry) {
      const tplIndex = JSON.parse(tplIndexEntry.getData().toString('utf8'));
      for (const tplRef of tplIndex) {
        const tplEntry = zip.getEntry(tplRef.file);
        if (tplEntry) {
          const tplData = JSON.parse(tplEntry.getData().toString('utf8'));
          templateFiles.push({
            id: tplData.id,
            name: tplData.name,
            type: tplData.type,
            status: tplData.status,
            version: tplData.version || 1,
            schema: tplData.schema,
            createdAt: tplData.createdAt ? new Date(tplData.createdAt) : new Date(),
            updatedAt: tplData.updatedAt ? new Date(tplData.updatedAt) : new Date(),
          });
        }
      }
    } else {
      // Fallback: scan for template JSON files
      for (const entry of entries) {
        if (entry.entryName.startsWith('templates/') && entry.entryName.endsWith('.json') && entry.entryName !== 'templates/index.json') {
          try {
            const tplData = JSON.parse(entry.getData().toString('utf8'));
            templateFiles.push({
              id: tplData.id,
              name: tplData.name,
              type: tplData.type,
              status: tplData.status,
              version: tplData.version || 1,
              schema: tplData.schema,
              createdAt: tplData.createdAt ? new Date(tplData.createdAt) : new Date(),
              updatedAt: tplData.updatedAt ? new Date(tplData.updatedAt) : new Date(),
            });
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // 3. Read asset binary files and convert to base64 format
    const MIME_MAP: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
      '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    };

    const images: Array<{ path: string; data: string; mimeType: string }> = [];
    const fonts: Array<{ path: string; data: string; mimeType: string }> = [];

    for (const entry of entries) {
      if (entry.entryName.startsWith('assets/images/') && !entry.isDirectory && !entry.entryName.endsWith('index.json')) {
        const buffer = entry.getData();
        const ext = '.' + (entry.entryName.split('.').pop()?.toLowerCase() || '');
        images.push({
          path: `${targetOrgId}/assets/${entry.entryName.split('/').pop()}`,
          data: buffer.toString('base64'),
          mimeType: MIME_MAP[ext] || 'application/octet-stream',
        });
      }
      if (entry.entryName.startsWith('assets/fonts/') && !entry.isDirectory && !entry.entryName.endsWith('index.json')) {
        const buffer = entry.getData();
        const ext = '.' + (entry.entryName.split('.').pop()?.toLowerCase() || '');
        fonts.push({
          path: `${targetOrgId}/fonts/${entry.entryName.split('/').pop()}`,
          data: buffer.toString('base64'),
          mimeType: MIME_MAP[ext] || 'application/octet-stream',
        });
      }
    }

    // 4. Read signatures
    const signaturesData: Array<{ id: string; userId: string; filePath: string; capturedAt: Date; data: string }> = [];
    const sigIndexEntry = zip.getEntry('signatures/index.json');
    if (sigIndexEntry) {
      const sigIndex = JSON.parse(sigIndexEntry.getData().toString('utf8'));
      for (const sigRef of sigIndex) {
        const sigEntry = zip.getEntry(sigRef.file);
        if (sigEntry) {
          signaturesData.push({
            id: sigRef.id,
            userId: sigRef.userId,
            filePath: sigRef.file,
            capturedAt: sigRef.capturedAt ? new Date(sigRef.capturedAt) : new Date(),
            data: sigEntry.getData().toString('base64'),
          });
        }
      }
    }

    // 5. Delegate to existing importBackup
    const backupPackage = {
      version: manifest.version || 1,
      exportedAt: manifest.exportedAt || new Date().toISOString(),
      orgId: manifest.orgId || '',
      templates: templateFiles,
      assets: { images, fonts },
      signatures: signaturesData,
      localeConfig: manifest.localeConfig || null,
    };

    return this.importBackup(backupPackage, targetOrgId, importedBy);
  }

  // ─── Template Locking ────────────────────────────────────────────────

  /**
   * Acquire a pessimistic edit lock on a template.
   * Lock duration: 30 minutes from acquisition.
   * If already locked by same user, refreshes (heartbeat).
   * If locked by another user and not expired, returns error.
   */
  async acquireLock(id: string, userId: string, orgId?: string): Promise<LockResult | { error: string; lockedBy: string; lockedAt: Date; expiresAt: Date; statusCode?: number }> {
    const template = await this.findById(id, orgId);
    if (!template) {
      return { error: 'Template not found', lockedBy: '', lockedAt: new Date(), expiresAt: new Date(), statusCode: 404 };
    }

    // Cannot lock archived templates
    if (template.status === 'archived') {
      return { error: 'Cannot lock an archived template. Archived templates are read-only.', lockedBy: '', lockedAt: new Date(), expiresAt: new Date(), statusCode: 422 };
    }

    // Cannot lock published templates (they should be forked or reverted to draft first)
    if (template.status === 'published') {
      return { error: 'Cannot lock a published template. Create a new draft version to edit.', lockedBy: '', lockedAt: new Date(), expiresAt: new Date(), statusCode: 422 };
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
   * Heartbeat: refresh a lock's expiry without re-acquiring.
   * Only the current lock holder can send a heartbeat.
   * This resets lockedAt to now, extending the lock by another LOCK_DURATION_MS.
   */
  async heartbeatLock(id: string, userId: string, orgId?: string): Promise<{ refreshed: boolean; lockedAt?: Date; expiresAt?: Date; error?: string; statusCode?: number }> {
    const template = await this.findById(id, orgId);
    if (!template) {
      return { refreshed: false, error: 'Template not found', statusCode: 404 };
    }

    if (!template.lockedBy || !template.lockedAt) {
      return { refreshed: false, error: 'Template is not locked', statusCode: 409 };
    }

    // Check if lock has expired
    const now = new Date();
    const lockExpiry = new Date(template.lockedAt.getTime() + LOCK_DURATION_MS);
    if (now >= lockExpiry) {
      return { refreshed: false, error: 'Lock has expired', statusCode: 409 };
    }

    // Only the lock holder can heartbeat
    if (template.lockedBy !== userId) {
      return { refreshed: false, error: 'Lock is held by another user', statusCode: 403 };
    }

    // Refresh the lock timestamp
    await this.db
      .update(templates)
      .set({
        lockedAt: now,
        updatedAt: now,
      })
      .where(eq(templates.id, id));

    const expiresAt = new Date(now.getTime() + LOCK_DURATION_MS);

    return {
      refreshed: true,
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

    const wasForceRelease = force && template.lockedBy !== userId;
    const previousLockHolder = template.lockedBy;

    await this.db
      .update(templates)
      .set({
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id));

    // Audit log for force-release
    if (wasForceRelease && this.auditService) {
      await this.auditService.log({
        orgId: orgId || template.orgId || '',
        entityType: 'template',
        entityId: id,
        action: 'lock_force_released',
        userId,
        metadata: {
          lockHolder: previousLockHolder,
          releasedBy: userId,
          templateName: template.name,
        },
      });
    }

    return { released: true, forceReleased: wasForceRelease || false };
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
