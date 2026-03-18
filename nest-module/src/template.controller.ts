/**
 * TemplateController - REST endpoints for template management
 *
 * Endpoints:
 * - GET    /api/pdfme/templates              (list)
 * - POST   /api/pdfme/templates              (create)
 * - GET    /api/pdfme/templates/:id          (get by ID)
 * - PUT    /api/pdfme/templates/:id          (update)
 * - PUT    /api/pdfme/templates/:id/draft   (save draft changes)
 * - POST   /api/pdfme/templates/:id/preview  (generate preview PDF)
 * - DELETE /api/pdfme/templates/:id          (soft delete / archive)
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { TemplateService, CreateTemplateDto, UpdateTemplateDto, SaveDraftDto, TemplateExportPackage } from './template.service';
import { RenderService } from './render.service';

/**
 * Extract orgId and userId from JWT token (simple decode for now).
 * In production, this would be a proper Guard with full JWT verification.
 */
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

@Controller('api/pdfme/templates')
export class TemplateController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly renderService: RenderService,
  ) {}

  /**
   * Validate that a schema field is valid JSON and has proper structure.
   * Returns null if valid, or throws appropriate HTTP exception.
   */
  private validateSchemaField(schema: unknown): void {
    // Check 1: schema must be a JSON object (not string, array, number, etc.)
    if (schema === undefined) {
      return; // schema is optional on updates
    }

    if (schema === null) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'schema cannot be null',
          details: [{ field: 'schema', reason: 'schema must be a valid JSON object, not null' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof schema === 'string') {
      // Someone sent schema as a string instead of a JSON object
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'schema must be a valid JSON object, not a string',
          details: [{ field: 'schema', reason: 'Expected a JSON object but received a string. Ensure schema is sent as a JSON object, not a JSON-encoded string.' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof schema !== 'object' || Array.isArray(schema)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'schema must be a valid JSON object',
          details: [{ field: 'schema', reason: `Expected a JSON object but received ${Array.isArray(schema) ? 'an array' : typeof schema}` }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check 2: structural validation - schema should have proper structure
    const schemaObj = schema as Record<string, unknown>;
    const structuralErrors: Array<{ field: string; reason: string }> = [];

    // Check for pages or schemas array (required structure)
    const pages = schemaObj.pages || schemaObj.schemas;
    if (pages !== undefined) {
      if (!Array.isArray(pages)) {
        structuralErrors.push({
          field: 'schema.pages',
          reason: 'pages must be an array',
        });
      } else {
        // Validate each page is an object
        pages.forEach((page: unknown, idx: number) => {
          if (page !== null && page !== undefined && typeof page !== 'object') {
            structuralErrors.push({
              field: `schema.pages[${idx}]`,
              reason: 'Each page must be an object',
            });
          }
        });
      }
    }

    // Check for invalid top-level types that indicate wrong structure
    if (typeof schemaObj.basePdf !== 'undefined' && typeof schemaObj.basePdf !== 'string' && typeof schemaObj.basePdf !== 'object') {
      structuralErrors.push({
        field: 'schema.basePdf',
        reason: 'basePdf must be a string (URL/path) or object',
      });
    }

    if (structuralErrors.length > 0) {
      throw new HttpException(
        {
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'Template schema has structural errors',
          details: structuralErrors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  @Get()
  async list(
    @Query('orgId') queryOrgId?: string,
    @Query('limit') queryLimit?: string,
    @Query('cursor') queryCursor?: string,
    @Query('type') queryType?: string,
    @Query('status') queryStatus?: string,
    @Query('sort') querySort?: string,
    @Query('order') queryOrder?: string,
    @Query('search') querySearch?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Prefer orgId from JWT, fallback to query param for dev convenience
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId;

    const limit = queryLimit ? Math.min(Math.max(parseInt(queryLimit, 10) || 100, 1), 1000) : 100;

    return this.templateService.findAll(orgId, {
      limit,
      cursor: queryCursor,
      type: queryType,
      status: queryStatus,
      sort: querySort as 'createdAt' | 'name' | 'updatedAt' | 'type' | undefined,
      order: queryOrder as 'asc' | 'desc' | undefined,
      search: querySearch ? querySearch.replace(/\0/g, '') : undefined,
    });
  }

  @Get('types')
  async getDistinctTypes(
    @Query('orgId') queryOrgId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId;

    const types = await this.templateService.getDistinctTypes(orgId);
    return { types };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateTemplateDto,
    @Headers('authorization') authHeader?: string,
  ) {
    // Valid template type enum values
    const VALID_TEMPLATE_TYPES = [
      'invoice', 'statement', 'purchase_order', 'delivery_note', 'credit_note',
      'report_aged_debtors', 'report_stock_on_hand', 'report_sales_summary',
      'report', 'custom',
    ];

    // Validate required fields with detailed error envelope
    const missingFields: string[] = [];
    if (!body.name || (typeof body.name === 'string' && !body.name.trim())) missingFields.push('name');
    if (!body.type || (typeof body.type === 'string' && !body.type.trim())) missingFields.push('type');
    if (!body.schema) missingFields.push('schema');
    if (missingFields.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'name, type, and schema are required',
          details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate type is a valid enum value
    if (!VALID_TEMPLATE_TYPES.includes(body.type)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid template type: "${body.type}". Must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`,
          details: [{ field: 'type', reason: `must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}` }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate schema is an object
    if (typeof body.schema !== 'object' || Array.isArray(body.schema)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'schema must be a JSON object',
          details: [{ field: 'schema', reason: 'must be a JSON object, not an array or primitive' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const jwt = decodeJwt(authHeader);
    const orgId = body.orgId ?? jwt?.orgId ?? null;
    const createdBy = body.createdBy || jwt?.sub || 'system';

    const result = await this.templateService.create({
      ...body,
      orgId,
      createdBy,
    });

    // Return id and status as per API contract
    return {
      id: result.id,
      status: result.status,
      name: result.name,
      type: result.type,
      version: result.version,
      createdAt: result.createdAt,
    };
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  async importTemplate(
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    if (!jwt) {
      throw new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Step 1: Basic type check - body must be a non-null object (not array, string, number, etc.)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Request body must be a valid JSON object',
          details: [{ field: 'body', reason: 'Expected a JSON object representing an export package' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 2: Check required top-level fields exist
    const missingTopLevel: Array<{ field: string; reason: string }> = [];
    if (body.version === undefined || body.version === null) {
      missingTopLevel.push({ field: 'version', reason: 'version is required (must be 1)' });
    }
    if (!body.template) {
      missingTopLevel.push({ field: 'template', reason: 'template object is required' });
    }

    if (missingTopLevel.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid export package format',
          details: missingTopLevel,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Step 3: Structural validation - valid JSON but wrong structure → 422
    const structuralErrors: Array<{ field: string; reason: string }> = [];

    // Validate version
    if (body.version !== 1) {
      structuralErrors.push({ field: 'version', reason: `Unsupported package version: ${body.version}. Only version 1 is supported.` });
    }

    // Validate template is an object
    if (typeof body.template !== 'object' || Array.isArray(body.template)) {
      structuralErrors.push({ field: 'template', reason: 'template must be an object' });
    } else {
      // Validate required template fields
      if (!body.template.name || (typeof body.template.name === 'string' && !body.template.name.trim())) {
        structuralErrors.push({ field: 'template.name', reason: 'template.name is required and must be a non-empty string' });
      }
      if (!body.template.type || (typeof body.template.type === 'string' && !body.template.type.trim())) {
        structuralErrors.push({ field: 'template.type', reason: 'template.type is required and must be a non-empty string' });
      }
      if (!body.template.schema) {
        structuralErrors.push({ field: 'template.schema', reason: 'template.schema is required' });
      } else if (typeof body.template.schema !== 'object' || Array.isArray(body.template.schema)) {
        structuralErrors.push({ field: 'template.schema', reason: 'template.schema must be a JSON object' });
      }
    }

    // Validate assets structure if present
    if (body.assets !== undefined) {
      if (typeof body.assets !== 'object' || Array.isArray(body.assets)) {
        structuralErrors.push({ field: 'assets', reason: 'assets must be an object with images and fonts arrays' });
      } else {
        if (body.assets.images !== undefined && !Array.isArray(body.assets.images)) {
          structuralErrors.push({ field: 'assets.images', reason: 'assets.images must be an array' });
        }
        if (body.assets.fonts !== undefined && !Array.isArray(body.assets.fonts)) {
          structuralErrors.push({ field: 'assets.fonts', reason: 'assets.fonts must be an array' });
        }
      }
    }

    if (structuralErrors.length > 0) {
      throw new HttpException(
        {
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'Export package has structural errors',
          details: structuralErrors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Ensure assets has default structure
    const validatedBody: TemplateExportPackage = {
      version: body.version,
      exportedAt: body.exportedAt || new Date().toISOString(),
      template: body.template,
      assets: {
        images: body.assets?.images || [],
        fonts: body.assets?.fonts || [],
      },
    };

    const result = await this.templateService.importTemplate(validatedBody, jwt.orgId, jwt.sub);
    return result;
  }

  @Get('system')
  async listSystem() {
    const data = await this.templateService.findSystemTemplates();
    return { data, total: data.length };
  }

  @Get('system/:id')
  async getSystemById(@Param('id') id: string) {
    const result = await this.templateService.findById(id);
    if (!result || result.orgId !== null) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `System template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  @Get(':id/versions')
  async getVersionHistory(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const versions = await this.templateService.getVersionHistory(id, orgId);
    return { data: versions, total: versions.length };
  }

  @Get(':id/versions/:version')
  async getVersionByNumber(
    @Param('id') id: string,
    @Param('version') version: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const versionNumber = parseInt(version, 10);
    if (isNaN(versionNumber) || versionNumber < 1) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Version must be a positive integer' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.templateService.getVersionByNumber(id, versionNumber, orgId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Version ${versionNumber} of template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  @Get(':id/export')
  async exportTemplate(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const pkg = await this.templateService.exportTemplate(id, orgId);
    if (!pkg) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return pkg;
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  async acquireLock(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    if (!jwt) {
      throw new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const result = await this.templateService.acquireLock(id, jwt.sub, jwt.orgId);
    if ('error' in result) {
      const errResult = result as { error: string; lockedBy: string; lockedAt: Date; expiresAt: Date; statusCode?: number };
      const statusCode = errResult.statusCode || 409;
      const errorLabel = statusCode === 404 ? 'Not Found' : statusCode === 422 ? 'Unprocessable Entity' : 'Conflict';
      throw new HttpException(
        {
          statusCode,
          error: errorLabel,
          message: errResult.error,
          lockedBy: errResult.lockedBy,
          lockedAt: errResult.lockedAt,
          expiresAt: errResult.expiresAt,
        },
        statusCode,
      );
    }
    return result;
  }

  @Delete(':id/lock')
  async releaseLock(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    if (!jwt) {
      throw new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const result = await this.templateService.releaseLock(id, jwt.sub, force === 'true', jwt.orgId);
    if (!result.released) {
      throw new HttpException(
        { statusCode: 403, error: 'Forbidden', message: result.error },
        HttpStatus.FORBIDDEN,
      );
    }
    return result;
  }

  @Get(':id/lock')
  async getLockStatus(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    return this.templateService.getLockStatus(id, orgId);
  }

  @Get(':id')
  async getById(
    @Param('id') id: string,
    @Query('orgId') queryOrgId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId;

    const result = await this.templateService.findById(id, orgId);
    if (!result || result.status === 'archived') {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  @Put(':id/draft')
  async saveDraft(
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;
    const userId = jwt?.sub || 'unknown';

    // Validate saveMode if provided (must be inPlace or newVersion)
    const VALID_SAVE_MODES = ['inPlace', 'newVersion'];
    if (body.saveMode !== undefined && body.saveMode !== null && body.saveMode !== '') {
      if (!VALID_SAVE_MODES.includes(body.saveMode)) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'Bad Request',
            message: `Invalid saveMode: "${body.saveMode}". Must be one of: ${VALID_SAVE_MODES.join(', ')}`,
            details: [{ field: 'saveMode', reason: `must be one of: ${VALID_SAVE_MODES.join(', ')}` }],
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Check if template exists and is not archived
    const existing = await this.templateService.findById(id, orgId);
    if (!existing || existing.status === 'archived') {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    // Validate schema if provided
    if (body.schema !== undefined) {
      this.validateSchemaField(body.schema);
    }

    // Check for edit lock conflict
    const lockConflict = await this.templateService.checkLockConflict(id, userId, orgId);
    if (lockConflict) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'Conflict',
          message: `Template is locked by user ${lockConflict.lockedBy}`,
          lockedBy: lockConflict.lockedBy,
          lockedAt: lockConflict.lockedAt,
          expiresAt: lockConflict.expiresAt,
        },
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.templateService.saveDraft(id, body, orgId, userId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  async validate(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const template = await this.templateService.findById(id, orgId);
    if (!template) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const errors = this.templateService.validateTemplateForPublish({
      name: template.name,
      type: template.type,
      schema: template.schema as Record<string, unknown>,
    });

    return {
      valid: errors.length === 0,
      errors,
      templateId: id,
      templateName: template.name,
    };
  }

  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const result = await this.templateService.publish(id, orgId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if ('validationErrors' in result) {
      throw new HttpException(
        {
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'Template validation failed',
          details: (result as any).validationErrors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if ('error' in result) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: result.error },
        HttpStatus.BAD_REQUEST,
      );
    }
    return result;
  }

  @Post(':id/preview')
  async generatePreview(
    @Param('id') id: string,
    @Body() body: { sampleRowCount?: number; channel?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    if (!jwt?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Fetch template (any status - previews work on drafts too)
    const template = await this.templateService.findById(id, jwt.orgId);
    if (!template) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const sampleRowCount = body.sampleRowCount || 5;
    if (![5, 15, 30].includes(sampleRowCount)) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'sampleRowCount must be 5, 15, or 30' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const channel = body.channel || 'email';

    try {
      const result = await this.renderService.generatePreview(
        template,
        jwt.orgId,
        jwt.sub,
        channel,
        sampleRowCount,
      );
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        { statusCode: 500, error: 'Internal Server Error', message: `Preview generation failed: ${message}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;
    const userId = jwt?.sub || 'unknown';

    // Validate schema if provided
    if (body.schema !== undefined) {
      this.validateSchemaField(body.schema);
    }

    // Check for edit lock conflict
    const lockConflict = await this.templateService.checkLockConflict(id, userId, orgId);
    if (lockConflict) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'Conflict',
          message: `Template is locked by user ${lockConflict.lockedBy}`,
          lockedBy: lockConflict.lockedBy,
          lockedAt: lockConflict.lockedAt,
          expiresAt: lockConflict.expiresAt,
        },
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.templateService.update(id, body, orgId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

    const result = await this.templateService.softDelete(id, orgId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return { id: result.id, status: result.status };
  }
}
