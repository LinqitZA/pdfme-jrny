"use strict";
/**
 * pdfme-jrny nest-module — Schema Re-exports
 *
 * This file re-exports all pdfme table definitions from libs/database,
 * which is the single source of truth. DO NOT define tables here.
 *
 * The JRNY pdfme schema uses:
 *   - PostgreSQL "pdfme" schema (not public)
 *   - UUID primary keys (not cuid2/text)
 *   - drizzle-orm/pg-core pgSchema tables
 *
 * All services in this module import from this file, so the re-export
 * ensures zero changes needed in service files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLogs = exports.printJobs = exports.printers = exports.renderBatches = exports.userSignatures = exports.templateVersions = exports.generatedDocuments = exports.templates = exports.pdfmeSchema = void 0;
var pdfme_schema_1 = require("@jrny/database/pdfme-schema");
Object.defineProperty(exports, "pdfmeSchema", { enumerable: true, get: function () { return pdfme_schema_1.pdfmeSchema; } });
Object.defineProperty(exports, "templates", { enumerable: true, get: function () { return pdfme_schema_1.templates; } });
Object.defineProperty(exports, "generatedDocuments", { enumerable: true, get: function () { return pdfme_schema_1.generatedDocuments; } });
Object.defineProperty(exports, "templateVersions", { enumerable: true, get: function () { return pdfme_schema_1.templateVersions; } });
Object.defineProperty(exports, "userSignatures", { enumerable: true, get: function () { return pdfme_schema_1.userSignatures; } });
Object.defineProperty(exports, "renderBatches", { enumerable: true, get: function () { return pdfme_schema_1.renderBatches; } });
Object.defineProperty(exports, "printers", { enumerable: true, get: function () { return pdfme_schema_1.printers; } });
Object.defineProperty(exports, "printJobs", { enumerable: true, get: function () { return pdfme_schema_1.printJobs; } });
Object.defineProperty(exports, "auditLogs", { enumerable: true, get: function () { return pdfme_schema_1.auditLogs; } });
//# sourceMappingURL=schema.js.map