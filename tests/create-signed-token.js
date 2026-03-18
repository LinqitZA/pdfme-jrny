/**
 * Shared helper to create properly signed JWT tokens for testing.
 * Uses HMAC-SHA256 with the dev secret (pdfme-dev-secret).
 *
 * Usage:
 *   const { signJwt } = require('./create-signed-token');
 *   const token = signJwt({ sub: 'user', orgId: 'org', roles: ['admin'] });
 */

const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

module.exports = { signJwt, JWT_SECRET };
