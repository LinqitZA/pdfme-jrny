/**
 * Feature #426: Fix dev token generation failing in Docker/production builds
 *
 * Tests that:
 * 1. shouldUseDevToken() no longer checks NODE_ENV === 'production'
 * 2. Templates page uses async generateDevToken() instead of sync getAuthToken()
 * 3. Main page uses async generateDevToken() instead of sync getAuthToken()
 * 4. Dev token is properly generated and accepted by API in Docker builds
 * 5. Explicit authToken param is still honored over dev token
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const DESIGNER_BASE = process.env.DESIGNER_BASE || 'http://localhost:3000';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => { try { return JSON.parse(body); } catch { return null; } } }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function generateTestToken(payload = {}) {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    sub: 'test-user',
    orgId: 'test-org',
    roles: ['admin', 'template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view'],
    iat: now,
    exp: now + 3600,
    ...payload,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function runTests() {
  console.log('\n=== Feature #426: Fix dev token generation in Docker/production builds ===\n');

  // ---- Source Code Verification ----
  console.log('--- Bug 1: shouldUseDevToken() NODE_ENV guard removed ---');

  const devTokenSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'lib', 'dev-token.ts'),
    'utf-8'
  );

  // Check shouldUseDevToken no longer has production guard
  const shouldUseDevTokenMatch = devTokenSrc.match(/function shouldUseDevToken[\s\S]*?^}/m);
  assert(shouldUseDevTokenMatch, 'shouldUseDevToken function exists');

  const funcBody = shouldUseDevTokenMatch ? shouldUseDevTokenMatch[0] : '';
  assert(!funcBody.includes("process.env.NODE_ENV === 'production'"),
    'shouldUseDevToken does NOT check NODE_ENV === production');
  assert(!funcBody.includes('NODE_ENV'),
    'shouldUseDevToken has no NODE_ENV reference at all');
  assert(funcBody.includes('if (authToken) return false'),
    'shouldUseDevToken still checks for explicit authToken');
  assert(funcBody.includes('return true'),
    'shouldUseDevToken returns true when no explicit token');

  // ---- Bug 2: Client components use async generateDevToken ----
  console.log('\n--- Bug 2: Client components use async generateDevToken ---');

  const templatesPageSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'templates', 'page.tsx'),
    'utf-8'
  );

  assert(templatesPageSrc.includes("import { generateDevToken }"),
    'Templates page imports generateDevToken (async)');
  assert(!templatesPageSrc.includes("import { getAuthToken }") && !templatesPageSrc.includes("getAuthToken"),
    'Templates page does NOT use getAuthToken (sync)');
  assert(!templatesPageSrc.includes('generateDevTokenSync'),
    'Templates page does NOT use generateDevTokenSync');
  assert(templatesPageSrc.includes('useState'),
    'Templates page uses useState for authToken');
  assert(templatesPageSrc.includes('useEffect'),
    'Templates page uses useEffect for async token generation');
  assert(templatesPageSrc.includes('generateDevToken().then'),
    'Templates page calls generateDevToken().then(setAuthToken)');

  const mainPageSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'page.tsx'),
    'utf-8'
  );

  assert(mainPageSrc.includes("import { generateDevToken }"),
    'Main page imports generateDevToken (async)');
  assert(!mainPageSrc.includes("import { getAuthToken }") && !mainPageSrc.includes("getAuthToken"),
    'Main page does NOT use getAuthToken (sync)');
  assert(!mainPageSrc.includes('generateDevTokenSync'),
    'Main page does NOT use generateDevTokenSync');
  assert(mainPageSrc.includes('useState'),
    'Main page uses useState for authToken');
  assert(mainPageSrc.includes('useEffect'),
    'Main page uses useEffect for async token generation');
  assert(mainPageSrc.includes('generateDevToken().then'),
    'Main page calls generateDevToken().then(setAuthToken)');

  // Both pages should use 'use client'
  assert(templatesPageSrc.includes("'use client'"),
    'Templates page is a client component');
  assert(mainPageSrc.includes("'use client'"),
    'Main page is a client component');

  // ---- Explicit token handling ----
  console.log('\n--- Explicit authToken param honored ---');

  assert(templatesPageSrc.includes("searchParams.get('authToken')"),
    'Templates page reads authToken from URL params');
  assert(templatesPageSrc.includes('explicitToken'),
    'Templates page uses explicitToken variable');
  assert(templatesPageSrc.includes('if (!explicitToken)'),
    'Templates page only generates dev token when no explicit token');

  assert(mainPageSrc.includes("searchParams.get('authToken')"),
    'Main page reads authToken from URL params');
  assert(mainPageSrc.includes('explicitToken'),
    'Main page uses explicitToken variable');
  assert(mainPageSrc.includes('if (!explicitToken)'),
    'Main page only generates dev token when no explicit token');

  // ---- getAuthToken and generateDevTokenSync still available for server-side ----
  console.log('\n--- Server-side functions preserved ---');

  assert(devTokenSrc.includes('export function getAuthToken'),
    'getAuthToken is still exported for server-side usage');
  assert(devTokenSrc.includes('export function generateDevTokenSync'),
    'generateDevTokenSync is still exported for server-side usage');
  assert(devTokenSrc.includes('export async function generateDevToken'),
    'generateDevToken (async) is exported');

  // ---- Web Crypto API path in generateDevToken ----
  console.log('\n--- generateDevToken uses Web Crypto API for browser ---');

  assert(devTokenSrc.includes('window.crypto?.subtle'),
    'generateDevToken checks for Web Crypto API');
  assert(devTokenSrc.includes('crypto.subtle.importKey'),
    'generateDevToken uses subtle.importKey for HMAC');
  assert(devTokenSrc.includes('crypto.subtle.sign'),
    'generateDevToken uses subtle.sign for HMAC');

  // ---- Docker build verification ----
  console.log('\n--- Docker build verification ---');

  const templatesRes = await fetch(`${DESIGNER_BASE}/templates`);
  assert(templatesRes.status === 200, 'Templates page loads (HTTP 200) in Docker');
  assert(!templatesRes.body.includes('Missing or invalid Authorization'),
    'Templates page does NOT show auth error in initial HTML');

  const mainRes = await fetch(`${DESIGNER_BASE}/`);
  assert(mainRes.status === 200, 'Main page loads (HTTP 200) in Docker');
  assert(!mainRes.body.includes('Missing or invalid Authorization'),
    'Main page does NOT show auth error in initial HTML');

  // ---- API accepts dev token ----
  console.log('\n--- API accepts dev-generated token ---');

  const testToken = generateTestToken();
  const apiRes = await fetch(`${API_BASE}/templates`, {
    headers: { 'Authorization': `Bearer ${testToken}` },
  });
  assert(apiRes.status === 200, 'API /templates returns 200 with dev token');
  const apiData = apiRes.json();
  assert(apiData !== null, 'API returns valid JSON');

  // ---- API rejects missing token ----
  console.log('\n--- API rejects requests without token ---');

  const noAuthRes = await fetch(`${API_BASE}/templates`);
  assert(noAuthRes.status === 401, 'API returns 401 without auth token');

  // ---- Explicit token param works ----
  console.log('\n--- Explicit token via URL param ---');

  const explicitToken = generateTestToken({ sub: 'explicit-user', orgId: 'explicit-org' });
  const explicitRes = await fetch(`${DESIGNER_BASE}/templates?authToken=${explicitToken}`);
  assert(explicitRes.status === 200, 'Templates page loads with explicit authToken param');

  // ---- Client bundle checks ----
  console.log('\n--- Client bundle verification ---');

  const pageHtml = templatesRes.body;
  const chunkMatches = pageHtml.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [];
  assert(chunkMatches.length > 0, 'Page has JavaScript chunk references');

  let bundleHasWebCrypto = false;
  for (const chunkPath of chunkMatches) {
    try {
      const chunkRes = await fetch(`${DESIGNER_BASE}${chunkPath}`);
      if (chunkRes.body.includes('subtle') || chunkRes.body.includes('HMAC') || chunkRes.body.includes('HS256')) {
        bundleHasWebCrypto = true;
      }
    } catch {}
  }

  assert(bundleHasWebCrypto, 'Client bundle contains Web Crypto / JWT signing logic (may be minified)');

  // ---- No mock data patterns ----
  console.log('\n--- No mock data patterns ---');
  assert(!devTokenSrc.includes('mockData'), 'No mockData in dev-token.ts');
  assert(!devTokenSrc.includes('fakeData'), 'No fakeData in dev-token.ts');

  // ---- Summary ----
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
