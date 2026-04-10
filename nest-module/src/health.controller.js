"use strict";
/**
 * HealthController - Health check and database retry test endpoints
 *
 * GET /api/pdfme/health - Returns database connection status and server info
 * POST /api/pdfme/health/test-db-retry - Tests database retry on transient failures
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const auth_guard_1 = require("./auth.guard");
const db_retry_1 = require("./db/db-retry");
const file_storage_service_1 = require("./file-storage.service");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
let HealthController = class HealthController {
    pool;
    fileStorage;
    constructor(pool, fileStorage) {
        this.pool = pool;
        this.fileStorage = fileStorage;
    }
    async getHealth() {
        let dbStatus = 'disconnected';
        let dbError;
        try {
            const client = await this.pool.connect();
            try {
                const result = await client.query('SELECT NOW() AS server_time');
                dbStatus = 'connected';
            }
            finally {
                client.release();
            }
        }
        catch (err) {
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
    async testDbRetry(body) {
        const failCount = body?.failCount ?? 1;
        const errorCode = body?.errorCode ?? '08006';
        const maxRetries = body?.maxRetries ?? 2;
        let attemptsMade = 0;
        const retryLog = [];
        try {
            const result = await (0, db_retry_1.withDbRetry)(async () => {
                attemptsMade++;
                if (attemptsMade <= failCount) {
                    const err = new Error(`Simulated transient DB error (attempt ${attemptsMade})`);
                    err.code = errorCode;
                    throw err;
                }
                // Real database query on success attempt
                const client = await this.pool.connect();
                try {
                    const res = await client.query('SELECT NOW() AS server_time');
                    return res.rows[0].server_time;
                }
                finally {
                    client.release();
                }
            }, {
                maxRetries,
                baseDelayMs: 50, // Faster for testing
                onRetry: (error, attempt, max) => {
                    retryLog.push({
                        attempt,
                        error: error.message,
                        success: false,
                    });
                },
            });
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
        }
        catch (error) {
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
    async checkTransientError(body) {
        const err = new Error(body?.message || 'test error');
        if (body?.code) {
            err.code = body.code;
        }
        return {
            isTransient: (0, db_retry_1.isTransientError)(err),
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
    async testError(errorType) {
        switch (errorType) {
            case 'unhandled':
                // Raw unhandled error - should NOT leak stack trace
                throw new Error('Something went wrong in the render pipeline');
            case 'internal-path':
                // Error with internal file paths
                throw new Error('Failed to read file at /home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts:142:15');
            case 'http-400':
                // Standard HttpException with details
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: 'Template name is required',
                    details: [{ field: 'name', reason: 'must not be empty' }],
                }, common_1.HttpStatus.BAD_REQUEST);
            case 'http-500':
                throw new common_1.HttpException('Internal processing error', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
            case 'db-error':
                // Simulated database error with connection details
                const dbErr = new Error('connect ECONNREFUSED 127.0.0.1:5432 at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1300:16)');
                dbErr.code = 'ECONNREFUSED';
                throw dbErr;
            case 'stack-in-message': {
                // Error where the message itself contains stack-trace-like text
                const err = new Error('TypeError: Cannot read properties of undefined\n' +
                    '    at RenderService.generatePdf (/home/linqadmin/repo/pdfme-jrny/nest-module/src/render.service.ts:245:18)\n' +
                    '    at processTicksAndRejections (node:internal/process/task_queues:95:5)');
                throw err;
            }
            case 'node-modules':
                throw new Error('Module parse failed: node_modules/@pdfme/generator/dist/index.js unexpected token');
            case 'duplicate-key':
                throw new Error('duplicate key value violates unique constraint "templates_pkey"');
            default:
                throw new common_1.HttpException('Unknown error type. Use ?type=unhandled|internal-path|http-400|http-500|db-error|stack-in-message|node-modules|duplicate-key', common_1.HttpStatus.BAD_REQUEST);
        }
    }
    /**
     * Get storage directory structure information.
     * Returns which directories exist and their paths.
     */
    async getStorageStructure(orgId) {
        const adapter = this.fileStorage;
        const rootDir = adapter.getRootDir();
        const tempDir = adapter.getTempDir();
        const checkDir = (dirPath) => {
            try {
                return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
            }
            catch {
                return false;
            }
        };
        const structure = {
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
};
exports.HealthController = HealthController;
tslib_1.__decorate([
    (0, common_1.Get)('health'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], HealthController.prototype, "getHealth", null);
tslib_1.__decorate([
    (0, common_1.Post)('health/test-db-retry'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], HealthController.prototype, "testDbRetry", null);
tslib_1.__decorate([
    (0, common_1.Post)('health/check-transient-error'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", Promise)
], HealthController.prototype, "checkTransientError", null);
tslib_1.__decorate([
    (0, common_1.Get)('health/test-error'),
    tslib_1.__param(0, (0, common_1.Query)('type')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], HealthController.prototype, "testError", null);
tslib_1.__decorate([
    (0, common_1.Get)('health/storage-structure'),
    tslib_1.__param(0, (0, common_1.Query)('orgId')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], HealthController.prototype, "getStorageStructure", null);
exports.HealthController = HealthController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme'),
    (0, auth_guard_1.Public)(),
    tslib_1.__param(0, (0, common_1.Inject)('PG_POOL')),
    tslib_1.__param(1, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__metadata("design:paramtypes", [pg_1.Pool,
        file_storage_service_1.FileStorageService])
], HealthController);
//# sourceMappingURL=health.controller.js.map