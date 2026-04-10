"use strict";
/**
 * Database retry utility for transient failure handling
 *
 * Wraps database operations with configurable retry logic.
 * Retries up to 2 times (3 total attempts) on transient errors
 * such as connection timeouts, connection resets, and deadlocks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTransientError = isTransientError;
exports.withDbRetry = withDbRetry;
exports.createRetryOperation = createRetryOperation;
/** Error codes considered transient (pg error codes + common Node.js errors) */
const TRANSIENT_ERROR_CODES = new Set([
    // PostgreSQL transient errors
    '08000', // connection_exception
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    // Node.js / network errors
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
]);
/** Transient error message patterns */
const TRANSIENT_MESSAGE_PATTERNS = [
    'connection terminated unexpectedly',
    'connection reset',
    'connection timed out',
    'could not connect',
    'server closed the connection unexpectedly',
    'too many clients',
    'remaining connection slots',
    'the database system is starting up',
    'the database system is shutting down',
    'terminating connection due to administrator command',
];
const DEFAULT_OPTIONS = {
    maxRetries: 2,
    baseDelayMs: 100,
    exponentialBackoff: true,
};
/**
 * Determine if an error is transient and eligible for retry
 */
function isTransientError(error) {
    if (!error)
        return false;
    // Check pg error code
    if (error.code && TRANSIENT_ERROR_CODES.has(error.code)) {
        return true;
    }
    // Check Node.js error code (e.g., ECONNRESET)
    if (error.errno && TRANSIENT_ERROR_CODES.has(error.errno)) {
        return true;
    }
    // Check error message patterns
    const message = (error.message || '').toLowerCase();
    return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}
/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Execute a database operation with retry logic.
 *
 * Retries up to `maxRetries` times (default 2) on transient errors.
 * Uses exponential backoff between retries.
 * Non-transient errors are thrown immediately without retry.
 *
 * @param operation - Async function performing the database operation
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const result = await withDbRetry(() =>
 *   db.select().from(templates).where(eq(templates.id, id))
 * );
 * ```
 */
async function withDbRetry(operation, options) {
    const maxRetries = options?.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
    const baseDelayMs = options?.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs;
    const exponentialBackoff = options?.exponentialBackoff ?? DEFAULT_OPTIONS.exponentialBackoff;
    const onRetry = options?.onRetry;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Don't retry non-transient errors
            if (!isTransientError(error)) {
                throw error;
            }
            // Don't retry if we've exhausted all attempts
            if (attempt >= maxRetries) {
                break;
            }
            // Calculate delay with optional exponential backoff
            const delay = exponentialBackoff
                ? baseDelayMs * Math.pow(2, attempt)
                : baseDelayMs;
            // Notify retry callback
            if (onRetry) {
                onRetry(error, attempt + 1, maxRetries);
            }
            console.warn(`[pdfme-erp] Database transient error (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }
    // All retries exhausted
    const retryError = new Error(`Database operation failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
    retryError.originalError = lastError;
    retryError.attempts = maxRetries + 1;
    retryError.code = 'DB_RETRY_EXHAUSTED';
    throw retryError;
}
/**
 * Create a retry-wrapped version of a database operation function.
 * Useful for creating reusable retry-enabled queries.
 *
 * @example
 * ```ts
 * const findTemplateWithRetry = createRetryOperation(
 *   (id: string) => db.select().from(templates).where(eq(templates.id, id))
 * );
 * const result = await findTemplateWithRetry('template-123');
 * ```
 */
function createRetryOperation(operation, options) {
    return (...args) => withDbRetry(() => operation(...args), options);
}
//# sourceMappingURL=db-retry.js.map