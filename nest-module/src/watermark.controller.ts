/**
 * WatermarkController - REST endpoints for watermark functionality
 *
 * Endpoints:
 * - POST /api/pdfme/watermark/preview  - Generate a watermark preview PDF
 */

import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { applyWatermark, WATERMARK_DEFAULTS, parseHexColor } from '@pdfme-erp/schemas';
import type { WatermarkConfig } from '@pdfme-erp/schemas';

interface WatermarkPreviewDto {
  text?: string;
  opacity?: number;
  rotation?: number;
  color?: string | { r: number; g: number; b: number };
  fontSize?: number;
}

@Controller('api/pdfme/watermark')
export class WatermarkController {
  /**
   * Generate a single-page A4 PDF with a watermark overlay for preview.
   * Returns the PDF as binary or as a JSON response with base64 data.
   */
  @Post('preview')
  async preview(
    @Body() body: WatermarkPreviewDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    try {
      const { PDFDocument } = await import('pdf-lib');

      // Create a blank A4 PDF
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
      const blankPdf = await pdfDoc.save();

      // Parse color
      let color: { r: number; g: number; b: number } = WATERMARK_DEFAULTS.color;
      if (body.color) {
        if (typeof body.color === 'string') {
          color = parseHexColor(body.color);
        } else if (typeof body.color === 'object') {
          color = body.color;
        }
      }

      // Build watermark config
      const config: WatermarkConfig = {
        text: body.text || WATERMARK_DEFAULTS.text,
        opacity: body.opacity ?? WATERMARK_DEFAULTS.opacity,
        rotation: body.rotation ?? WATERMARK_DEFAULTS.rotation,
        color,
        fontSize: body.fontSize ?? WATERMARK_DEFAULTS.fontSize,
      };

      // Apply watermark
      const watermarkedPdf = await applyWatermark(blankPdf, config);

      // Return as JSON with base64 and metadata
      const accept = req.headers['accept'] || '';
      if (accept.includes('application/pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="watermark-preview.pdf"');
        res.setHeader('Content-Length', watermarkedPdf.length);
        res.send(Buffer.from(watermarkedPdf));
      } else {
        res.json({
          config,
          pdfBase64: Buffer.from(watermarkedPdf).toString('base64'),
          pdfSize: watermarkedPdf.length,
          message: 'Watermark preview generated successfully',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: `Watermark generation failed: ${message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
