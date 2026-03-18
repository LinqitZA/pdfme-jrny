/**
 * main.ts - Bootstrap the NestJS application for pdfme ERP Edition
 *
 * Runs database migrations, then starts the NestJS HTTP server.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { runMigrations } from './db/migrate';
import { GlobalExceptionFilter } from './global-exception.filter';

async function bootstrap() {
  const port = parseInt(process.env.PORT || '3001', 10);

  // Run migrations first
  console.log('[pdfme-erp] Starting pdfme ERP Edition server...');
  await runMigrations();

  // Create and start NestJS app
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  // Enable CORS for development
  app.enableCors();

  // Set global body size limit (50MB for JSON payloads like template import)
  app.useBodyParser('json', { limit: '50mb' });

  // Enable raw body parser for ZIP file uploads (backup import)
  app.useBodyParser('raw', { limit: '100mb', type: ['application/zip', 'application/octet-stream'] });

  // Register global exception filter to sanitize error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(port);
  console.log(`[pdfme-erp] Server running on http://localhost:${port}`);
  console.log(`[pdfme-erp] Health check: http://localhost:${port}/api/pdfme/health`);
  console.log(`[pdfme-erp] Templates API: http://localhost:${port}/api/pdfme/templates`);
}

bootstrap().catch((err) => {
  console.error('[pdfme-erp] Failed to start server:', err);
  process.exit(1);
});
