"use strict";
/**
 * AssetController - REST endpoints for asset/file management
 *
 * Endpoints:
 * - POST   /api/pdfme/assets/upload    (upload image or font)
 * - GET    /api/pdfme/assets           (list org assets)
 * - GET    /api/pdfme/assets/:assetId  (download asset)
 * - DELETE /api/pdfme/assets/:assetId  (delete asset)
 */
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const asset_service_1 = require("./asset.service");
const template_service_1 = require("./template.service");
const path = tslib_1.__importStar(require("path"));
/**
 * Extract orgId and userId from JWT token (simple decode for now).
 */
function decodeJwt(authHeader) {
    if (!authHeader?.startsWith('Bearer '))
        return null;
    try {
        const token = authHeader.slice(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return {
            sub: payload.sub || 'unknown',
            orgId: payload.orgId || '',
            roles: payload.roles || [],
        };
    }
    catch {
        return null;
    }
}
/** Maximum asset file size: 10MB */
const MAX_ASSET_SIZE = 10 * 1024 * 1024;
let AssetController = class AssetController {
    assetService;
    templateService;
    constructor(assetService, templateService) {
        this.assetService = assetService;
        this.templateService = templateService;
    }
    async upload(file, queryOrgId, authHeader) {
        if (!file) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'No file provided. Use multipart/form-data with field name "file".' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Check file size - return 413 for oversized uploads
        if (file.size > MAX_ASSET_SIZE) {
            throw new common_1.HttpException({
                statusCode: 413,
                error: 'Payload Too Large',
                message: `File exceeds maximum size of 10MB (${(file.size / 1024 / 1024).toFixed(1)}MB provided)`,
                maxSize: '10MB',
                actualSize: `${(file.size / 1024 / 1024).toFixed(1)}MB`,
            }, common_1.HttpStatus.PAYLOAD_TOO_LARGE);
        }
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId || 'default';
        if (!this.assetService.isAllowedExtension(file.originalname)) {
            const ext = path.extname(file.originalname).toLowerCase();
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: `Unsupported file type: ${ext}. Allowed: .png, .jpg, .jpeg, .svg, .webp, .gif, .ttf, .otf, .woff2` }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Check asset storage quota before uploading
        const quotaCheck = await this.assetService.checkAssetStorageQuota(orgId, file.size);
        if (quotaCheck && quotaCheck.exceeded) {
            throw new common_1.HttpException({
                statusCode: 413,
                error: 'Payload Too Large',
                message: `Asset storage quota exceeded. Current usage: ${quotaCheck.currentUsageBytes} bytes, quota: ${quotaCheck.quotaBytes} bytes, new asset: ${quotaCheck.newAssetSizeBytes} bytes`,
                quotaExceeded: true,
                currentUsageBytes: quotaCheck.currentUsageBytes,
                quotaBytes: quotaCheck.quotaBytes,
            }, common_1.HttpStatus.PAYLOAD_TOO_LARGE);
        }
        try {
            const result = await this.assetService.upload(orgId, file.originalname, file.buffer, file.mimetype);
            return result;
        }
        catch (err) {
            throw new common_1.HttpException({ statusCode: 500, error: 'Internal Server Error', message: err.message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async list(queryOrgId, cursor, limitStr, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId || 'default';
        const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : 20;
        const result = await this.assetService.listAssetsWithMetadata(orgId, {
            cursor: cursor || undefined,
            limit,
        });
        return result;
    }
    async download(assetId, queryOrgId, category, authHeader, res) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId || 'default';
        // Try assets first, then fonts
        const directories = category ? [category === 'font' ? 'fonts' : 'assets'] : ['assets', 'fonts'];
        let storagePath = null;
        for (const dir of directories) {
            const files = await this.assetService.listAssets(orgId);
            const match = files.find(f => f.includes(assetId));
            if (match) {
                storagePath = match;
                break;
            }
        }
        if (!storagePath) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Asset ${assetId} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        const buffer = await this.assetService.readAsset(storagePath);
        const ext = path.extname(storagePath).toLowerCase();
        const mimeMap = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
            '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
        };
        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    async delete(assetId, queryOrgId, confirm, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId || 'default';
        const files = await this.assetService.listAssets(orgId);
        const match = files.find(f => f.includes(assetId));
        if (!match) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Asset ${assetId} not found` }, common_1.HttpStatus.NOT_FOUND);
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
    async findTemplatesReferencingAsset(orgId, assetId, storagePath) {
        const result = await this.templateService.findAll(orgId, { limit: 1000 });
        const templates = result.data;
        const matching = [];
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
    schemaReferencesAsset(schema, assetId, storagePath) {
        if (!schema || typeof schema !== 'object')
            return false;
        if (Array.isArray(schema)) {
            return schema.some(item => this.schemaReferencesAsset(item, assetId, storagePath));
        }
        const record = schema;
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
};
exports.AssetController = AssetController;
tslib_1.__decorate([
    (0, common_1.Post)('upload'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: MAX_ASSET_SIZE },
    })),
    tslib_1.__param(0, (0, common_1.UploadedFile)()),
    tslib_1.__param(1, (0, common_1.Query)('orgId')),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [typeof (_b = typeof Express !== "undefined" && (_a = Express.Multer) !== void 0 && _a.File) === "function" ? _b : Object, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], AssetController.prototype, "upload", null);
tslib_1.__decorate([
    (0, common_1.Get)(),
    tslib_1.__param(0, (0, common_1.Query)('orgId')),
    tslib_1.__param(1, (0, common_1.Query)('cursor')),
    tslib_1.__param(2, (0, common_1.Query)('limit')),
    tslib_1.__param(3, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], AssetController.prototype, "list", null);
tslib_1.__decorate([
    (0, common_1.Get)(':assetId'),
    tslib_1.__param(0, (0, common_1.Param)('assetId')),
    tslib_1.__param(1, (0, common_1.Query)('orgId')),
    tslib_1.__param(2, (0, common_1.Query)('category')),
    tslib_1.__param(3, (0, common_1.Headers)('authorization')),
    tslib_1.__param(4, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], AssetController.prototype, "download", null);
tslib_1.__decorate([
    (0, common_1.Delete)(':assetId'),
    tslib_1.__param(0, (0, common_1.Param)('assetId')),
    tslib_1.__param(1, (0, common_1.Query)('orgId')),
    tslib_1.__param(2, (0, common_1.Query)('confirm')),
    tslib_1.__param(3, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], AssetController.prototype, "delete", null);
exports.AssetController = AssetController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/assets'),
    tslib_1.__metadata("design:paramtypes", [asset_service_1.AssetService,
        template_service_1.TemplateService])
], AssetController);
//# sourceMappingURL=asset.controller.js.map