/**
 * LocalDiskStorageAdapter - Default file storage on local filesystem
 *
 * Configurable rootDir and tempDir with org-level isolation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileStorageService } from './file-storage.service';

export class LocalDiskStorageAdapter extends FileStorageService {
  /**
   * Simulated transient failure counter. When > 0, the next N write/read
   * operations will throw a simulated transient error, then succeed.
   * Used for testing retry logic.
   */
  private simulatedFailuresRemaining = 0;

  constructor(
    private readonly rootDir: string,
    private readonly tempDir: string,
  ) {
    super();
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
  setSimulatedFailures(count: number): void {
    this.simulatedFailuresRemaining = count;
  }

  getSimulatedFailures(): number {
    return this.simulatedFailuresRemaining;
  }

  private checkSimulatedFailure(): void {
    if (this.simulatedFailuresRemaining > 0) {
      this.simulatedFailuresRemaining--;
      throw new Error('Simulated transient storage failure (ECONNRESET)');
    }
  }

  private resolvePath(filePath: string): string {
    // Prevent path traversal
    const resolved = path.resolve(this.rootDir, filePath);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  async write(filePath: string, data: Buffer): Promise<void> {
    this.checkSimulatedFailure();
    const fullPath = this.resolvePath(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, data);
  }

  async read(filePath: string): Promise<Buffer> {
    this.checkSimulatedFailure();
    const fullPath = this.resolvePath(filePath);
    return fs.readFileSync(fullPath);
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath);
    return fs.existsSync(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const fullPath = this.resolvePath(prefix);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return [prefix];
    }
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(prefix, entry.name);
      if (entry.isFile()) {
        result.push(entryPath);
      } else if (entry.isDirectory()) {
        const subFiles = await this.list(entryPath);
        result.push(...subFiles);
      }
    }
    return result;
  }

  async stat(filePath: string): Promise<{ size: number; modifiedAt: Date } | null> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    const stats = fs.statSync(fullPath);
    return { size: stats.size, modifiedAt: stats.mtime };
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getTempDir(): string {
    return this.tempDir;
  }

  async usage(orgId: string): Promise<{ documents: number; assets: number; total: number }> {
    let documents = 0;
    let assets = 0;

    const docFiles = await this.list(`${orgId}/documents`);
    for (const f of docFiles) {
      const s = await this.stat(f);
      if (s) documents += s.size;
    }

    const assetFiles = await this.list(`${orgId}/assets`);
    const fontFiles = await this.list(`${orgId}/fonts`);
    for (const f of [...assetFiles, ...fontFiles]) {
      const s = await this.stat(f);
      if (s) assets += s.size;
    }

    return { documents, assets, total: documents + assets };
  }
}
