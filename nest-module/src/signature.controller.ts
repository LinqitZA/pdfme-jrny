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
  HttpException,
  HttpStatus,
  HttpCode,
  Res,
} from '@nestjs/common';
import { SignatureService } from './signature.service';
import { Response, Request } from 'express';
import type { JwtPayload } from './auth.guard';

@Controller('api/pdfme/signatures')
export class SignatureController {
  constructor(private readonly signatureService: SignatureService) {}

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

    const revoked = await this.signatureService.revoke(orgId, userId);

    if (!revoked) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: 'No active signature found to revoke' },
        HttpStatus.NOT_FOUND,
      );
    }

    return { message: 'Signature revoked successfully' };
  }
}
