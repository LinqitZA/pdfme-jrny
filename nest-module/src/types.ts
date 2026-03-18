/**
 * Type definitions for @pdfme-erp/nest module
 */

export interface PdfmeErpModuleConfig {
  storage: {
    rootDir: string;
    tempDir: string;
    tempRetentionMinutes?: number; // default 60
  };
  jwt: {
    secret: string;
    algorithm?: string;
    claimsMapping?: {
      userId?: string;  // default 'sub'
      orgId?: string;   // default 'orgId'
      roles?: string;   // default 'roles'
    };
  };
  redis: {
    host: string;
    port: number;
  };
  database: {
    drizzleClient: unknown; // Drizzle instance
  };
  apiPrefix?: string; // default '/api/pdfme'
  rateLimits?: {
    renderNow?: number;   // default 60/min
    renderQueue?: number;  // default 120/min
    renderBulk?: number;   // default 5/hour
    bulkMaxEntityIds?: number; // default 2000
  };
  quotas?: {
    documentsBytes?: number; // default 5GB
    assetsBytes?: number;    // default 500MB
  };
  queue?: {
    defaultConcurrency?: number; // default 5
    maxConcurrency?: number;     // default 20
  };
  ghostscript?: {
    binary?: string; // default 'gs'
  };
  verapdf?: {
    binary?: string; // default 'verapdf'
  };
  hashing?: {
    algorithm?: 'sha256' | 'blake3'; // default 'sha256'
  };
}

export interface DataSource {
  templateType: string;
  resolve(entityId: string, orgId: string, params?: Record<string, unknown>): Promise<unknown[]>;
}

export interface JwtClaims {
  sub: string;     // userId
  orgId: string;   // tenant identifier
  roles: string[]; // permission array
}

export interface ErrorEnvelope {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    cursor?: string;
    hasMore: boolean;
  };
}
