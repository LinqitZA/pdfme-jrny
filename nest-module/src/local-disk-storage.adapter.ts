/**
 * LocalDiskStorageAdapter - Default file storage on local filesystem
 *
 * Configurable rootDir and tempDir with org-level isolation.
 */

import { FileStorageService } from './file-storage.service';

export class LocalDiskStorageAdapter extends FileStorageService {
  constructor(
    private readonly rootDir: string,
    private readonly tempDir: string,
  ) {
    super();
  }

  // To be implemented by coding agents
  async write(_path: string, _data: Buffer): Promise<void> {
    throw new Error('Not implemented');
  }

  async read(_path: string): Promise<Buffer> {
    throw new Error('Not implemented');
  }

  async exists(_path: string): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async delete(_path: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async list(_prefix: string): Promise<string[]> {
    throw new Error('Not implemented');
  }

  async stat(_path: string): Promise<{ size: number; modifiedAt: Date } | null> {
    throw new Error('Not implemented');
  }

  async usage(_orgId: string): Promise<{ documents: number; assets: number; total: number }> {
    throw new Error('Not implemented');
  }
}
