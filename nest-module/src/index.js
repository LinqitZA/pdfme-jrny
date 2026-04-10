"use strict";
/**
 * @pdfme-erp/nest
 *
 * NestJS integration module for pdfme ERP Edition.
 * Provides template management, PDF rendering, data source registry,
 * file storage, and REST API controllers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = exports.PdfaProcessor = exports.PageScopeResolver = exports.LocalDiskStorageAdapter = exports.FileStorageService = exports.FieldSchemaRegistry = exports.DataSourceRegistry = exports.RenderController = exports.RenderService = exports.TemplateController = exports.TemplateService = exports.PdfmeErpModule = void 0;
var pdfme_erp_module_1 = require("./pdfme-erp.module");
Object.defineProperty(exports, "PdfmeErpModule", { enumerable: true, get: function () { return pdfme_erp_module_1.PdfmeErpModule; } });
var template_service_1 = require("./template.service");
Object.defineProperty(exports, "TemplateService", { enumerable: true, get: function () { return template_service_1.TemplateService; } });
var template_controller_1 = require("./template.controller");
Object.defineProperty(exports, "TemplateController", { enumerable: true, get: function () { return template_controller_1.TemplateController; } });
var render_service_1 = require("./render.service");
Object.defineProperty(exports, "RenderService", { enumerable: true, get: function () { return render_service_1.RenderService; } });
var render_controller_1 = require("./render.controller");
Object.defineProperty(exports, "RenderController", { enumerable: true, get: function () { return render_controller_1.RenderController; } });
var datasource_registry_1 = require("./datasource.registry");
Object.defineProperty(exports, "DataSourceRegistry", { enumerable: true, get: function () { return datasource_registry_1.DataSourceRegistry; } });
var field_schema_registry_1 = require("./field-schema.registry");
Object.defineProperty(exports, "FieldSchemaRegistry", { enumerable: true, get: function () { return field_schema_registry_1.FieldSchemaRegistry; } });
var file_storage_service_1 = require("./file-storage.service");
Object.defineProperty(exports, "FileStorageService", { enumerable: true, get: function () { return file_storage_service_1.FileStorageService; } });
var local_disk_storage_adapter_1 = require("./local-disk-storage.adapter");
Object.defineProperty(exports, "LocalDiskStorageAdapter", { enumerable: true, get: function () { return local_disk_storage_adapter_1.LocalDiskStorageAdapter; } });
var page_scope_resolver_1 = require("./page-scope-resolver");
Object.defineProperty(exports, "PageScopeResolver", { enumerable: true, get: function () { return page_scope_resolver_1.PageScopeResolver; } });
var pdfa_processor_1 = require("./pdfa-processor");
Object.defineProperty(exports, "PdfaProcessor", { enumerable: true, get: function () { return pdfa_processor_1.PdfaProcessor; } });
var audit_service_1 = require("./audit.service");
Object.defineProperty(exports, "AuditService", { enumerable: true, get: function () { return audit_service_1.AuditService; } });
//# sourceMappingURL=index.js.map