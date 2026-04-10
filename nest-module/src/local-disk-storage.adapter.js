"use strict";
/**
 * LocalDiskStorageAdapter - Default file storage on local filesystem
 *
 * Configurable rootDir and tempDir with org-level isolation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDiskStorageAdapter = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const file_storage_service_1 = require("./file-storage.service");
class LocalDiskStorageAdapter extends file_storage_service_1.FileStorageService {
    rootDir;
    tempDir;
    /**
     * Simulated transient failure counter. When > 0, the next N write/read
     * operations will throw a simulated transient error, then succeed.
     * Used for testing retry logic.
     */
    simulatedFailuresRemaining = 0;
    constructor(rootDir, tempDir) {
        super();
        this.rootDir = rootDir;
        this.tempDir = tempDir;
        // Ensure root and temp directories exist
        fs.mkdirSync(this.rootDir, { recursive: true });
        fs.mkdirSync(this.tempDir, { recursive: true });
        // Ensure specified directory structure per FileStorageService spec
        fs.mkdirSync(path.join(this.rootDir, 'system', 'fonts'), { recursive: true });
        fs.mkdirSync(path.join(this.tempDir, 'previews'), { recursive: true });
    }
    /**
     * Set the number of transient failures to simulate on next operations.
     * Each write or read call decrements the counter; when 0, operations succeed.
     */
    setSimulatedFailures(count) {
        this.simulatedFailuresRemaining = count;
    }
    getSimulatedFailures() {
        return this.simulatedFailuresRemaining;
    }
    checkSimulatedFailure() {
        if (this.simulatedFailuresRemaining > 0) {
            this.simulatedFailuresRemaining--;
            throw new Error('Simulated transient storage failure (ECONNRESET)');
        }
    }
    resolvePath(filePath) {
        // Prevent path traversal
        const resolved = path.resolve(this.rootDir, filePath);
        if (!resolved.startsWith(path.resolve(this.rootDir))) {
            throw new Error('Path traversal detected');
        }
        return resolved;
    }
    async write(filePath, data) {
        this.checkSimulatedFailure();
        const fullPath = this.resolvePath(filePath);
        const dirPath = path.dirname(fullPath);
        fs.mkdirSync(dirPath, { recursive: true });
        // Enforce restricted permissions (0700) on signature directories
        if (filePath.includes('/signatures/') || filePath.includes('/signatures')) {
            // Set 0700 on the signatures directory itself
            const sigDirIndex = fullPath.indexOf('/signatures');
            if (sigDirIndex !== -1) {
                // Find the signatures directory path
                const sigDir = fullPath.substring(0, fullPath.indexOf('/signatures') + '/signatures'.length);
                if (fs.existsSync(sigDir)) {
                    fs.chmodSync(sigDir, 0o700);
                }
                // Also set restrictive permissions on the file itself (0600 = owner read/write only)
                fs.writeFileSync(fullPath, data, { mode: 0o600 });
                return;
            }
        }
        fs.writeFileSync(fullPath, data);
    }
    async read(filePath) {
        this.checkSimulatedFailure();
        const fullPath = this.resolvePath(filePath);
        return fs.readFileSync(fullPath);
    }
    async exists(filePath) {
        const fullPath = this.resolvePath(filePath);
        return fs.existsSync(fullPath);
    }
    async delete(filePath) {
        const fullPath = this.resolvePath(filePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    }
    async list(prefix) {
        const fullPath = this.resolvePath(prefix);
        if (!fs.existsSync(fullPath)) {
            return [];
        }
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) {
            return [prefix];
        }
        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
            const entryPath = path.join(prefix, entry.name);
            if (entry.isFile()) {
                result.push(entryPath);
            }
            else if (entry.isDirectory()) {
                const subFiles = await this.list(entryPath);
                result.push(...subFiles);
            }
        }
        return result;
    }
    async stat(filePath) {
        const fullPath = this.resolvePath(filePath);
        if (!fs.existsSync(fullPath)) {
            return null;
        }
        const stats = fs.statSync(fullPath);
        return { size: stats.size, modifiedAt: stats.mtime };
    }
    getRootDir() {
        return this.rootDir;
    }
    getTempDir() {
        return this.tempDir;
    }
    async usage(orgId) {
        let documents = 0;
        let assets = 0;
        const docFiles = await this.list(`${orgId}/documents`);
        for (const f of docFiles) {
            const s = await this.stat(f);
            if (s)
                documents += s.size;
        }
        const assetFiles = await this.list(`${orgId}/assets`);
        const fontFiles = await this.list(`${orgId}/fonts`);
        for (const f of [...assetFiles, ...fontFiles]) {
            const s = await this.stat(f);
            if (s)
                assets += s.size;
        }
        return { documents, assets, total: documents + assets };
    }
}
exports.LocalDiskStorageAdapter = LocalDiskStorageAdapter;
//# sourceMappingURL=local-disk-storage.adapter.js.map