"use strict";
/**
 * OrgSettingsService - Per-org configuration management
 *
 * Manages organization-level settings such as PDF/UA accessibility tagging,
 * PDF/A compliance, and other feature flags.
 *
 * Settings are stored in-memory with an API to get/update them.
 * In production, these would be backed by a database table.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgSettingsService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const DEFAULT_SETTINGS = {
    pdfUA: false,
    pdfA: true,
    documentsQuotaBytes: null,
    assetsQuotaBytes: null,
};
let OrgSettingsService = class OrgSettingsService {
    /** In-memory store of org settings, keyed by orgId */
    store = new Map();
    /**
     * Get settings for an organization.
     * Returns default settings if none are configured.
     */
    get(orgId) {
        const stored = this.store.get(orgId);
        if (!stored) {
            return { ...DEFAULT_SETTINGS };
        }
        return { ...DEFAULT_SETTINGS, ...stored };
    }
    /**
     * Update settings for an organization.
     * Merges with existing settings (partial update).
     */
    update(orgId, partial) {
        const current = this.get(orgId);
        const updated = { ...current, ...partial };
        this.store.set(orgId, updated);
        return updated;
    }
    /**
     * Check if PDF/UA is enabled for an org.
     */
    isPdfUAEnabled(orgId) {
        return this.get(orgId).pdfUA === true;
    }
    /**
     * Check if PDF/A is enabled for an org.
     */
    isPdfAEnabled(orgId) {
        return this.get(orgId).pdfA !== false;
    }
    /**
     * Get the effective document storage quota for an org (in bytes).
     * Returns the per-org override if set, otherwise null (meaning use global default).
     */
    getDocumentsQuotaBytes(orgId) {
        const settings = this.get(orgId);
        return settings.documentsQuotaBytes ?? null;
    }
    /**
     * Reset settings for an org to defaults.
     */
    reset(orgId) {
        this.store.delete(orgId);
        return { ...DEFAULT_SETTINGS };
    }
};
exports.OrgSettingsService = OrgSettingsService;
exports.OrgSettingsService = OrgSettingsService = tslib_1.__decorate([
    (0, common_1.Injectable)()
], OrgSettingsService);
//# sourceMappingURL=org-settings.service.js.map