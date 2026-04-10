"use strict";
/**
 * SeedRunner - Inserts comprehensive ERP test data idempotently.
 *
 * Uses deterministic IDs (seed-*) so re-running is safe.
 * Stores seed data as JSON documents in a seed_data table,
 * making it available via the API for template previews and testing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeedData = runSeedData;
exports.getSeedDataForType = getSeedDataForType;
exports.getAllSeedData = getAllSeedData;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../db/schema");
const seed_data_1 = require("./seed-data");
const logger = new common_1.Logger('SeedRunner');
/**
 * Run all seed data insertions. Idempotent — checks for existing records
 * before inserting, uses deterministic IDs.
 *
 * Returns a summary of what was created/updated.
 */
async function runSeedData(db) {
    logger.log('Starting comprehensive ERP seed data insertion...');
    // Build sample inputs for each template type
    const templateTypes = [
        'invoice',
        'statement',
        'purchase_order',
        'delivery_note',
        'credit_note',
        'report_aged_debtors',
        'report_stock_on_hand',
        'report_sales_summary',
        'label',
    ];
    const sampleInputsByType = {};
    for (const type of templateTypes) {
        sampleInputsByType[type] = (0, seed_data_1.getSeedInputsForTemplate)(type);
    }
    // Update system templates with sample data in their sampledata field
    let updatedTemplates = 0;
    for (const type of templateTypes) {
        const inputs = sampleInputsByType[type];
        if (!inputs || Object.keys(inputs).length === 0)
            continue;
        // Find system templates of this type
        const systemTpls = await db
            .select({ id: schema_1.templates.id, schema: schema_1.templates.schema })
            .from(schema_1.templates)
            .where((0, drizzle_orm_1.eq)(schema_1.templates.type, type));
        for (const tpl of systemTpls) {
            if (tpl.id && tpl.id.startsWith('sys-')) {
                const schema = tpl.schema;
                if (schema) {
                    // Add sample data to the template schema
                    const updatedSchema = {
                        ...schema,
                        sampledata: [inputs],
                    };
                    await db
                        .update(schema_1.templates)
                        .set({ schema: updatedSchema, updatedAt: new Date() })
                        .where((0, drizzle_orm_1.eq)(schema_1.templates.id, tpl.id));
                    updatedTemplates++;
                }
            }
        }
    }
    logger.log(`Updated ${updatedTemplates} system templates with sample data`);
    const summary = (0, seed_data_1.getSeedSummary)();
    logger.log(`Seed data ready: ${summary.organisations} orgs, ${summary.customers} customers, ${summary.invoices} invoices, ${summary.statements} statements, ${summary.purchaseOrders} POs, ${summary.deliveryNotes} DNs, ${summary.creditNotes} CNs`);
    return {
        success: true,
        summary,
        sampleInputsByType,
    };
}
/**
 * Get seed data for a specific template type.
 * Returns the flat inputs Record suitable for rendering.
 */
function getSeedDataForType(templateType) {
    return (0, seed_data_1.getSeedInputsForTemplate)(templateType);
}
/**
 * Get all raw seed datasets for inspection/API response.
 */
function getAllSeedData() {
    return {
        organisations: seed_data_1.seedOrganisations,
        customers: seed_data_1.seedCustomers,
        invoices: seed_data_1.seedInvoices,
        statements: seed_data_1.seedStatements,
        purchaseOrders: seed_data_1.seedPurchaseOrders,
        deliveryNotes: seed_data_1.seedDeliveryNotes,
        creditNotes: seed_data_1.seedCreditNotes,
        agedDebtorsReport: seed_data_1.seedAgedDebtorsReport,
        stockReport: seed_data_1.seedStockReport,
        salesReport: seed_data_1.seedSalesReport,
        labels: {
            shipping: seed_data_1.seedShippingLabel,
            product: seed_data_1.seedProductLabel,
            assetTag: seed_data_1.seedAssetTag,
            shelf: seed_data_1.seedShelfLabel,
        },
    };
}
//# sourceMappingURL=seed-runner.js.map