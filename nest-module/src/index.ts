/**
 * @pdfme-erp/nest
 *
 * NestJS integration module for pdfme ERP Edition.
 * Provides template management, PDF rendering, data source registry,
 * file storage, and REST API controllers.
 */

export { PdfmeErpModule } from './pdfme-erp.module';
export { TemplateService } from './template.service';
export { TemplateController } from './template.controller';
export { RenderService } from './render.service';
export { RenderController } from './render.controller';
export { DataSourceRegistry } from './datasource.registry';
export { FieldSchemaRegistry } from './field-schema.registry';
export { FileStorageService } from './file-storage.service';
export { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
export { PageScopeResolver } from './page-scope-resolver';
export { PdfaProcessor } from './pdfa-processor';
export { AuditService } from './audit.service';

// Types
export type { PdfmeErpModuleConfig, DataSource } from './types';
