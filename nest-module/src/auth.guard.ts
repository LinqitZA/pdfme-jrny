/**
 * JwtAuthGuard - NestJS Guard that requires valid JWT on protected endpoints.
 *
 * Decodes the JWT payload (simple base64 decode for dev mode) and attaches
 * user claims to request.user. Returns 401 if no token or invalid token.
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

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface JwtPayload {
  sub: string;
  orgId: string;
  roles: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

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
      const parts = token.split('.');
      if (parts.length < 2) {
        throw new Error('Invalid token format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      if (!payload.sub) {
        throw new Error('Token missing sub claim');
      }

      // Attach decoded user to request
      request.user = {
        sub: payload.sub,
        orgId: payload.orgId || '',
        roles: payload.roles || [],
      } as JwtPayload;

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
