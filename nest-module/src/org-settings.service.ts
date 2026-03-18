/**
 * OrgSettingsService - Per-org configuration management
 *
 * Manages organization-level settings such as PDF/UA accessibility tagging,
 * PDF/A compliance, and other feature flags.
 *
 * Settings are stored in-memory with an API to get/update them.
 * In production, these would be backed by a database table.
 */

import { Injectable } from '@nestjs/common';

export interface OrgSettings {
  /** Enable PDF/UA accessibility tagging on rendered documents */
  pdfUA: boolean;
  /** Enable PDF/A-3b conversion (default: true) */
  pdfA: boolean;
  /** Per-tenant document storage quota in bytes (null = use global default) */
  documentsQuotaBytes: number | null;
  /** Per-tenant asset storage quota in bytes (null = use global default) */
  assetsQuotaBytes: number | null;
  /** Additional org-level feature flags */
  [key: string]: unknown;
}

const DEFAULT_SETTINGS: OrgSettings = {
  pdfUA: false,
  pdfA: true,
  documentsQuotaBytes: null,
  assetsQuotaBytes: null,
};

@Injectable()
export class OrgSettingsService {
  /** In-memory store of org settings, keyed by orgId */
  private readonly store = new Map<string, OrgSettings>();

  /**
   * Get settings for an organization.
   * Returns default settings if none are configured.
   */
  get(orgId: string): OrgSettings {
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
  update(orgId: string, partial: Partial<OrgSettings>): OrgSettings {
    const current = this.get(orgId);
    const updated = { ...current, ...partial };
    this.store.set(orgId, updated);
    return updated;
  }

  /**
   * Check if PDF/UA is enabled for an org.
   */
  isPdfUAEnabled(orgId: string): boolean {
    return this.get(orgId).pdfUA === true;
  }

  /**
   * Check if PDF/A is enabled for an org.
   */
  isPdfAEnabled(orgId: string): boolean {
    return this.get(orgId).pdfA !== false;
  }

  /**
   * Get the effective document storage quota for an org (in bytes).
   * Returns the per-org override if set, otherwise null (meaning use global default).
   */
  getDocumentsQuotaBytes(orgId: string): number | null {
    const settings = this.get(orgId);
    return settings.documentsQuotaBytes ?? null;
  }

  /**
   * Reset settings for an org to defaults.
   */
  reset(orgId: string): OrgSettings {
    this.store.delete(orgId);
    return { ...DEFAULT_SETTINGS };
  }
}
