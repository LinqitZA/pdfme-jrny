/**
 * HashService - Centralised hashing utility for document integrity
 *
 * Supports configurable hashing algorithms (SHA-256 or BLAKE3) via PdfmeErpModuleConfig.
 * SHA-256 is the default for backward compatibility.
 *
 * Stored hashes are prefixed with the algorithm identifier (e.g. "sha256:abcdef..." or "blake3:abcdef...")
 * to support verification of documents hashed with either algorithm.
 * Legacy un-prefixed hashes are treated as SHA-256 for backward compatibility.
 */

import { Injectable, Inject, Optional } from '@nestjs/common';
import * as crypto from 'crypto';

export type HashAlgorithm = 'sha256' | 'blake3';

@Injectable()
export class HashService {
  private readonly algorithm: HashAlgorithm;
  private blake3Module: any = null;

  constructor(
    @Optional() @Inject('PDFME_MODULE_CONFIG') private readonly moduleConfig?: any,
  ) {
    this.algorithm = moduleConfig?.hashing?.algorithm || 'sha256';

    // Eagerly load blake3 module if configured
    if (this.algorithm === 'blake3') {
      try {
        this.blake3Module = require('blake3');
      } catch {
        console.warn('[HashService] blake3 package not available, falling back to sha256');
        (this as any).algorithm = 'sha256';
      }
    }
  }

  /**
   * Get the currently configured algorithm
   */
  getAlgorithm(): HashAlgorithm {
    return this.algorithm;
  }

  /**
   * Compute a hash of the given buffer using the configured algorithm.
   * Returns a prefixed hash string: "sha256:hexdigest" or "blake3:hexdigest"
   */
  computeHash(buffer: Buffer): string {
    const hex = this.computeRawHash(buffer);
    return `${this.algorithm}:${hex}`;
  }

  /**
   * Compute just the raw hex digest (no prefix) using the configured algorithm.
   */
  computeRawHash(buffer: Buffer): string {
    if (this.algorithm === 'blake3' && this.blake3Module) {
      return this.blake3Module.hash(buffer).toString('hex');
    }
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Compute hash using a specific algorithm (for verification of existing documents).
   * Returns raw hex string without prefix.
   */
  computeHashWithAlgorithm(buffer: Buffer, algorithm: HashAlgorithm): string {
    if (algorithm === 'blake3') {
      try {
        const blake3 = this.blake3Module || require('blake3');
        return blake3.hash(buffer).toString('hex');
      } catch {
        throw new Error('blake3 package is not available');
      }
    }
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Parse a stored hash to extract algorithm and hex digest.
   * Legacy un-prefixed hashes are treated as SHA-256.
   */
  parseStoredHash(storedHash: string): { algorithm: HashAlgorithm; hex: string } {
    const colonIndex = storedHash.indexOf(':');
    if (colonIndex > 0) {
      const prefix = storedHash.substring(0, colonIndex);
      const hex = storedHash.substring(colonIndex + 1);
      if (prefix === 'sha256' || prefix === 'blake3') {
        return { algorithm: prefix as HashAlgorithm, hex };
      }
    }
    // Legacy un-prefixed hash — assume SHA-256
    return { algorithm: 'sha256', hex: storedHash };
  }

  /**
   * Verify a buffer against a stored hash (with or without prefix).
   * Handles backward compatibility with legacy un-prefixed SHA-256 hashes.
   */
  verifyHash(buffer: Buffer, storedHash: string): { verified: boolean; currentHash: string; algorithm: HashAlgorithm } {
    const { algorithm, hex } = this.parseStoredHash(storedHash);
    const currentHash = this.computeHashWithAlgorithm(buffer, algorithm);
    return {
      verified: currentHash === hex,
      currentHash,
      algorithm,
    };
  }
}
