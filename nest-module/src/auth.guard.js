"use strict";
/**
 * JwtAuthGuard - NestJS Guard that requires valid JWT on protected endpoints.
 *
 * When JWT_SECRET is set, verifies the JWT signature using HMAC-SHA256.
 * Tampered claims (modified orgId, roles, etc.) are detected and rejected with 401.
 * When JWT_SECRET is not set, falls back to base64 decode for dev/legacy compatibility.
 *
 * Use @Public() decorator to exempt endpoints (e.g., health check).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsGuard = exports.JwtAuthGuard = exports.RequirePermissions = exports.PERMISSIONS_KEY = exports.Public = exports.IS_PUBLIC_KEY = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const crypto = tslib_1.__importStar(require("crypto"));
exports.IS_PUBLIC_KEY = 'isPublic';
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC_KEY, true);
exports.Public = Public;
exports.PERMISSIONS_KEY = 'permissions';
const RequirePermissions = (...permissions) => (0, common_1.SetMetadata)(exports.PERMISSIONS_KEY, permissions);
exports.RequirePermissions = RequirePermissions;
/** Default dev secret - production MUST override via JWT_SECRET env var */
const DEV_JWT_SECRET = 'pdfme-dev-secret';
/**
 * Verify HMAC-SHA256 JWT signature.
 * Returns the decoded payload if valid, throws if signature doesn't match.
 */
function verifyJwtSignature(token, secret) {
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
let JwtAuthGuard = class JwtAuthGuard {
    reflector;
    jwtSecret;
    constructor(reflector) {
        this.reflector = reflector;
        this.jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;
    }
    canActivate(context) {
        // Check if the route is marked as @Public()
        const isPublic = this.reflector.getAllAndOverride(exports.IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new common_1.HttpException({
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Missing or invalid Authorization header. Provide a Bearer token.',
            }, common_1.HttpStatus.UNAUTHORIZED);
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
                    sub: payload.sub,
                    orgId: payload.orgId || '',
                    roles: payload.roles || [],
                };
            }
            else {
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
                };
            }
            return true;
        }
        catch {
            throw new common_1.HttpException({
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Invalid or malformed JWT token.',
            }, common_1.HttpStatus.UNAUTHORIZED);
        }
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__metadata("design:paramtypes", [core_1.Reflector])
], JwtAuthGuard);
/**
 * PermissionsGuard - Checks that the authenticated user has the required permissions.
 *
 * Works with @RequirePermissions() decorator. If no permissions are specified on a route,
 * access is allowed (permissive by default). If permissions are specified, the user's
 * roles array must include ALL required permissions.
 */
let PermissionsGuard = class PermissionsGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        // Check if route is public (no auth needed)
        const isPublic = this.reflector.getAllAndOverride(exports.IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }
        const requiredPermissions = this.reflector.getAllAndOverride(exports.PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        // No permissions required on this route - allow access
        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) {
            throw new common_1.HttpException({
                statusCode: 403,
                error: 'Forbidden',
                message: 'Insufficient permissions: authentication required',
            }, common_1.HttpStatus.FORBIDDEN);
        }
        const userRoles = user.roles || [];
        // Check if user has ALL required permissions
        const hasAllPermissions = requiredPermissions.every((permission) => userRoles.includes(permission));
        if (!hasAllPermissions) {
            const missing = requiredPermissions.filter((p) => !userRoles.includes(p));
            throw new common_1.HttpException({
                statusCode: 403,
                error: 'Forbidden',
                message: `Insufficient permissions: requires ${missing.join(', ')}`,
            }, common_1.HttpStatus.FORBIDDEN);
        }
        return true;
    }
};
exports.PermissionsGuard = PermissionsGuard;
exports.PermissionsGuard = PermissionsGuard = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__metadata("design:paramtypes", [core_1.Reflector])
], PermissionsGuard);
//# sourceMappingURL=auth.guard.js.map