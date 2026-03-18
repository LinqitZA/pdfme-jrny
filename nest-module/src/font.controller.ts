/**
 * FontController - REST endpoints for font management with validation
 *
 * Endpoints:
 * - POST   /api/pdfme/fonts/upload    (upload and validate font)
 * - GET    /api/pdfme/fonts           (list org fonts)
 * - GET    /api/pdfme/fonts/:fontId   (download font)
 * - DELETE /api/pdfme/fonts/:fontId   (delete font)
 *
 * Validates:
 * - File format (TTF, OTF, WOFF2 by magic bytes)
 * - fsType embedding permission (from OS/2 table)
 * - File size (max 10MB)
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  Res,
  HttpException,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AssetService } from './asset.service';
import * as path from 'path';

/** Maximum font file size: 10MB */
const MAX_FONT_SIZE = 10 * 1024 * 1024;

/** Font format magic bytes */
const MAGIC = {
  TTF: Buffer.from([0x00, 0x01, 0x00, 0x00]),  // TrueType
  OTF: Buffer.from([0x4F, 0x54, 0x54, 0x4F]),   // OpenType (OTTO)
  WOFF2: Buffer.from([0x77, 0x4F, 0x46, 0x32]),  // wOF2
};

/** Allowed font extensions */
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2'];

/**
 * fsType bit flags (from the OS/2 table):
 * Bit 0 (0x0001): Reserved (must be zero)
 * Bit 1 (0x0002): Restricted License embedding
 * Bit 2 (0x0004): Preview & Print embedding
 * Bit 3 (0x0008): Editable embedding
 * Bit 8 (0x0100): No subsetting
 * Bit 9 (0x0200): Bitmap embedding only
 *
 * If bit 1 is set and bits 2-3 are not set, embedding is restricted.
 * If fsType == 0x0000, installable embedding is allowed (most permissive).
 */
