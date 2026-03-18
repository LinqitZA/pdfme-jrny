/**
 * PdfmeErpModule - NestJS module for pdfme ERP Edition
 *
 * Usage:
 * PdfmeErpModule.register({
 *   storage: { rootDir, tempDir, tempRetentionMinutes },
 *   jwt: { secret, algorithm, claimsMapping },
 *   redis: { host, port },
 *   database: { drizzleClient },
 *   apiPrefix: '/api/pdfme',
 *   ...
 * })
 */

import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { PdfmeErpModuleConfig } from './types';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { SignatureController } from './signature.controller';
import { SignatureService } from './signature.service';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';
import { HealthController } from './health.controller';
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
import { JwtAuthGuard } from './auth.guard';
import { SeedService } from './seeds/seed.service';
import { HashService } from './hash.service';

@Module({})
export class PdfmeErpModule {
  /**
   * Register the PdfmeErpModule with full configuration.
   *
   * Creates all controllers, services, and providers needed for the
   * pdfme ERP document engine, using the provided configuration for
   * storage, JWT, Redis, database, and optional rate limits/quotas.
   */
  static register(config: PdfmeErpModuleConfig): DynamicModule {
    const storageProvider = {
      provide: 'FILE_STORAGE',
      useFactory: () => {
        return new LocalDiskStorageAdapter(
          config.storage.rootDir,
          config.storage.tempDir,
        );
      },
    };

    const databaseProvider = {
      provide: 'DRIZZLE_DB',
      useFactory: () => config.database.drizzleClient,
    };

    const jwtConfigProvider = {
      provide: 'JWT_CONFIG',
      useValue: {
        secret: config.jwt.secret,
        algorithm: config.jwt.algorithm || 'HS256',
        claimsMapping: {
          userId: config.jwt.claimsMapping?.userId || 'sub',
          orgId: config.jwt.claimsMapping?.orgId || 'orgId',
          roles: config.jwt.claimsMapping?.roles || 'roles',
        },
      },
    };

    const redisConfigProvider = {
      provide: 'REDIS_CONFIG',
      useValue: {
        host: config.redis.host,
        port: config.redis.port,
      },
    };

    const moduleConfigProvider = {
      provide: 'PDFME_MODULE_CONFIG',
      useValue: {
        apiPrefix: config.apiPrefix || '/api/pdfme',
        rateLimits: {
          renderNow: config.rateLimits?.renderNow ?? 60,
          renderQueue: config.rateLimits?.renderQueue ?? 120,
          renderBulk: config.rateLimits?.renderBulk ?? 5,
          bulkMaxEntityIds: config.rateLimits?.bulkMaxEntityIds ?? 2000,
        },
        quotas: {
          documentsBytes: config.quotas?.documentsBytes ?? 5 * 1024 * 1024 * 1024,
          assetsBytes: config.quotas?.assetsBytes ?? 500 * 1024 * 1024,
        },
        queue: {
          defaultConcurrency: config.queue?.defaultConcurrency ?? 5,
          maxConcurrency: config.queue?.maxConcurrency ?? 20,
        },
        ghostscript: {
          binary: config.ghostscript?.binary || 'gs',
        },
        verapdf: {
          binary: config.verapdf?.binary || 'verapdf',
        },
        storage: {
          tempRetentionMinutes: config.storage.tempRetentionMinutes ?? 60,
        },
        hashing: {
          algorithm: config.hashing?.algorithm || 'sha256',
        },
      },
    };

    const fieldSchemaRegistryProvider = {
      provide: 'FIELD_SCHEMA_REGISTRY',
      useFactory: () => new FieldSchemaRegistry(),
    };

    // PG_POOL placeholder - if database.drizzleClient provides its own pool
    const pgPoolProvider = {
      provide: 'PG_POOL',
      useFactory: () => {
        // When using register(), the drizzle client is provided externally.
        // PG_POOL is for standalone usage; here we provide a no-op placeholder.
        return null;
      },
    };

    return {
      module: PdfmeErpModule,
      controllers: [
        HealthController,
        TemplateController,
        AssetController,
        SignatureController,
        RenderController,
        ConfigController,
        FieldSchemaController,
        AuditController,
        ExpressionController,
        GroupedTableController,
        WatermarkController,
        DataSourceController,
        FontController,
        RenderQueueController,
      ],
      providers: [
        storageProvider,
        databaseProvider,
        jwtConfigProvider,
        redisConfigProvider,
        moduleConfigProvider,
        fieldSchemaRegistryProvider,
        pgPoolProvider,
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
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
        HashService,
      ],
      exports: [
        'DRIZZLE_DB',
        'FILE_STORAGE',
        'FIELD_SCHEMA_REGISTRY',
        'PDFME_MODULE_CONFIG',
        'JWT_CONFIG',
        'REDIS_CONFIG',
        TemplateService,
        AssetService,
        SignatureService,
        RenderService,
        AuditService,
        PdfaProcessor,
        DataSourceRegistry,
        RenderQueueService,
        HashService,
      ],
    };
  }
}
