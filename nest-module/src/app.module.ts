/**
 * AppModule - Root NestJS module for pdfme ERP Edition
 *
 * Provides database connection, health checks, template management, and asset storage.
 */

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ContentTypeMiddleware } from './content-type.middleware';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as path from 'path';
import * as schema from './db/schema';
import { getDatabaseUrl, type PdfmeDatabase } from './db/connection';
import { HealthController } from './health.controller';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { SignatureController } from './signature.controller';
import { SignatureService } from './signature.service';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { JwtAuthGuard, PermissionsGuard } from './auth.guard';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';
import { SeedService } from './seeds/seed.service';
import { ConfigController } from './config.controller';
import { FieldSchemaController } from './field-schema.controller';
import { FieldSchemaRegistry } from './field-schema.registry';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ExpressionController } from './expression.controller';
import { GroupedTableController } from './grouped-table.controller';
import { WatermarkController } from './watermark.controller';
import { PdfaProcessor } from './pdfa-processor';
import { DataSourceRegistry } from './datasource.registry';
import { DataSourceController } from './datasource.controller';
import { FontController } from './font.controller';
import { RenderQueueController } from './render-queue.controller';
import { RenderQueueService } from './render-queue.service';
import { OrgSettingsController } from './org-settings.controller';
import { OrgSettingsService } from './org-settings.service';
import { SystemController } from './system.controller';
import { RateLimiterService } from './rate-limiter.service';
import { HashService } from './hash.service';
import { PrinterController } from './printer.controller';
import { PrinterService } from './printer.service';
import { PrintJobService } from './print-job.service';

const STORAGE_ROOT = process.env.PDFME_STORAGE_ROOT || path.join(process.cwd(), 'storage');
const STORAGE_TEMP = process.env.PDFME_STORAGE_TEMP || path.join(process.cwd(), 'storage', 'tmp');

