/**
 * HealthController - Health check and database retry test endpoints
 *
 * GET /api/pdfme/health - Returns database connection status and server info
 * POST /api/pdfme/health/test-db-retry - Tests database retry on transient failures
 */

import { Controller, Get, Post, Body, Inject, HttpException, HttpStatus, Query } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from './auth.guard';
import { withDbRetry, isTransientError } from './db/db-retry';
import { FileStorageService } from './file-storage.service';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api/pdfme')
@Public()
export class HealthController {
  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    @Inject('FILE_STORAGE') private readonly fileStorage: FileStorageService,
  ) {}

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

  /**
   * Test error sanitization by triggering various error types.
   *
   * Query param "type":
   *  - "unhandled"    - Throws raw Error with stack trace
   *  - "internal-path" - Error message contains internal file paths
   *  - "http-400"     - HttpException with details
   *  - "http-500"     - HttpException 500
   *  - "db-error"     - Simulated database error
   *  - "stack-in-message" - Error message contains stack trace text
   */
  @Get('health/test-error')
  async testError(@Query('type') errorType?: string) {
    switch (errorType) {
      case 'unhandled':
        // Raw unhandled error - should NOT leak stack trace
        throw new Error('Something went wrong in the render pipeline');

      case 'internal-path':
        // Error with internal file paths
        throw new Error(
          'Failed to read file at /home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts:142:15',
        );

      case 'http-400':
        // Standard HttpException with details
        throw new HttpException(
          {
            statusCode: 400,
            error: 'Bad Request',
            message: 'Template name is required',
            details: [{ field: 'name', reason: 'must not be empty' }],
          },
          HttpStatus.BAD_REQUEST,
        );

      case 'http-500':
        throw new HttpException('Internal processing error', HttpStatus.INTERNAL_SERVER_ERROR);

      case 'db-error':
        // Simulated database error with connection details
        const dbErr: any = new Error(
          'connect ECONNREFUSED 127.0.0.1:5432 at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1300:16)',
        );
        dbErr.code = 'ECONNREFUSED';
        throw dbErr;

      case 'stack-in-message': {
        // Error where the message itself contains stack-trace-like text
        const err = new Error(
          'TypeError: Cannot read properties of undefined\n' +
          '    at RenderService.generatePdf (/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts:245:18)\n' +
          '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
        );
        throw err;
      }

      case 'node-modules':
        throw new Error(
          'Module parse failed: node_modules/@pdfme/generator/dist/index.js unexpected token',
        );

      case 'duplicate-key':
        throw new Error('duplicate key value violates unique constraint "templates_pkey"');

      default:
        throw new HttpException('Unknown error type. Use ?type=unhandled|internal-path|http-400|http-500|db-error|stack-in-message|node-modules|duplicate-key', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Get storage directory structure information.
   * Returns which directories exist and their paths.
   */
  @Get('health/storage-structure')
  async getStorageStructure(@Query('orgId') orgId?: string) {
    const adapter = this.fileStorage as LocalDiskStorageAdapter;
    const rootDir = adapter.getRootDir();
    const tempDir = adapter.getTempDir();

    const checkDir = (dirPath: string) => {
      try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      } catch {
        return false;
      }
    };

    const structure: Record<string, { path: string; exists: boolean }> = {
      'system/fonts': {
        path: path.join(rootDir, 'system', 'fonts'),
        exists: checkDir(path.join(rootDir, 'system', 'fonts')),
      },
      'tempDir/previews': {
        path: path.join(tempDir, 'previews'),
        exists: checkDir(path.join(tempDir, 'previews')),
      },
    };

    if (orgId) {
      structure[`${orgId}/documents`] = {
        path: path.join(rootDir, orgId, 'documents'),
        exists: checkDir(path.join(rootDir, orgId, 'documents')),
      };
      structure[`${orgId}/assets`] = {
        path: path.join(rootDir, orgId, 'assets'),
        exists: checkDir(path.join(rootDir, orgId, 'assets')),
      };
      structure[`${orgId}/fonts`] = {
        path: path.join(rootDir, orgId, 'fonts'),
        exists: checkDir(path.join(rootDir, orgId, 'fonts')),
      };
      structure[`${orgId}/signatures`] = {
        path: path.join(rootDir, orgId, 'signatures'),
        exists: checkDir(path.join(rootDir, orgId, 'signatures')),
      };
    }

    return {
      rootDir,
      tempDir,
      structure,
    };
  }
}
