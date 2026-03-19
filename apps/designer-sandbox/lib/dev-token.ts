/**
 * Dev Token Generator
 *
 * Generates a valid JWT signed with the dev secret ('pdfme-dev-secret')
 * for use in development mode when no authToken URL parameter is provided.
 *
 * This allows developers to browse the designer-sandbox directly without
 * needing to manually construct JWT tokens.
 *
 * SECURITY: The dev secret is publicly known and must never be used in production.
 * The sandbox always generates dev tokens unless an explicit authToken is provided.
 */

const DEV_JWT_SECRET = 'pdfme-dev-secret';

const DEV_PAYLOAD = {
  sub: 'dev-user',
  orgId: 'dev-org',
  roles: [
    'admin',
    'template:view',
    'template:edit',
    'template:publish',
    'template:delete',
    'render:trigger',
    'audit:view',
  ],
};

/**
 * Base64url encode a string (no padding).
 */
function base64UrlEncode(str: string): string {
  if (typeof window !== 'undefined' && typeof btoa === 'function') {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(str).toString('base64url');
}

/**
 * Generate HMAC-SHA256 signature using Web Crypto API (browser)
 * or Node.js crypto (server).
 */
async function hmacSha256(message: string, secret: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    // Browser: use Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(message);

    const key = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await window.crypto.subtle.sign('HMAC', key, msgData);
    const bytes = new Uint8Array(sig);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else {
    // Node.js fallback (for SSR)
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', secret)
      .update(message)
      .digest('base64url');
  }
}

/**
 * Synchronous JWT generation using a pre-computed token.
 * Since Web Crypto is async, we pre-generate the token on module load
 * and cache it.
 */
let cachedDevToken: string | null = null;
let tokenPromise: Promise<string> | null = null;

/**
 * Generate a development JWT token.
 * Returns a promise that resolves to the JWT string.
 */
export async function generateDevToken(): Promise<string> {
  if (cachedDevToken) return cachedDevToken;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const headerJson = JSON.stringify({ alg: 'HS256', typ: 'JWT' });
    const payloadJson = JSON.stringify({
      ...DEV_PAYLOAD,
      iat: now,
      exp: now + 86400, // 24 hours
    });

    const headerB64 = base64UrlEncode(headerJson);
    const payloadB64 = base64UrlEncode(payloadJson);
    const message = `${headerB64}.${payloadB64}`;
    const signature = await hmacSha256(message, DEV_JWT_SECRET);

    cachedDevToken = `${message}.${signature}`;
    return cachedDevToken;
  })();

  return tokenPromise;
}

/**
 * Synchronous version using Node.js crypto (for server-side rendering).
 * Falls back to empty string if crypto is not available.
 */
export function generateDevTokenSync(): string {
  if (cachedDevToken) return cachedDevToken;

  try {
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      ...DEV_PAYLOAD,
      iat: now,
      exp: now + 86400,
    })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', DEV_JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    cachedDevToken = `${header}.${payload}.${signature}`;
    return cachedDevToken;
  } catch {
    return '';
  }
}

/**
 * Check if we should use a dev token.
 * Returns true when no explicit authToken is provided.
 * The designer-sandbox is inherently a dev/demo tool, so we always
 * auto-generate tokens unless an explicit authToken is provided.
 * (Removed NODE_ENV === 'production' guard because next build bakes
 * NODE_ENV=production into the client bundle, breaking Docker builds.)
 */
export function shouldUseDevToken(authToken: string | undefined | null): boolean {
  if (authToken) return false;
  return true;
}

/**
 * Get the auth token to use: explicit token if provided, dev token if in dev mode.
 * Returns undefined if in production with no token.
 */
export function getAuthToken(explicitToken: string | undefined | null): string | undefined {
  if (explicitToken) return explicitToken;
  if (shouldUseDevToken(explicitToken)) {
    return generateDevTokenSync();
  }
  return undefined;
}
