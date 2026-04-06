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

export {
  pdfmeSchema,
  templates,
  generatedDocuments,
  templateVersions,
  userSignatures,
  renderBatches,
  printers,
  printJobs,
  auditLogs,
} from '@jrny/database/pdfme-schema';
