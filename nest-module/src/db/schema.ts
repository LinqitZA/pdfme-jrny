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
    forkedFromId: text('forked_from_id'), // FK self-ref
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(), // userId
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_templates_org_type_status').on(table.orgId, table.type, table.status),
  ],
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
  pdfHash: text('pdf_hash').notNull(), // SHA-256
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
  (table) => [
    uniqueIndex('idx_user_signatures_org_user').on(table.orgId, table.userId),
  ],
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
