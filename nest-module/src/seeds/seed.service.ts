/**
 * SeedService - Seeds system templates and ERP test data on application startup.
 * Idempotent: uses upsert (ON CONFLICT DO UPDATE) so re-running is safe.
 */

import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { templates } from '../db/schema';
import { systemTemplates } from './templates/system-templates';
import { runSeedData, getSeedDataForType, getAllSeedData } from './data/seed-runner';
import { getSeedSummary, getSeedInputsForTemplate } from './data/seed-data';
import type { PdfmeDatabase } from '../db/connection';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(@Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase) {}

  async onModuleInit() {
    await this.seedSystemTemplates();
    // Also seed sample data into system templates
    await this.seedSampleData();
  }

  async seedSystemTemplates() {
    this.logger.log(`Seeding ${systemTemplates.length} system templates...`);
    let created = 0;
    let updated = 0;

    for (const tpl of systemTemplates) {
      const existing = await this.db
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.id, tpl.id));

      if (existing.length > 0) {
        await this.db
          .update(templates)
          .set({
            type: tpl.type,
            name: tpl.name,
            schema: tpl.schema,
            updatedAt: new Date(),
          })
          .where(eq(templates.id, tpl.id));
        updated++;
      } else {
        const now = new Date();
        await this.db.insert(templates).values({
          id: tpl.id,
          orgId: null,
          type: tpl.type,
          name: tpl.name,
          schema: tpl.schema,
          status: 'published',
          version: 1,
          publishedVer: 1,
          createdBy: 'system',
          createdAt: now,
          updatedAt: now,
        });
        created++;
      }
    }

    this.logger.log(`System templates seeded: ${created} created, ${updated} updated`);
  }

  /**
   * Seed sample data into system templates for preview purposes.
   */
  async seedSampleData() {
    try {
      const result = await runSeedData(this.db);
      this.logger.log(`Sample data seeded: ${JSON.stringify(result.summary)}`);
      return result;
    } catch (error) {
      this.logger.warn(`Sample data seeding failed (non-fatal): ${error}`);
      return { success: false, summary: getSeedSummary(), sampleInputsByType: {} };
    }
  }

  /**
   * Get seed inputs for a specific template type.
   */
  getSeedInputsForType(templateType: string): Record<string, string> {
    return getSeedInputsForTemplate(templateType);
  }

  /**
   * Get all raw seed datasets.
   */
  getAllSeedData() {
    return getAllSeedData();
  }

  /**
   * Get summary of available seed data.
   */
  getSeedSummary() {
    return getSeedSummary();
  }
}
