/**
 * SignatureService - Manages user signature upload, retrieval, and revocation
 *
 * Stores signature PNG files in private org directory: {orgId}/signatures/
 * Records metadata in user_signatures table with unique constraint per org+user.
 */

import { Injectable, Inject } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { eq, and, isNull } from 'drizzle-orm';
import { userSignatures } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { randomUUID } from 'crypto';

export interface SignatureUploadResult {
  id: string;
  userId: string;
  orgId: string;
  filePath: string;
  capturedAt: string;
}

export interface SignatureRecord {
  id: string;
  orgId: string;
  userId: string;
  filePath: string;
  capturedAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class SignatureService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly storage: FileStorageService,
  ) {}

  /**
   * Upload a signature PNG for a user. If the user already has an active signature,
   * revoke the old one first (unique constraint on org_id + user_id).
   */
  async upload(
    orgId: string,
    userId: string,
    pngData: Buffer,
  ): Promise<SignatureUploadResult> {
    // Delete any existing signature for this user+org (unique constraint: one per user per org)
    const existing = await this.db
      .select()
      .from(userSignatures)
      .where(
        and(
          eq(userSignatures.orgId, orgId),
          eq(userSignatures.userId, userId),
        ),
      );

    if (existing.length > 0) {
      // Delete old signature record (unique index allows only one per user+org)
      await this.db
        .delete(userSignatures)
        .where(eq(userSignatures.id, existing[0].id));
      // Optionally delete old file
      try {
        await this.storage.delete(existing[0].filePath);
      } catch {
        // Ignore if file already gone
      }
    }

    const id = randomUUID();
    const filename = `${id}.png`;
    const storagePath = `${orgId}/signatures/${filename}`;

    // Write PNG to private storage directory
    await this.storage.write(storagePath, pngData);

    // Insert record into database
    const now = new Date();
    await this.db.insert(userSignatures).values({
      id,
      orgId,
      userId,
      filePath: storagePath,
      capturedAt: now,
    });

    return {
      id,
      userId,
      orgId,
      filePath: storagePath,
      capturedAt: now.toISOString(),
    };
  }

  /**
   * Get the current (non-revoked) signature for a user in an org
   */
  async getMySignature(
    orgId: string,
    userId: string,
  ): Promise<SignatureRecord | null> {
    const results = await this.db
      .select()
      .from(userSignatures)
      .where(
        and(
          eq(userSignatures.orgId, orgId),
          eq(userSignatures.userId, userId),
          isNull(userSignatures.revokedAt),
        ),
      );

    if (results.length === 0) return null;
    return results[0] as SignatureRecord;
  }

  /**
   * Get a signature by ID (regardless of revocation status)
   */
  async getSignatureById(
    orgId: string,
    signatureId: string,
  ): Promise<SignatureRecord | null> {
    const results = await this.db
      .select()
      .from(userSignatures)
      .where(
        and(
          eq(userSignatures.orgId, orgId),
          eq(userSignatures.id, signatureId),
        ),
      );

    if (results.length === 0) return null;
    return results[0] as SignatureRecord;
  }

  /**
   * Read the signature file from storage
   */
  async readSignatureFile(filePath: string): Promise<Buffer> {
    return this.storage.read(filePath);
  }

  /**
   * Check if a signature file exists in storage
   */
  async signatureFileExists(filePath: string): Promise<boolean> {
    return this.storage.exists(filePath);
  }

  /**
   * Revoke a user's current signature
   */
  async revoke(
    orgId: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.getMySignature(orgId, userId);
    if (!existing) return false;

    await this.db
      .update(userSignatures)
      .set({ revokedAt: new Date() })
      .where(eq(userSignatures.id, existing.id));

    return true;
  }
}
