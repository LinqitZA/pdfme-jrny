"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorageService = void 0;
class FileStorageService {
}
exports.FileStorageService = FileStorageService;
//# sourceMappingURL=file-storage.service.js.map