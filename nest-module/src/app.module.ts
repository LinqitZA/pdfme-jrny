/**
 * AppModule - Root NestJS module for pdfme ERP Edition
 *
 * Provides database connection, health checks, and template management.
 */

import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema';
import { getDatabaseUrl, type PdfmeDatabase } from './db/connection';
import { HealthController } from './health.controller';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  controllers: [HealthController, TemplateController],
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
    TemplateService,
  ],
  exports: ['PG_POOL', 'DRIZZLE_DB', TemplateService],
})
export class AppModule {}
