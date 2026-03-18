/**
 * JwtAuthGuard - NestJS Guard that requires valid JWT on protected endpoints.
 *
 * When JWT_SECRET is set, verifies the JWT signature using HMAC-SHA256.
 * Tampered claims (modified orgId, roles, etc.) are detected and rejected with 401.
 * When JWT_SECRET is not set, falls back to base64 decode for dev/legacy compatibility.
 *
 * Use @Public() decorator to exempt endpoints (e.g., health check).
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Default dev secret - production MUST override via JWT_SECRET env var */
const DEV_JWT_SECRET = 'pdfme-dev-secret';

export interface JwtPayload {
  sub: string;
  orgId: string;
  roles: string[];
}

/**
 * Verify HMAC-SHA256 JWT signature.
 * Returns the decoded payload if valid, throws if signature doesn't match.
 */
function verifyJwtSignature(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format: expected 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Compute expected signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  // Normalize the provided signature to base64url for comparison
  const providedSig = signatureB64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Constant-time comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(providedSig);

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    throw new Error('Invalid signature: JWT claims may have been tampered with');
  }

  // Signature valid - decode payload
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  return payload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwtSecret: string | null;

  constructor(private reflector: Reflector) {
    this.jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;
  }

  canActivate(context: ExecutionContext): boolean {
    // Check if the route is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException(
        {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header. Provide a Bearer token.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const token = authHeader.slice(7);

      if (this.jwtSecret) {
        // Signature verification mode - rejects tampered claims
        const payload = verifyJwtSignature(token, this.jwtSecret);

        if (!payload.sub) {
          throw new Error('Token missing sub claim');
        }

        request.user = {
          sub: payload.sub as string,
          orgId: (payload.orgId as string) || '',
          roles: (payload.roles as string[]) || [],
        } as JwtPayload;
      } else {
        // Legacy fallback - base64 decode only (no signature check)
        const parts = token.split('.');
        if (parts.length < 2) {
          throw new Error('Invalid token format');
        }

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

        if (!payload.sub) {
          throw new Error('Token missing sub claim');
        }

        request.user = {
          sub: payload.sub,
          orgId: payload.orgId || '',
          roles: payload.roles || [],
        } as JwtPayload;
      }

      return true;
    } catch {
      throw new HttpException(
        {
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or malformed JWT token.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
