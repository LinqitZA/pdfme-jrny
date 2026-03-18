/**
 * HealthController - Health check endpoint
 *
 * GET /api/pdfme/health
 * Returns database connection status and server info
 */

import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';

@Controller('api/pdfme')
export class HealthController {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  @Get('health')
  async getHealth() {
    let dbStatus = 'disconnected';
    let dbError: string | undefined;

    try {
      const client = await this.pool.connect();
      try {
        const result = await client.query('SELECT NOW() AS server_time');
        dbStatus = 'connected';
      } finally {
        client.release();
      }
    } catch (err: any) {
      dbStatus = 'disconnected';
      dbError = err.message;
    }

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        ...(dbError ? { error: dbError } : {}),
      },
      version: '0.1.0',
    };
  }
}
