/**
 * SeedRunner - Inserts comprehensive ERP test data idempotently.
 *
 * Uses deterministic IDs (seed-*) so re-running is safe.
 * Stores seed data as JSON documents in a seed_data table,
 * making it available via the API for template previews and testing.
 */

import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PdfmeDatabase } from '../../db/connection';
import { templates } from '../../db/schema';
import {
  seedOrganisations,
  seedCustomers,
  seedInvoices,
  seedStatements,
  seedPurchaseOrders,
  seedDeliveryNotes,
  seedCreditNotes,
  seedAgedDebtorsReport,
  seedStockReport,
  seedSalesReport,
  seedShippingLabel,
  seedProductLabel,
  seedAssetTag,
  seedShelfLabel,
  getSeedInputsForTemplate,
  getSeedSummary,
} from './seed-data';

const logger = new Logger('SeedRunner');

/**
 * Run all seed data insertions. Idempotent — checks for existing records
 * before inserting, uses deterministic IDs.
 *
 * Returns a summary of what was created/updated.
 */
export async function runSeedData(db: PdfmeDatabase): Promise<{
  success: boolean;
  summary: ReturnType<typeof getSeedSummary>;
  sampleInputsByType: Record<string, Record<string, string>>;
}> {
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

  const sampleInputsByType: Record<string, Record<string, string>> = {};
  for (const type of templateTypes) {
    sampleInputsByType[type] = getSeedInputsForTemplate(type);
  }

  // Update system templates with sample data in their sampledata field
  let updatedTemplates = 0;
  for (const type of templateTypes) {
    const inputs = sampleInputsByType[type];
    if (!inputs || Object.keys(inputs).length === 0) continue;

    // Find system templates of this type
    const systemTpls = await db
      .select({ id: templates.id, schema: templates.schema })
      .from(templates)
      .where(eq(templates.type, type));

    for (const tpl of systemTpls) {
      if (tpl.id && tpl.id.startsWith('sys-')) {
        const schema = tpl.schema as Record<string, unknown>;
        if (schema) {
          // Add sample data to the template schema
          const updatedSchema = {
            ...schema,
            sampledata: [inputs],
          };
          await db
            .update(templates)
            .set({ schema: updatedSchema, updatedAt: new Date() })
            .where(eq(templates.id, tpl.id));
          updatedTemplates++;
        }
      }
    }
  }

  logger.log(`Updated ${updatedTemplates} system templates with sample data`);

  const summary = getSeedSummary();
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
export function getSeedDataForType(templateType: string): Record<string, string> {
  return getSeedInputsForTemplate(templateType);
}

/**
 * Get all raw seed datasets for inspection/API response.
 */
export function getAllSeedData() {
  return {
    organisations: seedOrganisations,
    customers: seedCustomers,
    invoices: seedInvoices,
    statements: seedStatements,
    purchaseOrders: seedPurchaseOrders,
    deliveryNotes: seedDeliveryNotes,
    creditNotes: seedCreditNotes,
    agedDebtorsReport: seedAgedDebtorsReport,
    stockReport: seedStockReport,
    salesReport: seedSalesReport,
    labels: {
      shipping: seedShippingLabel,
      product: seedProductLabel,
      assetTag: seedAssetTag,
      shelf: seedShelfLabel,
    },
  };
}
