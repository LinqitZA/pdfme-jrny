"use strict";
/**
 * WatermarkController - REST endpoints for watermark functionality
 *
 * Endpoints:
 * - POST /api/pdfme/watermark/preview  - Generate a watermark preview PDF
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatermarkController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const schemas_1 = require("@pdfme-erp/schemas");
let WatermarkController = class WatermarkController {
    /**
     * Generate a single-page A4 PDF with a watermark overlay for preview.
     * Returns the PDF as binary or as a JSON response with base64 data.
     */
    async preview(body, req, res) {
        try {
            const { PDFDocument } = await Promise.resolve().then(() => tslib_1.__importStar(require('pdf-lib')));
            // Create a blank A4 PDF
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
            const blankPdf = await pdfDoc.save();
            // Parse color
            let color = schemas_1.WATERMARK_DEFAULTS.color;
            if (body.color) {
                if (typeof body.color === 'string') {
                    color = (0, schemas_1.parseHexColor)(body.color);
                }
                else if (typeof body.color === 'object') {
                    color = body.color;
                }
            }
            // Build watermark config
            const config = {
                text: body.text || schemas_1.WATERMARK_DEFAULTS.text,
                opacity: body.opacity ?? schemas_1.WATERMARK_DEFAULTS.opacity,
                rotation: body.rotation ?? schemas_1.WATERMARK_DEFAULTS.rotation,
                color,
                fontSize: body.fontSize ?? schemas_1.WATERMARK_DEFAULTS.fontSize,
            };
            // Apply watermark
            const watermarkedPdf = await (0, schemas_1.applyWatermark)(blankPdf, config);
            // Return as JSON with base64 and metadata
            const accept = req.headers['accept'] || '';
            if (accept.includes('application/pdf')) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="watermark-preview.pdf"');
                res.setHeader('Content-Length', watermarkedPdf.length);
                res.send(Buffer.from(watermarkedPdf));
            }
            else {
                res.json({
                    config,
                    pdfBase64: Buffer.from(watermarkedPdf).toString('base64'),
                    pdfSize: watermarkedPdf.length,
                    message: 'Watermark preview generated successfully',
                });
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({
                statusCode: 500,
                error: 'Internal Server Error',
                message: `Watermark generation failed: ${message}`,
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.WatermarkController = WatermarkController;
tslib_1.__decorate([
    (0, common_1.Post)('preview'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__param(2, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], WatermarkController.prototype, "preview", null);
exports.WatermarkController = WatermarkController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/watermark')
], WatermarkController);
//# sourceMappingURL=watermark.controller.js.map