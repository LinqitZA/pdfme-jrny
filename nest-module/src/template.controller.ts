/**
 * TemplateController - REST endpoints for template management
 *
 * Endpoints:
 * - GET    /api/pdfme/templates              (list)
 * - POST   /api/pdfme/templates              (create)
 * - GET    /api/pdfme/templates/:id          (get by ID)
 * - PUT    /api/pdfme/templates/:id          (update)
 * - PUT    /api/pdfme/templates/:id/draft   (save draft changes)
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
import { TemplateService, CreateTemplateDto, UpdateTemplateDto, SaveDraftDto } from './template.service';

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
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  async list(
    @Query('orgId') queryOrgId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Prefer orgId from JWT, fallback to query param for dev convenience
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId;

    const data = await this.templateService.findAll(orgId);
    return { data, pagination: { total: data.length, limit: 100, hasMore: false } };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateTemplateDto,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!body.name || !body.type || !body.schema) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'name, type, and schema are required' },
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

  @Get(':id')
  async getById(
    @Param('id') id: string,
    @Query('orgId') queryOrgId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId;

    const result = await this.templateService.findById(id, orgId);
    if (!result) {
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
    if ('error' in result) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: result.error },
        HttpStatus.BAD_REQUEST,
      );
    }
    return result;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId;

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
