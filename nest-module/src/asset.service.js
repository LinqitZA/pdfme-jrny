"use strict";
/**
 * AssetService - Manages file asset storage for org-level images and fonts
 *
 * Stores files in org-specific directories:
 * - Images (PNG, JPG, SVG, WEBP) → {orgId}/assets/
 * - Fonts (TTF, OTF, WOFF2)     → {orgId}/fonts/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const file_storage_service_1 = require("./file-storage.service");
const org_settings_service_1 = require("./org-settings.service");
const path = tslib_1.__importStar(require("path"));
const crypto_1 = require("crypto");
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'];
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2'];
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS];
const MIME_MAP = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff2': 'font/woff2',
};
let AssetService = class AssetService {
    storage;
    orgSettingsService;
    moduleConfig;
    constructor(storage, orgSettingsService, moduleConfig) {
        this.storage = storage;
        this.orgSettingsService = orgSettingsService;
        this.moduleConfig = moduleConfig;
    }
    /**
     * Determine the category (image or font) based on file extension
     */
    getCategory(filename) {
        const ext = path.extname(filename).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext))
            return 'image';
        if (FONT_EXTENSIONS.includes(ext))
            return 'font';
        return null;
    }
    /**
     * Validate that the file extension is allowed
     */
    isAllowedExtension(filename) {
        const ext = path.extname(filename).toLowerCase();
        return ALLOWED_EXTENSIONS.includes(ext);
    }
    /**
     * Check if storing an asset of the given size would exceed the tenant's asset storage quota.
     * Returns null if within quota, or quota details if exceeded.
     */
    async checkAssetStorageQuota(orgId, newAssetSizeBytes) {
        const perTenantQuota = this.orgSettingsService.get(orgId).assetsQuotaBytes;
        const globalQuota = this.moduleConfig?.quotas?.assetsBytes ?? 500 * 1024 * 1024; // 500MB default
        const quotaBytes = (perTenantQuota !== null && perTenantQuota !== undefined) ? perTenantQuota : globalQuota;
        const usage = await this.storage.usage(orgId);
        const currentUsageBytes = usage.assets;
        if (currentUsageBytes + newAssetSizeBytes > quotaBytes) {
            return {
                exceeded: true,
                currentUsageBytes,
                quotaBytes,
                newAssetSizeBytes,
            };
        }
        return null;
    }
    /**
     * Upload a file to the correct org directory
     */
    async upload(orgId, originalName, buffer, mimeType) {
        const ext = path.extname(originalName).toLowerCase();
        const category = this.getCategory(originalName);
        if (!category) {
            throw new Error(`Unsupported file type: ${ext}`);
        }
        const id = (0, crypto_1.randomUUID)();
        const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `${id}_${sanitizedName}`;
        // Images go to {orgId}/assets/, fonts go to {orgId}/fonts/
        const directory = category === 'image' ? 'assets' : 'fonts';
        const storagePath = `${orgId}/${directory}/${filename}`;
        await this.storage.write(storagePath, buffer);
        const resolvedMime = mimeType || MIME_MAP[ext] || 'application/octet-stream';
        return {
            id,
            filename,
            originalName,
            mimeType: resolvedMime,
            size: buffer.length,
            category,
            storagePath,
            orgId,
            createdAt: new Date().toISOString(),
        };
    }
    /**
     * List all assets for an org (raw storage paths)
     */
    async listAssets(orgId) {
        const assetFiles = await this.storage.list(`${orgId}/assets`);
        const fontFiles = await this.storage.list(`${orgId}/fonts`);
        return [...assetFiles, ...fontFiles];
    }
    /**
     * List assets with metadata for an org, supporting cursor pagination.
     * Cursor is the asset ID (UUID) to start after.
     */
    async listAssetsWithMetadata(orgId, options) {
        const limit = options?.limit || 20;
        const cursor = options?.cursor;
        const allPaths = await this.listAssets(orgId);
        // Convert paths to metadata objects
        const allAssets = allPaths.map(storagePath => {
            const filename = path.basename(storagePath);
            // Extract UUID from filename (format: uuid_originalname.ext)
            const underscoreIdx = filename.indexOf('_');
            const id = underscoreIdx > 0 ? filename.substring(0, underscoreIdx) : filename;
            const originalName = underscoreIdx > 0 ? filename.substring(underscoreIdx + 1) : filename;
            const ext = path.extname(filename).toLowerCase();
            const category = this.getCategory(filename) || 'image';
            const mimeType = MIME_MAP[ext] || 'application/octet-stream';
            return {
                id,
                filename,
                originalName,
                mimeType,
                size: 0, // Size not available from path listing
                category,
                storagePath,
                orgId,
                createdAt: '', // Not available from path listing
            };
        });
        // Sort by id for stable cursor pagination
        allAssets.sort((a, b) => a.id.localeCompare(b.id));
        // Apply cursor (skip items until we find the cursor ID, then start after it)
        let startIdx = 0;
        if (cursor) {
            const cursorIdx = allAssets.findIndex(a => a.id === cursor);
            if (cursorIdx >= 0) {
                startIdx = cursorIdx + 1;
            }
        }
        const page = allAssets.slice(startIdx, startIdx + limit);
        const hasMore = startIdx + limit < allAssets.length;
        const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;
        return {
            data: page,
            pagination: {
                total: allAssets.length,
                limit,
                hasMore,
                nextCursor,
            },
        };
    }
    /**
     * Read an asset file
     */
    async readAsset(storagePath) {
        return this.storage.read(storagePath);
    }
    /**
     * Check if an asset exists
     */
    async assetExists(storagePath) {
        return this.storage.exists(storagePath);
    }
    /**
     * Delete an asset
     */
    async deleteAsset(storagePath) {
        return this.storage.delete(storagePath);
    }
};
exports.AssetService = AssetService;
exports.AssetService = AssetService = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__param(2, (0, common_1.Optional)()),
    tslib_1.__param(2, (0, common_1.Inject)('PDFME_MODULE_CONFIG')),
    tslib_1.__metadata("design:paramtypes", [file_storage_service_1.FileStorageService,
        org_settings_service_1.OrgSettingsService, Object])
], AssetService);
//# sourceMappingURL=asset.service.js.map