/**
 * Database connection setup for pdfme ERP Edition
 *
 * Uses node-postgres (pg) with Drizzle ORM.
 * Connection string defaults to localhost PostgreSQL.
 */

import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type PdfmeDatabase = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: PdfmeDatabase | null = null;

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'pdfme_erp'}`
  );
}

export async function connectDatabase(): Promise<PdfmeDatabase> {
  if (db) return db;

  const connectionString = getDatabaseUrl();

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test the connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[pdfme-erp] Database connected successfully');
  } finally {
    client.release();
  }

  db = drizzle(pool, { schema });
  return db;
}

export function getDatabase(): PdfmeDatabase {
  if (!db) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return db;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call connectDatabase() first.');
  }
  return pool;
}

export async function disconnectDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    console.log('[pdfme-erp] Database disconnected');
  }
}
