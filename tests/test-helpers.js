/**
 * Shared test helpers for feature tests.
 * Provides JWT creation with proper HMAC-SHA256 signing.
 */

const crypto = require('crypto');

const DEV_JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
const API_BASE = process.env.API_BASE || process.env.API_BASE || 'http://localhost:3001/api/pdfme';

/**
 * Create a properly signed JWT token for testing.
 * Uses HMAC-SHA256 with the dev secret.
 */
function makeJwt(sub, orgId, roles) {
  if (!roles) roles = [];
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: sub, orgId: orgId, roles: roles })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', DEV_JWT_SECRET)
    .update(header + '.' + payload)
    .digest('base64url');
  return header + '.' + payload + '.' + signature;
}

module.exports = { makeJwt, API_BASE, DEV_JWT_SECRET };
