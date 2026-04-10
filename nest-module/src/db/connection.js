"use strict";
/**
 * Database connection setup for pdfme ERP Edition
 *
 * Uses node-postgres (pg) with Drizzle ORM.
 * Connection string defaults to localhost PostgreSQL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabaseUrl = getDatabaseUrl;
exports.connectDatabase = connectDatabase;
exports.getDatabase = getDatabase;
exports.getPool = getPool;
exports.disconnectDatabase = disconnectDatabase;
const tslib_1 = require("tslib");
const pg_1 = require("pg");
const node_postgres_1 = require("drizzle-orm/node-postgres");
const schema = tslib_1.__importStar(require("./schema"));
let pool = null;
let db = null;
function getDatabaseUrl() {
    return (process.env.DATABASE_URL ||
        `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'pdfme_erp'}`);
}
async function connectDatabase() {
    if (db)
        return db;
    const connectionString = getDatabaseUrl();
    pool = new pg_1.Pool({
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
    }
    finally {
        client.release();
    }
    db = (0, node_postgres_1.drizzle)(pool, { schema });
    return db;
}
function getDatabase() {
    if (!db) {
        throw new Error('Database not connected. Call connectDatabase() first.');
    }
    return db;
}
function getPool() {
    if (!pool) {
        throw new Error('Database pool not initialized. Call connectDatabase() first.');
    }
    return pool;
}
async function disconnectDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
        db = null;
        console.log('[pdfme-erp] Database disconnected');
    }
}
//# sourceMappingURL=connection.js.map