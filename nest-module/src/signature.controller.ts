/**
 * SignatureController - REST endpoints for user signature management
 *
 * Endpoints:
 * - POST   /api/pdfme/signatures          (upload signature PNG)
 * - GET    /api/pdfme/signatures/me        (get current user's signature)
 * - GET    /api/pdfme/signatures/me/file   (download signature PNG file)
 * - DELETE /api/pdfme/signatures/me        (revoke current signature)
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Inject,
  HttpException,
  HttpStatus,
  HttpCode,
  Res,
} from '@nestjs/common';
import { SignatureService } from './signature.service';
import { AuditService } from './audit.service';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { Response, Request } from 'express';
import type { JwtPayload } from './auth.guard';
import { Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api/pdfme/signatures')
export class SignatureController {
  constructor(
    private readonly signatureService: SignatureService,
    @Inject('FILE_STORAGE') private readonly storage: any,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Body() body: { data: string; orgId?: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user as JwtPayload;
    const orgId = user?.orgId || body.orgId || 'default';
    const userId = user?.sub || 'unknown';

    if (!body.data) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Signature data is required. Provide base64-encoded PNG in "data" field.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check for empty/whitespace-only data
    if (typeof body.data === 'string' && !body.data.trim()) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Signature data is empty' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Detect format from data URL prefix or raw base64
    let imageBuffer: Buffer;
    let detectedFormat: 'png' | 'svg' | 'unknown' = 'unknown';

    try {
      let base64Data = body.data;

      // Strip data URL prefix and detect format
      if (base64Data.startsWith('data:image/png;base64,')) {
        base64Data = base64Data.slice('data:image/png;base64,'.length);
        detectedFormat = 'png';
      } else if (base64Data.startsWith('data:image/svg+xml;base64,')) {
        base64Data = base64Data.slice('data:image/svg+xml;base64,'.length);
        detectedFormat = 'svg';
      } else if (base64Data.startsWith('data:')) {
        // Has a data URL prefix but not an accepted image type
        const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';
        throw new HttpException(
          {
            statusCode: 400,
            error: 'Bad Request',
            message: `Unsupported image format: ${mimeType}. Accepted formats: image/png, image/svg+xml.`,
            details: [{ field: 'data', reason: `MIME type "${mimeType}" is not supported. Upload a PNG or SVG image.` }],
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      imageBuffer = Buffer.from(base64Data, 'base64');
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Invalid base64 data' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (imageBuffer.length === 0) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Signature data is empty after decoding' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate image format by magic bytes if not already detected from data URL
    if (detectedFormat === 'unknown') {
      // Check for PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      if (imageBuffer.length >= 8 && imageBuffer.subarray(0, 8).equals(pngMagic)) {
        detectedFormat = 'png';
      }
      // Check for SVG (starts with XML declaration or <svg tag)
      else {
        const textStart = imageBuffer.subarray(0, Math.min(imageBuffer.length, 256)).toString('utf8').trim();
        if (textStart.startsWith('<?xml') || textStart.startsWith('<svg') || textStart.includes('<svg')) {
          detectedFormat = 'svg';
        }
      }
    }

    if (detectedFormat === 'unknown') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid image data. Signature must be a PNG or SVG image.',
          details: [{ field: 'data', reason: 'Could not detect PNG or SVG format from the provided data. Ensure the data is a valid PNG or SVG image.' }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.signatureService.upload(orgId, userId, imageBuffer);

    return {
      id: result.id,
      userId: result.userId,
      orgId: result.orgId,
      filePath: result.filePath,
      capturedAt: result.capturedAt,
    };
  }

  @Get('me')
  async getMySignature(
    @Req() req: Request,
  ) {
    const user = (req as any).user as JwtPayload;
    const orgId = user?.orgId || 'default';
    const userId = user?.sub || 'unknown';

    const signature = await this.signatureService.getMySignature(orgId, userId);

    if (!signature) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: 'No active signature found for this user' },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      id: signature.id,
      userId: signature.userId,
      orgId: signature.orgId,
      filePath: signature.filePath,
      capturedAt: signature.capturedAt,
      revokedAt: signature.revokedAt,
    };
  }

  @Get('me/file')
  async downloadSignature(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = (req as any).user as JwtPayload;
    const orgId = user?.orgId || 'default';
    const userId = user?.sub || 'unknown';

    const signature = await this.signatureService.getMySignature(orgId, userId);

    if (!signature) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: 'No active signature found for this user' },
        HttpStatus.NOT_FOUND,
      );
    }

    const buffer = await this.signatureService.readSignatureFile(signature.filePath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Delete('me')
  async revokeSignature(
    @Req() req: Request,
  ) {
    const user = (req as any).user as JwtPayload;
    const orgId = user?.orgId || 'default';
    const userId = user?.sub || 'unknown';

    // Get signature info before revoking for audit trail
    const signature = await this.signatureService.getMySignature(orgId, userId);

    const revoked = await this.signatureService.revoke(orgId, userId);

    if (!revoked) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: 'No active signature found to revoke' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Audit log for signature revocation
    if (this.auditService && signature) {
      await this.auditService.log({
        orgId,
        entityType: 'signature',
        entityId: signature.id,
        action: 'revoked',
        userId,
        metadata: {
          signatureId: signature.id,
          filePath: signature.filePath,
          capturedAt: signature.capturedAt?.toISOString?.() || String(signature.capturedAt),
        },
      });
    }

    return { message: 'Signature revoked successfully' };
  }

  /**
   * GET /api/pdfme/signatures/storage-info
   * Returns information about signature storage permissions for the authenticated org.
   */
  @Get('storage-info')
  async getStorageInfo(@Req() req: Request) {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;

    // Get the storage root
    const rootDir = this.storage.getRootDir?.() || '';
    const sigDir = path.join(rootDir, orgId, 'signatures');

    let directoryPermissions: string | null = null;
    let directoryExists = false;
    let filePermissions: string | null = null;
    let fileCount = 0;

    try {
      if (fs.existsSync(sigDir)) {
        directoryExists = true;
        const stats = fs.statSync(sigDir);
        directoryPermissions = '0' + (stats.mode & 0o777).toString(8);

        // Check files in directory
        const files = fs.readdirSync(sigDir);
        fileCount = files.length;
        if (files.length > 0) {
          const fileStat = fs.statSync(path.join(sigDir, files[0]));
          filePermissions = '0' + (fileStat.mode & 0o777).toString(8);
        }
      }
    } catch {
      // Directory might not exist yet
    }

    return {
      orgId,
      signatureDirectory: sigDir,
      directoryExists,
      directoryPermissions,
      filePermissions,
      fileCount,
      restricted: directoryPermissions === '0700',
      publiclyAccessible: false, // Files are only served via authenticated API endpoint
    };
  }
}
