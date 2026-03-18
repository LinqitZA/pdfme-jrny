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

@Controller('api/pdfme/assets')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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

    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    if (!this.assetService.isAllowedExtension(file.originalname)) {
      const ext = path.extname(file.originalname).toLowerCase();
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: `Unsupported file type: ${ext}. Allowed: .png, .jpg, .jpeg, .svg, .webp, .gif, .ttf, .otf, .woff2` },
        HttpStatus.BAD_REQUEST,
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
    @Headers('authorization') authHeader?: string,
  ) {
    const jwt = decodeJwt(authHeader);
    const orgId = jwt?.orgId || queryOrgId || 'default';

    const files = await this.assetService.listAssets(orgId);
    return {
      data: files,
      pagination: { total: files.length, limit: 100, hasMore: false },
    };
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

    await this.assetService.deleteAsset(match);
    return { id: assetId, deleted: true };
  }
}
