"use strict";
/**
 * SignatureService - Manages user signature upload, retrieval, and revocation
 *
 * Stores signature PNG files in private org directory: {orgId}/signatures/
 * Records metadata in user_signatures table with unique constraint per org+user.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const file_storage_service_1 = require("./file-storage.service");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("./db/schema");
const crypto_1 = require("crypto");
let SignatureService = class SignatureService {
    db;
    storage;
    constructor(db, storage) {
        this.db = db;
        this.storage = storage;
    }
    /**
     * Upload a signature PNG for a user. If the user already has an active signature,
     * revoke the old one first (unique constraint on org_id + user_id).
     */
    async upload(orgId, userId, pngData) {
        // Delete any existing signature for this user+org (unique constraint: one per user per org)
        const existing = await this.db
            .select()
            .from(schema_1.userSignatures)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userSignatures.orgId, orgId), (0, drizzle_orm_1.eq)(schema_1.userSignatures.userId, userId)));
        if (existing.length > 0) {
            // Delete old signature record (unique index allows only one per user+org)
            await this.db
                .delete(schema_1.userSignatures)
                .where((0, drizzle_orm_1.eq)(schema_1.userSignatures.id, existing[0].id));
            // Optionally delete old file
            try {
                await this.storage.delete(existing[0].filePath);
            }
            catch {
                // Ignore if file already gone
            }
        }
        const id = (0, crypto_1.randomUUID)();
        const filename = `${id}.png`;
        const storagePath = `${orgId}/signatures/${filename}`;
        // Write PNG to private storage directory
        await this.storage.write(storagePath, pngData);
        // Insert record into database
        const now = new Date();
        await this.db.insert(schema_1.userSignatures).values({
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
    async getMySignature(orgId, userId) {
        const results = await this.db
            .select()
            .from(schema_1.userSignatures)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userSignatures.orgId, orgId), (0, drizzle_orm_1.eq)(schema_1.userSignatures.userId, userId), (0, drizzle_orm_1.isNull)(schema_1.userSignatures.revokedAt)));
        if (results.length === 0)
            return null;
        return results[0];
    }
    /**
     * Get a signature by ID (regardless of revocation status)
     */
    async getSignatureById(orgId, signatureId) {
        const results = await this.db
            .select()
            .from(schema_1.userSignatures)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userSignatures.orgId, orgId), (0, drizzle_orm_1.eq)(schema_1.userSignatures.id, signatureId)));
        if (results.length === 0)
            return null;
        return results[0];
    }
    /**
     * Read the signature file from storage
     */
    async readSignatureFile(filePath) {
        return this.storage.read(filePath);
    }
    /**
     * Check if a signature file exists in storage
     */
    async signatureFileExists(filePath) {
        return this.storage.exists(filePath);
    }
    /**
     * Revoke a user's current signature
     */
    async revoke(orgId, userId) {
        const existing = await this.getMySignature(orgId, userId);
        if (!existing)
            return false;
        await this.db
            .update(schema_1.userSignatures)
            .set({ revokedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.userSignatures.id, existing.id));
        return true;
    }
};
exports.SignatureService = SignatureService;
exports.SignatureService = SignatureService = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)('DRIZZLE_DB')),
    tslib_1.__param(1, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__metadata("design:paramtypes", [Object, file_storage_service_1.FileStorageService])
], SignatureService);
//# sourceMappingURL=signature.service.js.map