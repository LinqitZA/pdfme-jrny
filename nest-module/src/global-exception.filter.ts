/**
 * Global Exception Filter for pdfme ERP Edition
 *
 * Catches all unhandled exceptions and returns user-friendly error messages.
 * Ensures no stack traces, internal file paths, or implementation details
 * are leaked to API consumers.
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** Patterns that indicate internal implementation details that should be sanitized */
const INTERNAL_PATTERNS = [
  /at\s+\S+\s+\(.*:\d+:\d+\)/g,       // Stack trace frames: "at Function (file:line:col)"
  /\/home\/[^\s"']+/g,                   // Absolute Linux paths
  /[A-Z]:\\[^\s"']+/g,                   // Absolute Windows paths
  /node_modules\/[^\s"']+/g,             // node_modules paths
  /\/usr\/[^\s"']+/g,                    // System paths
  /\.ts:\d+:\d+/g,                       // TypeScript source references
  /\.js:\d+:\d+/g,                       // JavaScript source references
  /Error:\s*\n\s*at\s+/g,               // Error stack start
];

/** Map of internal error messages to user-friendly alternatives */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  'ECONNREFUSED': 'Service temporarily unavailable. Please try again later.',
  'ECONNRESET': 'Connection was interrupted. Please try again.',
  'ETIMEDOUT': 'Request timed out. Please try again later.',
  'EPIPE': 'Connection was interrupted. Please try again.',
  'ENOTFOUND': 'Service temporarily unavailable. Please try again later.',
};

/**
 * Check if a string contains internal/sensitive information
 */
function containsInternalInfo(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return INTERNAL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0; // Reset regex state
    return pattern.test(str);
  });
}

/**
 * Sanitize a message by removing any internal details
 */
function sanitizeMessage(message: string): string {
  if (!message || typeof message !== 'string') return 'An unexpected error occurred.';

  // Check for known error codes
  for (const [code, friendlyMessage] of Object.entries(ERROR_MESSAGE_MAP)) {
    if (message.includes(code)) {
      return friendlyMessage;
    }
  }

  // If message contains internal info, replace with generic message
  if (containsInternalInfo(message)) {
    return 'An internal error occurred. Please try again or contact support.';
  }

  // Remove any accidental stack trace fragments
  let sanitized = message
    .replace(/\s*at\s+\S+\s+\([^)]+\)/g, '') // Remove inline stack frames
    .replace(/\n\s*at\s+.*/g, '')              // Remove stack trace lines
    .replace(/\/home\/[^\s"',)]+/g, '[path]')  // Replace absolute paths
    .replace(/[A-Z]:\\[^\s"',)]+/g, '[path]')  // Replace Windows paths
    .replace(/node_modules\/[^\s"',)]+/g, '[internal]')  // Replace module paths
    .trim();

  // If sanitization removed everything meaningful, use generic message
  // But preserve short data values (IDs, codes) that are not error messages
  if (!sanitized) {
    return 'An unexpected error occurred.';
  }

  return sanitized;
}

/**
 * Recursively sanitize an object, removing stack traces and internal paths
 */
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeMessage(obj);
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Remove stack trace fields entirely
    if (key === 'stack' || key === 'trace' || key === 'stackTrace') {
      continue;
    }
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let errorResponse: Record<string, any>;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Handle multer file-too-large errors with specific size limit info
      if (status === 413) {
        const msg = typeof exceptionResponse === 'string' ? exceptionResponse
          : typeof exceptionResponse === 'object' && exceptionResponse !== null
            ? (exceptionResponse as any).message || 'File too large'
            : 'File too large';
        const isFileUpload = typeof msg === 'string' && (msg.includes('File too large') || msg.includes('file') || msg.includes('size'));
        if (isFileUpload && !(typeof exceptionResponse === 'object' && (exceptionResponse as any).maxSize)) {
          errorResponse = {
            statusCode: 413,
            error: 'Payload Too Large',
            message: `File exceeds maximum allowed size of 10MB. Please reduce the file size and try again.`,
            maxSize: '10MB',
          };
          // Add timestamp and path then return early
          errorResponse.timestamp = new Date().toISOString();
          errorResponse.path = request.url;
          response.status(status).json(errorResponse);
          return;
        }
      }

      if (typeof exceptionResponse === 'string') {
        errorResponse = {
          statusCode: status,
          error: this.getErrorName(status),
          message: sanitizeMessage(exceptionResponse),
        };
      } else if (typeof exceptionResponse === 'object') {
        // Sanitize the entire response object
        const sanitized = sanitizeObject(exceptionResponse);
        errorResponse = {
          statusCode: status,
          error: this.getErrorName(status),
          ...sanitized,
          // Ensure statusCode is always correct
          ...(sanitized.statusCode ? {} : { statusCode: status }),
        };
      } else {
        errorResponse = {
          statusCode: status,
          error: this.getErrorName(status),
          message: 'An error occurred.',
        };
      }
    } else {
      // Unhandled/unknown exception - NEVER expose details
      status = HttpStatus.INTERNAL_SERVER_ERROR;

      // Log the real error for debugging (server-side only)
      console.error(
        `[pdfme-erp] Unhandled exception on ${request.method} ${request.url}:`,
        exception instanceof Error ? exception.message : exception,
      );
      if (exception instanceof Error && exception.stack) {
        console.error('[pdfme-erp] Stack trace:', exception.stack);
      }

      // Determine user-friendly message
      let userMessage = 'An internal error occurred. Please try again or contact support.';

      if (exception instanceof Error) {
        // Check for known error patterns
        const msg = exception.message;
        if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET')) {
          userMessage = 'Service temporarily unavailable. Please try again later.';
        } else if (msg.includes('ETIMEDOUT')) {
          userMessage = 'Request timed out. Please try again later.';
        } else if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
          userMessage = 'A record with this identifier already exists.';
        } else if (msg.includes('foreign key') || msg.includes('violates foreign key')) {
          userMessage = 'Cannot complete this action because it references data that does not exist.';
        } else if (msg.includes('not null') || msg.includes('violates not-null')) {
          userMessage = 'Required fields are missing. Please check your input.';
        } else if (!containsInternalInfo(msg) && msg.length < 200) {
          // Short, non-internal message is OK to pass through
          userMessage = msg;
        }
      }

      errorResponse = {
        statusCode: status,
        error: 'Internal Server Error',
        message: userMessage,
      };
    }

    // Final safety check: ensure no internal info leaked
    const responseJson = JSON.stringify(errorResponse);
    if (containsInternalInfo(responseJson)) {
      // Nuclear option: replace entire response
      errorResponse = {
        statusCode: status,
        error: this.getErrorName(status),
        message: 'An error occurred. Please try again or contact support.',
      };
    }

    // Add timestamp and path (safe metadata)
    errorResponse.timestamp = new Date().toISOString();
    errorResponse.path = request.url;

    // Set Retry-After header for rate limit responses
    if (status === 429 && errorResponse.retryAfter) {
      response.setHeader('Retry-After', String(errorResponse.retryAfter));
    }

    response.status(status).json(errorResponse);
  }

  private getErrorName(status: number): string {
    const names: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      410: 'Gone',
      413: 'Payload Too Large',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return names[status] || 'Error';
  }
}
