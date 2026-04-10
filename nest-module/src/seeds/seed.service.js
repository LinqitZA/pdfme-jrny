"use strict";
/**
 * SeedService - Seeds system templates and ERP test data on application startup.
 * Idempotent: uses upsert (ON CONFLICT DO UPDATE) so re-running is safe.
 */
var SeedService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
const system_templates_1 = require("./templates/system-templates");
const seed_runner_1 = require("./data/seed-runner");
const seed_data_1 = require("./data/seed-data");
let SeedService = SeedService_1 = class SeedService {
    db;
    logger = new common_1.Logger(SeedService_1.name);
    constructor(db) {
        this.db = db;
    }
    async onModuleInit() {
        await this.seedSystemTemplates();
        // Also seed sample data into system templates
        await this.seedSampleData();
    }
    async seedSystemTemplates() {
        this.logger.log(`Seeding ${system_templates_1.systemTemplates.length} system templates...`);
        let created = 0;
        let updated = 0;
        for (const tpl of system_templates_1.systemTemplates) {
            const existing = await this.db
                .select({ id: schema_1.templates.id })
                .from(schema_1.templates)
                .where((0, drizzle_orm_1.eq)(schema_1.templates.id, tpl.id));
            if (existing.length > 0) {
                await this.db
                    .update(schema_1.templates)
                    .set({
                    type: tpl.type,
                    name: tpl.name,
                    schema: tpl.schema,
                    updatedAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.templates.id, tpl.id));
                updated++;
            }
            else {
                const now = new Date();
                await this.db.insert(schema_1.templates).values({
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
            const result = await (0, seed_runner_1.runSeedData)(this.db);
            this.logger.log(`Sample data seeded: ${JSON.stringify(result.summary)}`);
            return result;
        }
        catch (error) {
            this.logger.warn(`Sample data seeding failed (non-fatal): ${error}`);
            return { success: false, summary: (0, seed_data_1.getSeedSummary)(), sampleInputsByType: {} };
        }
    }
    /**
     * Get seed inputs for a specific template type.
     */
    getSeedInputsForType(templateType) {
        return (0, seed_data_1.getSeedInputsForTemplate)(templateType);
    }
    /**
     * Get all raw seed datasets.
     */
    getAllSeedData() {
        return (0, seed_runner_1.getAllSeedData)();
    }
    /**
     * Get summary of available seed data.
     */
    getSeedSummary() {
        return (0, seed_data_1.getSeedSummary)();
    }
};
exports.SeedService = SeedService;
exports.SeedService = SeedService = SeedService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)('DRIZZLE_DB')),
    tslib_1.__metadata("design:paramtypes", [Object])
], SeedService);
//# sourceMappingURL=seed.service.js.map