function checkFsType(fsType: number): { allowed: boolean; description: string } {
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
 * Detect font format from magic bytes.
 */
function detectFontFormat(buffer: Buffer): 'ttf' | 'otf' | 'woff2' | null {
  if (buffer.length < 4) return null;

  const head = buffer.subarray(0, 4);

  if (head.equals(MAGIC.TTF)) return 'ttf';
  if (head.equals(MAGIC.OTF)) return 'otf';
  if (head.equals(MAGIC.WOFF2)) return 'woff2';

  return null;
}

/**
 * Read fsType from a TTF/OTF font's OS/2 table.
 * Returns the fsType value, or null if not found.
 */
function readFsTypeFromFont(buffer: Buffer): number | null {
  if (buffer.length < 12) return null;

  // Parse table directory
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
 * System font registry - declares fonts that ship with the system.
 * All system fonts MUST be open-licence (SIL OFL 1.1 or Apache 2.0).
 * Proprietary fonts are never included as system fonts.
 */
const SYSTEM_FONTS = [
  {
    name: 'Roboto',
    licence: 'Apache-2.0',
    licenceUrl: 'https://github.com/googlefonts/roboto/blob/main/LICENSE',
    source: 'Google Fonts',
    embeddable: true,
    fsType: 0x0000,
    role: 'Default fallback font (pdfme built-in)',
    openLicence: true,
  },
  {
    name: 'Inter',
    licence: 'SIL-OFL-1.1',
    licenceUrl: 'https://github.com/rsms/inter/blob/master/LICENSE.txt',
    source: 'Google Fonts / rsms',
    embeddable: true,
    fsType: 0x0000,
    role: 'Primary UI and document font',
    openLicence: true,
  },
  {
    name: 'Noto Sans',
    licence: 'SIL-OFL-1.1',
    licenceUrl: 'https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt',
    source: 'Google Fonts / Noto Project',
    embeddable: true,
    fsType: 0x0000,
    role: 'Fallback and multilingual support',
    openLicence: true,
  },
  {
    name: 'IBM Plex Sans',
    licence: 'SIL-OFL-1.1',
    licenceUrl: 'https://github.com/IBM/plex/blob/master/LICENSE.txt',
    source: 'Google Fonts / IBM',
    embeddable: true,
    fsType: 0x0000,
    role: 'Alternative document font',
    openLicence: true,
  },
];

@Controller('api/pdfme/fonts')
export class FontController {
  constructor(private readonly assetService: AssetService) {}

  /**
   * List system fonts with licence information.
   * All system fonts are verified open-licence (SIL OFL or Apache 2.0).
   * No proprietary fonts are included in the system font registry.
   */
  @Get('system')
  getSystemFonts() {
    const allOpen = SYSTEM_FONTS.every(f => f.openLicence);
    const proprietaryFonts = SYSTEM_FONTS.filter(f => !f.openLicence);
    return {
      fonts: SYSTEM_FONTS,
      count: SYSTEM_FONTS.length,
      allOpenLicence: allOpen,
      proprietaryCount: proprietaryFonts.length,
      proprietaryFonts: proprietaryFonts.map(f => f.name),
      licences: [...new Set(SYSTEM_FONTS.map(f => f.licence))],
    };
  }

  /**
   * Upload and validate a font file.
   * Checks: format (magic bytes), fsType embedding permission, file size.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_FONT_SIZE },
  }))
  async uploadFont(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!file) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'No file provided. Use multipart/form-data with field name "file".' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Check file size
    if (file.size > MAX_FONT_SIZE) {
      throw new HttpException(
        {
          statusCode: 413,
          error: 'Payload Too Large',
          message: `Font file exceeds maximum size of 10MB (${(file.size / 1024 / 1024).toFixed(1)}MB provided)`,
          maxSize: '10MB',
          actualSize: `${(file.size / 1024 / 1024).toFixed(1)}MB`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // 2. Check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (!FONT_EXTENSIONS.includes(ext)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid font file format. Extension "${ext}" is not supported. Allowed: .ttf, .otf, .woff2`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Validate magic bytes (actual format detection)
    const detectedFormat = detectFontFormat(file.buffer);
    if (!detectedFormat) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: `Invalid font file. File does not contain valid TTF, OTF, or WOFF2 data (magic bytes mismatch).`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Check fsType embedding permission (TTF/OTF only — WOFF2 doesn't have OS/2 table directly)
    let fsTypeInfo: { allowed: boolean; description: string; value: number | null } = {
      allowed: true,
      description: 'Format does not contain OS/2 table (WOFF2)',
      value: null,
    };

    if (detectedFormat === 'ttf' || detectedFormat === 'otf') {
      const fsType = readFsTypeFromFont(file.buffer);
      if (fsType !== null) {
        const check = checkFsType(fsType);
        fsTypeInfo = { ...check, value: fsType };

        if (!check.allowed) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'Bad Request',
              message: `Font embedding restricted: ${check.description}. fsType=0x${fsType.toString(16).padStart(4, '0')}. This font cannot be used for PDF generation.`,
              fsType: `0x${fsType.toString(16).padStart(4, '0')}`,
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    // 5. Store font in org fonts directory via AssetService
    const result = await this.assetService.upload(
      user.orgId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );

    return {
      ...result,
      validation: {
        detectedFormat,
        fsType: fsTypeInfo,
        sizeBytes: file.size,
        valid: true,
      },
    };
  }

  /**
   * List fonts for the authenticated user's org.
   */
  @Get()
  async listFonts(@Req() req: any) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const allFiles = await this.assetService.listAssets(user.orgId);
    const fontFiles = allFiles.filter((f: string) => {
      const ext = path.extname(f).toLowerCase();
      return FONT_EXTENSIONS.includes(ext);
    });

    return {
      data: fontFiles,
      count: fontFiles.length,
    };
  }

  /**
   * Font cache configuration for browser clients.
   * Returns recommended cache settings (cache name, TTL).
   * The actual caching is done client-side using the browser Cache API.
   */
  @Get('cache/config')
  getFontCacheConfig() {
    return {
      cacheName: 'pdfme-font-cache-v1',
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours
      ttlHours: 24,
      strategy: 'cache-first',
      description: 'Browser Cache API with 24h TTL for font files',
    };
  }

  /**
   * Download a font by ID.
   */
  @Get(':fontId')
  async downloadFont(
    @Param('fontId') fontId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const allFiles = await this.assetService.listAssets(user.orgId);
    const fontFiles = allFiles.filter((f: string) => {
      const ext = path.extname(f).toLowerCase();
      return FONT_EXTENSIONS.includes(ext);
    });
    const match = fontFiles.find((f: string) => f.includes(fontId));

    if (!match) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Font ${fontId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const buffer = await this.assetService.readAsset(match);
    const ext = path.extname(match).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff2': 'font/woff2',
    };

    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    // Cache-Control: allow browser caching for 24 hours (complements Cache API)
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buffer);
  }

  /**
   * Delete a font by ID.
   */
  @Delete(':fontId')
  async deleteFont(
    @Param('fontId') fontId: string,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const allFiles = await this.assetService.listAssets(user.orgId);
    const fontFiles = allFiles.filter((f: string) => {
      const ext = path.extname(f).toLowerCase();
      return FONT_EXTENSIONS.includes(ext);
    });
    const match = fontFiles.find((f: string) => f.includes(fontId));

    if (!match) {
      throw new HttpException(
        { statusCode: 404, error: 'Not Found', message: `Font ${fontId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    await this.assetService.deleteAsset(match);
    return { id: fontId, deleted: true };
  }
}
