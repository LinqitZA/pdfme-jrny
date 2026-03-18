/**
 * AppModule - Root NestJS module for pdfme ERP Edition
 *
 * Provides database connection, health checks, template management, and asset storage.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { JwtAuthGuard } from './auth.guard';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';

const STORAGE_ROOT = process.env.PDFME_STORAGE_ROOT || path.join(process.cwd(), 'storage');
const STORAGE_TEMP = process.env.PDFME_STORAGE_TEMP || path.join(process.cwd(), 'storage', 'tmp');

@Module({
  controllers: [HealthController, TemplateController, AssetController, SignatureController, RenderController],
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
    TemplateService,
    AssetService,
    SignatureService,
    RenderService,
  ],
  exports: ['PG_POOL', 'DRIZZLE_DB', 'FILE_STORAGE', TemplateService, AssetService, SignatureService, RenderService],
})
export class AppModule {}
