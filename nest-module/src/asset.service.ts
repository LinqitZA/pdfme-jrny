/**
 * AssetService - Manages file asset storage for org-level images and fonts
 *
 * Stores files in org-specific directories:
 * - Images (PNG, JPG, SVG, WEBP) → {orgId}/assets/
 * - Fonts (TTF, OTF, WOFF2)     → {orgId}/fonts/
 */

import { Injectable, Inject, Optional } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { OrgSettingsService } from './org-settings.service';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface AssetUploadResult {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: 'image' | 'font';
  storagePath: string;
  orgId: string;
  createdAt: string;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'];
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2'];
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS];

const MIME_MAP: Record<string, string> = {
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

@Injectable()
export class AssetService {
  constructor(
    @Inject('FILE_STORAGE') private readonly storage: FileStorageService,
    private readonly orgSettingsService: OrgSettingsService,
    @Optional() @Inject('PDFME_MODULE_CONFIG') private readonly moduleConfig?: any,
  ) {}

  /**
   * Determine the category (image or font) based on file extension
   */
  getCategory(filename: string): 'image' | 'font' | null {
    const ext = path.extname(filename).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (FONT_EXTENSIONS.includes(ext)) return 'font';
    return null;
  }

  /**
   * Validate that the file extension is allowed
   */
  isAllowedExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
  }

  /**
   * Check if storing an asset of the given size would exceed the tenant's asset storage quota.
   * Returns null if within quota, or quota details if exceeded.
   */
  async checkAssetStorageQuota(orgId: string, newAssetSizeBytes: number): Promise<{
    exceeded: boolean;
    currentUsageBytes: number;
    quotaBytes: number;
    newAssetSizeBytes: number;
  } | null> {
    const perTenantQuota = this.orgSettingsService.get(orgId).assetsQuotaBytes as number | null | undefined;
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
  async upload(
    orgId: string,
    originalName: string,
    buffer: Buffer,
    mimeType?: string,
  ): Promise<AssetUploadResult> {
    const ext = path.extname(originalName).toLowerCase();
    const category = this.getCategory(originalName);

    if (!category) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const id = randomUUID();
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
  async listAssets(orgId: string): Promise<string[]> {
    const assetFiles = await this.storage.list(`${orgId}/assets`);
    const fontFiles = await this.storage.list(`${orgId}/fonts`);
    return [...assetFiles, ...fontFiles];
  }

  /**
   * List assets with metadata for an org, supporting cursor pagination.
   * Cursor is the asset ID (UUID) to start after.
   */
  async listAssetsWithMetadata(orgId: string, options?: {
    cursor?: string;
    limit?: number;
  }): Promise<{
    data: AssetUploadResult[];
    pagination: { total: number; limit: number; hasMore: boolean; nextCursor: string | null };
  }> {
    const limit = options?.limit || 20;
    const cursor = options?.cursor;

    const allPaths = await this.listAssets(orgId);

    // Convert paths to metadata objects
    const allAssets: AssetUploadResult[] = allPaths.map(storagePath => {
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
  async readAsset(storagePath: string): Promise<Buffer> {
    return this.storage.read(storagePath);
  }

  /**
   * Check if an asset exists
   */
  async assetExists(storagePath: string): Promise<boolean> {
    return this.storage.exists(storagePath);
  }

  /**
   * Delete an asset
   */
  async deleteAsset(storagePath: string): Promise<void> {
    return this.storage.delete(storagePath);
  }
}
