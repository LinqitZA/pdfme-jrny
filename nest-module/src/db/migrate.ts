/**
 * Database migration - pushes Drizzle schema to PostgreSQL
 *
 * Creates all tables if they don't exist.
 * Uses raw SQL CREATE TABLE IF NOT EXISTS for reliability.
 */

import { Pool } from 'pg';
import { getDatabaseUrl } from './connection';

const CREATE_TABLES_SQL = `
-- Template table
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  schema JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  save_mode TEXT,
  published_ver INTEGER,
  forked_from_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  locked_by TEXT,
  locked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_templates_org_type_status
  ON templates (org_id, type, status);

-- GeneratedDocument table
CREATE TABLE IF NOT EXISTS generated_documents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id),
  template_ver INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  pdf_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  output_channel TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  input_snapshot JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UserSignature table
CREATE TABLE IF NOT EXISTS user_signatures (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_signatures_org_user
  ON user_signatures (org_id, user_id);

-- RenderBatch table
CREATE TABLE IF NOT EXISTS render_batches (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  template_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  total_jobs INTEGER NOT NULL,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_ids TEXT[],
  status TEXT NOT NULL DEFAULT 'running',
  on_failure TEXT NOT NULL DEFAULT 'continue',
  notify_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- TemplateVersion table (version history snapshots)
CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  org_id TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  schema JSONB NOT NULL,
  saved_by TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_template_versions_template
  ON template_versions (template_id);

-- AuditLog table (APPEND-ONLY: no UPDATE or DELETE)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations(): Promise<void> {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  try {
    console.log('[pdfme-erp] Applying database schema...');
    await pool.query(CREATE_TABLES_SQL);
    console.log('[pdfme-erp] Database schema applied successfully');
  } finally {
    await pool.end();
  }
}

// Allow running directly: npx ts-node src/db/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