@Module({
  controllers: [HealthController, TemplateController, AssetController, SignatureController, RenderController, ConfigController, FieldSchemaController, AuditController, ExpressionController, GroupedTableController, WatermarkController, DataSourceController, FontController, RenderQueueController, OrgSettingsController, SystemController, PrinterController],
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: () => {
        const pool = new Pool({
          connectionString: getDatabaseUrl(),
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        return pool;
      },
    },
    {
      provide: 'DRIZZLE_DB',
      useFactory: (pool: Pool): PdfmeDatabase => {
        return drizzle(pool, { schema, logger: true });
      },
      inject: ['PG_POOL'],
    },
    {
      provide: 'FILE_STORAGE',
      useFactory: () => {
        return new LocalDiskStorageAdapter(STORAGE_ROOT, STORAGE_TEMP);
      },
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: 'FIELD_SCHEMA_REGISTRY',
      useFactory: () => {
        const registry = new FieldSchemaRegistry();
        // Register default field schemas for common ERP document types
        registry.register('invoice', [
          {
            key: 'document',
            label: 'Document',
            fields: [
              { key: 'document.number', label: 'Invoice Number', type: 'string', exampleValue: 'INV-2026-001' },
              { key: 'document.date', label: 'Invoice Date', type: 'date', exampleValue: '2026-03-18' },
              { key: 'document.dueDate', label: 'Due Date', type: 'date', exampleValue: '2026-04-17' },
              { key: 'document.reference', label: 'Reference', type: 'string', exampleValue: 'PO-12345' },
              { key: 'document.status', label: 'Status', type: 'string', exampleValue: 'Outstanding' },
            ],
          },
          {
            key: 'customer',
            label: 'Customer',
            fields: [
              { key: 'customer.name', label: 'Customer Name', type: 'string', exampleValue: 'Acme Corp' },
              { key: 'customer.email', label: 'Email', type: 'string', exampleValue: 'accounts@acme.com' },
              { key: 'customer.phone', label: 'Phone', type: 'string', exampleValue: '+27 11 123 4567' },
              { key: 'customer.address', label: 'Address', type: 'string', exampleValue: '123 Main St, Johannesburg' },
              { key: 'customer.vatNumber', label: 'VAT Number', type: 'string', exampleValue: '4123456789' },
            ],
          },
          {
            key: 'company',
            label: 'Company',
            fields: [
              { key: 'company.name', label: 'Company Name', type: 'string', exampleValue: 'My Company (Pty) Ltd' },
              { key: 'company.regNumber', label: 'Registration Number', type: 'string', exampleValue: '2020/123456/07' },
              { key: 'company.vatNumber', label: 'VAT Number', type: 'string', exampleValue: '4987654321' },
              { key: 'company.address', label: 'Address', type: 'string', exampleValue: '456 Business Ave, Cape Town' },
            ],
          },
          {
            key: 'totals',
            label: 'Totals',
            fields: [
              { key: 'totals.subtotal', label: 'Subtotal', type: 'currency', exampleValue: 10000.00 },
              { key: 'totals.vatAmount', label: 'VAT Amount', type: 'currency', exampleValue: 1500.00 },
              { key: 'totals.total', label: 'Total', type: 'currency', exampleValue: 11500.00 },
              { key: 'totals.amountDue', label: 'Amount Due', type: 'currency', exampleValue: 11500.00 },
            ],
          },
          {
            key: 'lineItems',
            label: 'Line Items',
            fields: [
              { key: 'lineItems[].description', label: 'Description', type: 'string', exampleValue: 'Widget A' },
              { key: 'lineItems[].quantity', label: 'Quantity', type: 'number', exampleValue: 10 },
              { key: 'lineItems[].unitPrice', label: 'Unit Price', type: 'currency', exampleValue: 1000.00 },
              { key: 'lineItems[].amount', label: 'Line Amount', type: 'currency', exampleValue: 10000.00 },
            ],
          },
        ]);
        registry.register('statement', [
          {
            key: 'document',
            label: 'Document',
            fields: [
              { key: 'document.date', label: 'Statement Date', type: 'date', exampleValue: '2026-03-31' },
              { key: 'document.period', label: 'Period', type: 'string', exampleValue: 'March 2026' },
            ],
          },
          {
            key: 'customer',
            label: 'Customer',
            fields: [
              { key: 'customer.name', label: 'Customer Name', type: 'string', exampleValue: 'Acme Corp' },
              { key: 'customer.accountNumber', label: 'Account Number', type: 'string', exampleValue: 'ACC-001' },
              { key: 'customer.address', label: 'Address', type: 'string', exampleValue: '123 Main St, Johannesburg' },
            ],
          },
          {
            key: 'totals',
            label: 'Totals',
            fields: [
              { key: 'totals.openingBalance', label: 'Opening Balance', type: 'currency', exampleValue: 5000.00 },
              { key: 'totals.closingBalance', label: 'Closing Balance', type: 'currency', exampleValue: 11500.00 },
              { key: 'totals.current', label: 'Current', type: 'currency', exampleValue: 3000.00 },
              { key: 'totals.days30', label: '30 Days', type: 'currency', exampleValue: 2000.00 },
              { key: 'totals.days60', label: '60 Days', type: 'currency', exampleValue: 500.00 },
              { key: 'totals.days90', label: '90+ Days', type: 'currency', exampleValue: 0 },
            ],
          },
        ]);
        registry.register('purchase_order', [
          {
            key: 'document',
            label: 'Document',
            fields: [
              { key: 'document.number', label: 'PO Number', type: 'string', exampleValue: 'PO-2026-001' },
              { key: 'document.date', label: 'PO Date', type: 'date', exampleValue: '2026-03-18' },
            ],
          },
          {
            key: 'supplier',
            label: 'Supplier',
            fields: [
              { key: 'supplier.name', label: 'Supplier Name', type: 'string', exampleValue: 'Parts Inc' },
              { key: 'supplier.address', label: 'Address', type: 'string', exampleValue: '789 Industrial Rd' },
            ],
          },
          {
            key: 'totals',
            label: 'Totals',
            fields: [
              { key: 'totals.subtotal', label: 'Subtotal', type: 'currency', exampleValue: 25000.00 },
              { key: 'totals.vatAmount', label: 'VAT Amount', type: 'currency', exampleValue: 3750.00 },
              { key: 'totals.total', label: 'Total', type: 'currency', exampleValue: 28750.00 },
            ],
          },
        ]);
        return registry;
      },
    },
    TemplateService,
    AssetService,
    SignatureService,
    RenderService,
    AuditService,
    SeedService,
    PdfaProcessor,
    DataSourceRegistry,
    RenderQueueService,
    OrgSettingsService,
    RateLimiterService,
    HashService,
    PrinterService,
    PrintJobService,
  ],
  exports: ['PG_POOL', 'DRIZZLE_DB', 'FILE_STORAGE', 'FIELD_SCHEMA_REGISTRY', TemplateService, AssetService, SignatureService, RenderService, AuditService, PdfaProcessor, DataSourceRegistry, RenderQueueService, OrgSettingsService, RateLimiterService, HashService, PrinterService, PrintJobService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContentTypeMiddleware).forRoutes('*');
  }
}
