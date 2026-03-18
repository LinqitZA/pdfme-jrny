/**
 * Drizzle ORM schema definitions for pdfme ERP Edition
 *
 * Tables: Template, GeneratedDocument, UserSignature, RenderBatch, AuditLog
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── Template ────────────────────────────────────────────────────────
export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(), // cuid2
    orgId: text('org_id'), // nullable — null = system template
    type: text('type').notNull(), // invoice | statement | purchase_order | delivery_note | credit_note | report_* | custom
    name: text('name').notNull(),
    schema: jsonb('schema').notNull(), // pdfme Template JSON
    status: text('status').notNull().default('draft'), // draft | published | archived
    version: integer('version').notNull().default(1),
    saveMode: text('save_mode'), // inPlace | newVersion
    publishedVer: integer('published_ver'),
    publishedSchema: jsonb('published_schema'), // snapshot of schema at last publish — used for rendering while draft edits are in progress
    forkedFromId: text('forked_from_id'), // FK self-ref
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(), // userId
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => ({
    orgTypeStatusIdx: index('idx_templates_org_type_status').on(table.orgId, table.type, table.status),
  }),
);

// ─── GeneratedDocument ───────────────────────────────────────────────
export const generatedDocuments = pgTable('generated_documents', {
  id: text('id').primaryKey(), // cuid2
  orgId: text('org_id').notNull(),
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id),
  templateVer: integer('template_ver').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  filePath: text('file_path').notNull(),
  pdfHash: text('pdf_hash').notNull(), // Configurable: SHA-256 or BLAKE3 (prefixed, e.g. "sha256:..." or "blake3:...")
  status: text('status').notNull().default('queued'), // queued | generating | done | failed
  outputChannel: text('output_channel').notNull(), // email | print
  triggeredBy: text('triggered_by').notNull(), // userId
  inputSnapshot: jsonb('input_snapshot'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── UserSignature ───────────────────────────────────────────────────
export const userSignatures = pgTable(
  'user_signatures',
  {
    id: text('id').primaryKey(), // cuid2
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    filePath: text('file_path').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    orgUserIdx: uniqueIndex('idx_user_signatures_org_user').on(table.orgId, table.userId),
  }),
);

// ─── RenderBatch ─────────────────────────────────────────────────────
export const renderBatches = pgTable('render_batches', {
  id: text('id').primaryKey(), // cuid2
  orgId: text('org_id').notNull(),
  templateType: text('template_type').notNull(),
  channel: text('channel').notNull(), // email | print
  totalJobs: integer('total_jobs').notNull(),
  completedJobs: integer('completed_jobs').notNull().default(0),
  failedJobs: integer('failed_jobs').notNull().default(0),
  failedIds: text('failed_ids').array(), // text[]
  status: text('status').notNull().default('running'), // running | completed | completedWithErrors | aborted
  onFailure: text('on_failure').notNull().default('continue'), // continue | abort
  notifyUrl: text('notify_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ─── TemplateVersion ─────────────────────────────────────────────────
// Stores version snapshots when templates are published or major changes occur
export const templateVersions = pgTable('template_versions', {
  id: text('id').primaryKey(), // cuid2
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id),
  orgId: text('org_id'),
  version: integer('version').notNull(),
  status: text('status').notNull(), // draft | published
  schema: jsonb('schema').notNull(), // snapshot of template schema at this version
  savedBy: text('saved_by').notNull(), // userId
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  changeNote: text('change_note'), // optional description of change
}, (table) => ({
  templateIdx: index('idx_template_versions_template').on(table.templateId),
}));

// ─── Printers ───────────────────────────────────────────────────────
export const printers = pgTable('printers', {
  id: text('id').primaryKey(), // cuid2
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(9100),
  type: text('type').notNull().default('raw'), // raw
  isDefault: text('is_default').default('false'), // 'true' | 'false'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── PrintJobs ──────────────────────────────────────────────────────
export const printJobs = pgTable(
  'print_jobs',
  {
    id: text('id').primaryKey(), // cuid2
    orgId: text('org_id').notNull(),
    templateId: text('template_id').references(() => templates.id),
    printerId: text('printer_id').references(() => printers.id),
    status: text('status').notNull().default('pending'), // pending | rendered | printing | completed | failed | partial
    totalLabels: integer('total_labels').notNull().default(1),
    labelsPrinted: integer('labels_printed').notNull().default(0),
    renderedPdfPath: text('rendered_pdf_path'), // file storage reference
    inputsSnapshot: jsonb('inputs_snapshot'), // frozen inputs at creation time
    errorMessage: text('error_message'),
    errorAt: timestamp('error_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
  },
  (table) => ({
    orgStatusIdx: index('idx_print_jobs_org_status').on(table.orgId, table.status),
    createdAtIdx: index('idx_print_jobs_created_at').on(table.createdAt),
  }),
);

// ─── AuditLog ────────────────────────────────────────────────────────
// APPEND-ONLY: no UPDATE or DELETE
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(), // cuid2
  orgId: text('org_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  userId: text('user_id').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
