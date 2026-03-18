/**
 * AssetController - REST endpoints for asset/file management
 *
 * Endpoints:
 * - POST   /api/pdfme/assets/upload    (upload image or font)
 * - GET    /api/pdfme/assets           (list org assets)
 * - GET    /api/pdfme/assets/:assetId  (download asset)
 * - DELETE /api/pdfme/assets/:assetId  (delete asset)
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetService } from './asset.service';
import { TemplateService } from './template.service';
import { Response } from 'express';
import * as path from 'path';

/**
 * Extract orgId and userId from JWT token (simple decode for now).
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

/** Maximum asset file size: 10MB */
const MAX_ASSET_SIZE = 10 * 1024 * 1024;

@Controller('api/pdfme/assets')
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly templateService: TemplateService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_ASSET_SIZE },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('orgId') queryOrgId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'No file provided. Use multipart/form-data with field name "file".' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check file size - return 413 for oversized uploads
    if (file.size > MAX_ASSET_SIZE) {
      throw new HttpException(
        {
          statusCode: 413,
          error: 'Payload Too Large',
          message: `File exceeds maximum size of 10MB (${(file.size / 1024 / 1024).toFixed(1)}MB provided)`,
          maxSize: '10MB',
          actualSize: `${(file.size / 1024 / 1024).toFixed(1)}MB`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    if (!this.assetService.isAllowedExtension(file.originalname)) {
      const ext = path.extname(file.originalname).toLowerCase();
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: `Unsupported file type: ${ext}. Allowed: .png, .jpg, .jpeg, .svg, .webp, .gif, .ttf, .otf, .woff2` },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check asset storage quota before uploading
    const quotaCheck = await this.assetService.checkAssetStorageQuota(orgId, file.size);
    if (quotaCheck && quotaCheck.exceeded) {
      throw new HttpException(
        {
          statusCode: 413,
          error: 'Payload Too Large',
          message: `Asset storage quota exceeded. Current usage: ${quotaCheck.currentUsageBytes} bytes, quota: ${quotaCheck.quotaBytes} bytes, new asset: ${quotaCheck.newAssetSizeBytes} bytes`,
          quotaExceeded: true,
          currentUsageBytes: quotaCheck.currentUsageBytes,
          quotaBytes: quotaCheck.quotaBytes,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    try {
      const result = await this.assetService.upload(
        orgId,
        file.originalname,
        file.buffer,
        file.mimetype,
      );
      return result;
    } catch (err: any) {
      throw new HttpException(
        { statusCode: 500, error: 'Internal Server Error', message: err.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async list(
    @Query('orgId') queryOrgId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;

    const result = await this.assetService.listAssetsWithMetadata(orgId, {
      cursor: cursor || undefined,
      limit,
    });

    return result;
  }

  @Get(':assetId')
  async download(
    @Param('assetId') assetId: string,
    @Query('orgId') queryOrgId?: string,
    @Query('category') category?: string,
    @Headers('authorization') authHeader?: string,
    @Res() res?: Response,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    // Try assets first, then fonts
    const directories = category ? [category === 'font' ? 'fonts' : 'assets'] : ['assets', 'fonts'];
    let storagePath: string | null = null;

    for (const dir of directories) {
      const files = await this.assetService.listAssets(orgId);
      const match = files.find(f => f.includes(assetId));
      if (match) {
        storagePath = match;
        break;
      }
    }

    if (!storagePath) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Asset ${assetId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const buffer = await this.assetService.readAsset(storagePath);
    const ext = path.extname(storagePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
      '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    };

    res!.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res!.setHeader('Content-Length', buffer.length);
    res!.send(buffer);
  }

  @Delete(':assetId')
  async delete(
    @Param('assetId') assetId: string,
    @Query('orgId') queryOrgId?: string,
    @Query('confirm') confirm?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    const files = await this.assetService.listAssets(orgId);
    const match = files.find(f => f.includes(assetId));

    if (!match) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Asset ${assetId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    // Check if any templates reference this asset
    const referencingTemplates = await this.findTemplatesReferencingAsset(orgId, assetId, match);

    if (referencingTemplates.length > 0 && confirm !== 'true') {
      // Return warning with 409 Conflict - asset is in use
      return {
        statusCode: 409,
        warning: true,
        message: `Asset is referenced by ${referencingTemplates.length} template(s). Add ?confirm=true to delete anyway.`,
        referencingTemplates: referencingTemplates.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          status: t.status,
        })),
        assetId,
        deletable: true,
      };
    }

    await this.assetService.deleteAsset(match);
    return {
      id: assetId,
      deleted: true,
      ...(referencingTemplates.length > 0 ? {
        warning: `Asset was referenced by ${referencingTemplates.length} template(s). Those templates may show placeholder images.`,
        affectedTemplates: referencingTemplates.map(t => ({ id: t.id, name: t.name })),
      } : {}),
    };
  }

  /**
   * Find templates that reference a given asset by scanning template schemas.
   * Checks for assetId, assetPath, src, imageSrc, logoPath references.
   */
  private async findTemplatesReferencingAsset(
    orgId: string,
    assetId: string,
    storagePath: string,
  ): Promise<Array<{ id: string; name: string; type: string; status: string }>> {
    const result = await this.templateService.findAll(orgId, { limit: 1000 });
    const templates = result.data;
    const matching: Array<{ id: string; name: string; type: string; status: string }> = [];

    for (const template of templates) {
      if (this.schemaReferencesAsset(template.schema, assetId, storagePath)) {
        matching.push({
          id: template.id,
          name: template.name,
          type: template.type,
          status: template.status,
        });
      }
    }

    return matching;
  }

  /**
   * Recursively check if a template schema references a given asset ID or path.
   */
  private schemaReferencesAsset(
    schema: unknown,
    assetId: string,
    storagePath: string,
  ): boolean {
    if (!schema || typeof schema !== 'object') return false;

    if (Array.isArray(schema)) {
      return schema.some(item => this.schemaReferencesAsset(item, assetId, storagePath));
    }

    const record = schema as Record<string, unknown>;
    // Check known asset-referencing keys
    for (const key of ['assetPath', 'assetId', 'src', 'imageSrc', 'logoPath', 'content']) {
      const val = record[key];
      if (typeof val === 'string') {
        if (val.includes(assetId) || val === storagePath) {
          return true;
        }
      }
    }

    // Recurse into all object values
    for (const val of Object.values(record)) {
      if (typeof val === 'object' && val !== null) {
        if (this.schemaReferencesAsset(val, assetId, storagePath)) {
          return true;
        }
      }
    }

    return false;
  }
}
