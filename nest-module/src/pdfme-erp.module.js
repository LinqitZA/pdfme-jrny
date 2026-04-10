"use strict";
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
var PdfmeErpModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfmeErpModule = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const local_disk_storage_adapter_1 = require("./local-disk-storage.adapter");
const template_controller_1 = require("./template.controller");
const template_service_1 = require("./template.service");
const asset_controller_1 = require("./asset.controller");
const asset_service_1 = require("./asset.service");
const signature_controller_1 = require("./signature.controller");
const signature_service_1 = require("./signature.service");
const render_controller_1 = require("./render.controller");
const render_service_1 = require("./render.service");
const health_controller_1 = require("./health.controller");
const config_controller_1 = require("./config.controller");
const field_schema_controller_1 = require("./field-schema.controller");
const field_schema_registry_1 = require("./field-schema.registry");
const audit_controller_1 = require("./audit.controller");
const audit_service_1 = require("./audit.service");
const expression_controller_1 = require("./expression.controller");
const grouped_table_controller_1 = require("./grouped-table.controller");
const watermark_controller_1 = require("./watermark.controller");
const pdfa_processor_1 = require("./pdfa-processor");
const datasource_registry_1 = require("./datasource.registry");
const datasource_controller_1 = require("./datasource.controller");
const font_controller_1 = require("./font.controller");
const render_queue_controller_1 = require("./render-queue.controller");
const render_queue_service_1 = require("./render-queue.service");
const auth_guard_1 = require("./auth.guard");
const seed_service_1 = require("./seeds/seed.service");
const hash_service_1 = require("./hash.service");
const org_settings_service_1 = require("./org-settings.service");
const org_settings_controller_1 = require("./org-settings.controller");
const printer_service_1 = require("./printer.service");
const printer_controller_1 = require("./printer.controller");
const rate_limiter_service_1 = require("./rate-limiter.service");
const print_job_service_1 = require("./print-job.service");
const system_controller_1 = require("./system.controller");
let PdfmeErpModule = PdfmeErpModule_1 = class PdfmeErpModule {
    /**
     * Register the PdfmeErpModule with full configuration.
     *
     * Creates all controllers, services, and providers needed for the
     * pdfme ERP document engine, using the provided configuration for
     * storage, JWT, Redis, database, and optional rate limits/quotas.
     */
    static register(config) {
        const storageProvider = {
            provide: 'FILE_STORAGE',
            useFactory: () => {
                return new local_disk_storage_adapter_1.LocalDiskStorageAdapter(config.storage.rootDir, config.storage.tempDir);
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
            useFactory: () => new field_schema_registry_1.FieldSchemaRegistry(),
        };
        // PG_POOL - use provided pool or create a no-op placeholder
        const pgPoolProvider = {
            provide: 'PG_POOL',
            useFactory: () => {
                // When a pgPool is provided via config, use it for health checks etc.
                // Otherwise, provide null (standalone usage creates its own pool).
                return config.database.pgPool || null;
            },
        };
        return {
            module: PdfmeErpModule_1,
            controllers: [
                health_controller_1.HealthController,
                template_controller_1.TemplateController,
                asset_controller_1.AssetController,
                signature_controller_1.SignatureController,
                render_controller_1.RenderController,
                config_controller_1.ConfigController,
                field_schema_controller_1.FieldSchemaController,
                audit_controller_1.AuditController,
                expression_controller_1.ExpressionController,
                grouped_table_controller_1.GroupedTableController,
                watermark_controller_1.WatermarkController,
                datasource_controller_1.DataSourceController,
                font_controller_1.FontController,
                render_queue_controller_1.RenderQueueController,
                org_settings_controller_1.OrgSettingsController,
                printer_controller_1.PrinterController,
                system_controller_1.SystemController,
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
                    provide: core_1.APP_GUARD,
                    useClass: auth_guard_1.JwtAuthGuard,
                },
                template_service_1.TemplateService,
                asset_service_1.AssetService,
                signature_service_1.SignatureService,
                render_service_1.RenderService,
                audit_service_1.AuditService,
                seed_service_1.SeedService,
                pdfa_processor_1.PdfaProcessor,
                datasource_registry_1.DataSourceRegistry,
                render_queue_service_1.RenderQueueService,
                hash_service_1.HashService,
                org_settings_service_1.OrgSettingsService,
                printer_service_1.PrinterService,
                rate_limiter_service_1.RateLimiterService,
                print_job_service_1.PrintJobService,
            ],
            exports: [
                'DRIZZLE_DB',
                'FILE_STORAGE',
                'FIELD_SCHEMA_REGISTRY',
                'PDFME_MODULE_CONFIG',
                'JWT_CONFIG',
                'REDIS_CONFIG',
                template_service_1.TemplateService,
                asset_service_1.AssetService,
                signature_service_1.SignatureService,
                render_service_1.RenderService,
                audit_service_1.AuditService,
                pdfa_processor_1.PdfaProcessor,
                datasource_registry_1.DataSourceRegistry,
                render_queue_service_1.RenderQueueService,
                hash_service_1.HashService,
            ],
        };
    }
};
exports.PdfmeErpModule = PdfmeErpModule;
exports.PdfmeErpModule = PdfmeErpModule = PdfmeErpModule_1 = tslib_1.__decorate([
    (0, common_1.Module)({})
], PdfmeErpModule);
//# sourceMappingURL=pdfme-erp.module.js.map