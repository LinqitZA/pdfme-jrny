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

  @Get()
  async list(
    @Query('orgId') queryOrgId?: string,
    @Query('limit') queryLimit?: string,
    @Query('cursor') queryCursor?: string,
    @Query('type') queryType?: string,
    @Query('status') queryStatus?: string,
    @Query('sort') querySort?: string,
    @Query('order') queryOrder?: string,
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
    // Validate required fields with detailed error envelope
    const missingFields: string[] = [];
    if (!body.name) missingFields.push('name');
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
      type: body.type || 'custom',
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
    @Body() body: TemplateExportPackage,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    if (!jwt) {
      throw new HttpException(
        { statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!body || !body.template || !body.version) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Invalid export package format' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate package structure
    if (!body.template?.name || !body.template?.type || !body.template?.schema) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Export package must contain template with name, type, and schema' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.templateService.importTemplate(body, jwt.orgId, jwt.sub);
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
      throw new HttpException(
        {
          statusCode: 409,
          error: 'Conflict',
          message: result.error,
          lockedBy: result.lockedBy,
          lockedAt: result.lockedAt,
          expiresAt: result.expiresAt,
        },
        HttpStatus.CONFLICT,
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

    // Check if template exists and is not archived
    const existing = await this.templateService.findById(id, orgId);
    if (!existing || existing.status === 'archived') {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
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

    const result = await this.templateService.saveDraft(id, body, orgId);
    if (!result) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Template ${id} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
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
