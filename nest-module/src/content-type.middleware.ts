/**
 * Content-Type Validation Middleware
 *
 * Ensures POST and PUT requests include a proper Content-Type header.
 * Returns 415 Unsupported Media Type if Content-Type is missing or not application/json
 * for endpoints that expect JSON bodies.
 *
 * Exemptions:
 * - GET, DELETE, HEAD, OPTIONS requests (no body expected)
 * - Multipart form-data requests (file uploads)
 * - Requests with no body (Content-Length: 0 or missing)
 */

import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ContentTypeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Only validate methods that typically carry a request body
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    if (!methodsWithBody.includes(req.method)) {
      return next();
    }

    // Skip if no body content (Content-Length is 0 or missing and no transfer-encoding)
    const contentLength = req.headers['content-length'];
    const transferEncoding = req.headers['transfer-encoding'];
    if (contentLength === '0' || (!contentLength && !transferEncoding)) {
      return next();
    }

    const contentType = req.headers['content-type'] || '';

    // Allow multipart/form-data (file uploads)
    if (contentType.includes('multipart/form-data')) {
      return next();
    }

    // Require application/json for body-carrying requests
    if (!contentType.includes('application/json')) {
      const errorMessage = contentType
        ? `Unsupported Content-Type: ${contentType}. Use application/json.`
        : 'Missing Content-Type header. Use application/json.';

      return res.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).json({
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: errorMessage,
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.url,
      });
    }

    next();
  }
}
