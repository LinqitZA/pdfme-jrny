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

    // Accept base64 data (with or without data URL prefix)
    let pngBuffer: Buffer;
    try {
      const base64Data = body.data.replace(/^data:image\/png;base64,/, '');
      pngBuffer = Buffer.from(base64Data, 'base64');
    } catch {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Invalid base64 data' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (pngBuffer.length === 0) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'Signature data is empty' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.signatureService.upload(orgId, userId, pngBuffer);

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
