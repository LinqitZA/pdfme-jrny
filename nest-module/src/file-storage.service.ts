/**
 * FileStorageService - Abstract file storage interface
 *
 * Methods: write, read, exists, delete, list, stat, usage
 * Default implementation: LocalDiskStorageAdapter
 * Future: S3, Azure Blob adapters
 *
 * Directory structure:
 * {orgId}/documents/
 * {orgId}/assets/
 * {orgId}/fonts/
 * {orgId}/signatures/
 * system/fonts/
 * {tempDir}/previews/
 * {tempDir}/backups/
 */

export abstract class FileStorageService {
  abstract write(path: string, data: Buffer): Promise<void>;
  abstract read(path: string): Promise<Buffer>;
  abstract exists(path: string): Promise<boolean>;
  abstract delete(path: string): Promise<void>;
  abstract list(prefix: string): Promise<string[]>;
  abstract stat(path: string): Promise<{ size: number; modifiedAt: Date } | null>;
  abstract usage(orgId: string): Promise<{ documents: number; assets: number; total: number }>;
}
