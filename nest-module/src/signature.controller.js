"use strict";
/**
 * SignatureController - REST endpoints for user signature management
 *
 * Endpoints:
 * - POST   /api/pdfme/signatures          (upload signature PNG)
 * - GET    /api/pdfme/signatures/me        (get current user's signature)
 * - GET    /api/pdfme/signatures/me/file   (download signature PNG file)
 * - DELETE /api/pdfme/signatures/me        (revoke current signature)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const signature_service_1 = require("./signature.service");
const audit_service_1 = require("./audit.service");
const common_2 = require("@nestjs/common");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
let SignatureController = class SignatureController {
    signatureService;
    storage;
    auditService;
    constructor(signatureService, storage, auditService) {
        this.signatureService = signatureService;
        this.storage = storage;
        this.auditService = auditService;
    }
    async upload(body, req) {
        const user = req.user;
        const orgId = user?.orgId || body.orgId || 'default';
        const userId = user?.sub || 'unknown';
        if (!body.data) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'Signature data is required. Provide base64-encoded PNG in "data" field.' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Check for empty/whitespace-only data
        if (typeof body.data === 'string' && !body.data.trim()) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'Signature data is empty' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Detect format from data URL prefix or raw base64
        let imageBuffer;
        let detectedFormat = 'unknown';
        try {
            let base64Data = body.data;
            // Strip data URL prefix and detect format
            if (base64Data.startsWith('data:image/png;base64,')) {
                base64Data = base64Data.slice('data:image/png;base64,'.length);
                detectedFormat = 'png';
            }
            else if (base64Data.startsWith('data:image/svg+xml;base64,')) {
                base64Data = base64Data.slice('data:image/svg+xml;base64,'.length);
                detectedFormat = 'svg';
            }
            else if (base64Data.startsWith('data:')) {
                // Has a data URL prefix but not an accepted image type
                const mimeMatch = base64Data.match(/^data:([^;]+);base64,/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: `Unsupported image format: ${mimeType}. Accepted formats: image/png, image/svg+xml.`,
                    details: [{ field: 'data', reason: `MIME type "${mimeType}" is not supported. Upload a PNG or SVG image.` }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
            imageBuffer = Buffer.from(base64Data, 'base64');
        }
        catch (err) {
            if (err instanceof common_1.HttpException)
                throw err;
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'Invalid base64 data' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (imageBuffer.length === 0) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'Signature data is empty after decoding' }, common_1.HttpStatus.BAD_REQUEST);
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
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Invalid image data. Signature must be a PNG or SVG image.',
                details: [{ field: 'data', reason: 'Could not detect PNG or SVG format from the provided data. Ensure the data is a valid PNG or SVG image.' }],
            }, common_1.HttpStatus.BAD_REQUEST);
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
    async getMySignature(req) {
        const user = req.user;
        const orgId = user?.orgId || 'default';
        const userId = user?.sub || 'unknown';
        const signature = await this.signatureService.getMySignature(orgId, userId);
        if (!signature) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'No active signature found for this user' }, common_1.HttpStatus.NOT_FOUND);
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
    async downloadSignature(req, res) {
        const user = req.user;
        const orgId = user?.orgId || 'default';
        const userId = user?.sub || 'unknown';
        const signature = await this.signatureService.getMySignature(orgId, userId);
        if (!signature) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'No active signature found for this user' }, common_1.HttpStatus.NOT_FOUND);
        }
        const buffer = await this.signatureService.readSignatureFile(signature.filePath);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    async revokeSignature(req) {
        const user = req.user;
        const orgId = user?.orgId || 'default';
        const userId = user?.sub || 'unknown';
        // Get signature info before revoking for audit trail
        const signature = await this.signatureService.getMySignature(orgId, userId);
        const revoked = await this.signatureService.revoke(orgId, userId);
        if (!revoked) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: 'No active signature found to revoke' }, common_1.HttpStatus.NOT_FOUND);
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
        // Get updated signature to include revokedAt in response
        const sigId = signature?.id;
        const revokedSig = sigId ? await this.signatureService.getSignatureById(orgId, sigId) : null;
        return {
            message: 'Signature revoked successfully',
            id: sigId || 'unknown',
            userId,
            orgId,
            revokedAt: revokedSig?.revokedAt || new Date().toISOString(),
        };
    }
    /**
     * GET /api/pdfme/signatures/storage-info
     * Returns information about signature storage permissions for the authenticated org.
     */
    async getStorageInfo(req) {
        const user = req.user;
        const orgId = user.orgId;
        // Get the storage root
        const rootDir = this.storage.getRootDir?.() || '';
        const sigDir = path.join(rootDir, orgId, 'signatures');
        let directoryPermissions = null;
        let directoryExists = false;
        let filePermissions = null;
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
        }
        catch {
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
};
exports.SignatureController = SignatureController;
tslib_1.__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], SignatureController.prototype, "upload", null);
tslib_1.__decorate([
    (0, common_1.Get)('me'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], SignatureController.prototype, "getMySignature", null);
tslib_1.__decorate([
    (0, common_1.Get)('me/file'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], SignatureController.prototype, "downloadSignature", null);
tslib_1.__decorate([
    (0, common_1.Delete)('me'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], SignatureController.prototype, "revokeSignature", null);
tslib_1.__decorate([
    (0, common_1.Get)('storage-info'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], SignatureController.prototype, "getStorageInfo", null);
exports.SignatureController = SignatureController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/signatures'),
    tslib_1.__param(1, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__param(2, (0, common_2.Optional)()),
    tslib_1.__metadata("design:paramtypes", [signature_service_1.SignatureService, Object, audit_service_1.AuditService])
], SignatureController);
//# sourceMappingURL=signature.controller.js.map