/**
 * HealthController - Health check and database retry test endpoints
 *
 * GET /api/pdfme/health - Returns database connection status and server info
 * POST /api/pdfme/health/test-db-retry - Tests database retry on transient failures
 */

import { Controller, Get, Post, Body, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from './auth.guard';
import { withDbRetry, isTransientError } from './db/db-retry';

@Controller('api/pdfme')
@Public()
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

  /**
   * Test database retry logic by simulating transient failures.
   *
   * Body params:
   *  - failCount: number of times to fail before succeeding (default: 1)
   *  - errorCode: pg error code to simulate (default: '08006' connection_failure)
   *  - maxRetries: max retries to attempt (default: 2)
   */
  @Post('health/test-db-retry')
  async testDbRetry(
    @Body() body: { failCount?: number; errorCode?: string; maxRetries?: number },
  ) {
    const failCount = body?.failCount ?? 1;
    const errorCode = body?.errorCode ?? '08006';
    const maxRetries = body?.maxRetries ?? 2;

    let attemptsMade = 0;
    const retryLog: Array<{ attempt: number; error?: string; success: boolean }> = [];

    try {
      const result = await withDbRetry(
        async () => {
          attemptsMade++;

          if (attemptsMade <= failCount) {
            const err: any = new Error(
              `Simulated transient DB error (attempt ${attemptsMade})`,
            );
            err.code = errorCode;
            throw err;
          }

          // Real database query on success attempt
          const client = await this.pool.connect();
          try {
            const res = await client.query('SELECT NOW() AS server_time');
            return res.rows[0].server_time;
          } finally {
            client.release();
          }
        },
        {
          maxRetries,
          baseDelayMs: 50, // Faster for testing
          onRetry: (error, attempt, max) => {
            retryLog.push({
              attempt,
              error: error.message,
              success: false,
            });
          },
        },
      );

      retryLog.push({
        attempt: attemptsMade,
        success: true,
      });

      return {
        success: true,
        totalAttempts: attemptsMade,
        retriesNeeded: attemptsMade - 1,
        maxRetries,
        retryLog,
        serverTime: result,
      };
    } catch (error: any) {
      retryLog.push({
        attempt: attemptsMade,
        error: error.message,
        success: false,
      });

      return {
        success: false,
        totalAttempts: attemptsMade,
        retriesNeeded: attemptsMade - 1,
        maxRetries,
        retryLog,
        error: error.message,
        errorCode: error.code,
      };
    }
  }

  /**
   * Check if an error code is considered transient
   */
  @Post('health/check-transient-error')
  async checkTransientError(@Body() body: { code?: string; message?: string }) {
    const err: any = new Error(body?.message || 'test error');
    if (body?.code) {
      err.code = body.code;
    }
    return {
      isTransient: isTransientError(err),
      code: body?.code || null,
      message: body?.message || null,
    };
  }
}
