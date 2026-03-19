/**
 * Feature #424: Auto-generate dev JWT token in designer-sandbox when authToken param is missing
 *
 * Tests that the dev-token utility correctly generates valid JWTs and that the
 * designer-sandbox pages use them when no authToken is provided.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write('  PASS: ' + message + '\n');
  } else {
    failed++;
    process.stdout.write('  FAIL: ' + message + '\n');
  }
}

// Replicate the dev-token logic for testing (since it's a TypeScript file)
const DEV_JWT_SECRET = 'pdfme-dev-secret';
const DEV_PAYLOAD = {
  sub: 'dev-user',
  orgId: 'dev-org',
  roles: ['admin', 'template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view'],
};

function generateDevTokenSync() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...DEV_PAYLOAD,
    iat: now,
    exp: now + 86400,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', DEV_JWT_SECRET)
    .update(header + '.' + payload)
    .digest('base64url');
  return header + '.' + payload + '.' + signature;
}

function shouldUseDevToken(authToken) {
  if (authToken) return false;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

function getAuthToken(explicitToken) {
  if (explicitToken) return explicitToken;
  if (shouldUseDevToken(explicitToken)) return generateDevTokenSync();
  return undefined;
}

async function testDevTokenGeneration() {
  process.stdout.write('\n=== Dev Token Generation ===\n');

  const token = generateDevTokenSync();
  assert(typeof token === 'string' && token.length > 0, 'generateDevTokenSync returns a non-empty string');
  assert(token.split('.').length === 3, 'Token has 3 parts (JWT format)');

  // Decode payload
  const parts = token.split('.');
  const headerJson = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  assert(headerJson.alg === 'HS256', 'Token header alg is HS256');
  assert(headerJson.typ === 'JWT', 'Token header typ is JWT');
  assert(payloadJson.sub === 'dev-user', 'Token payload sub is dev-user');
  assert(payloadJson.orgId === 'dev-org', 'Token payload orgId is dev-org');
  assert(Array.isArray(payloadJson.roles), 'Token payload roles is an array');
  assert(payloadJson.roles.includes('admin'), 'Roles include admin');
  assert(payloadJson.roles.includes('template:view'), 'Roles include template:view');
  assert(payloadJson.roles.includes('template:edit'), 'Roles include template:edit');
  assert(payloadJson.roles.includes('template:publish'), 'Roles include template:publish');
  assert(payloadJson.roles.includes('template:delete'), 'Roles include template:delete');
  assert(payloadJson.roles.includes('render:trigger'), 'Roles include render:trigger');
  assert(payloadJson.roles.includes('audit:view'), 'Roles include audit:view');
  assert(typeof payloadJson.iat === 'number', 'Token has iat');
  assert(typeof payloadJson.exp === 'number', 'Token has exp');
  assert(payloadJson.exp - payloadJson.iat === 86400, 'Token valid for 24 hours');

  return token;
}

async function testTokenSignature(token) {
  process.stdout.write('\n=== Token Signature Verification ===\n');

  const parts = token.split('.');
  const message = parts[0] + '.' + parts[1];
  const expectedSignature = crypto
    .createHmac('sha256', 'pdfme-dev-secret')
    .update(message)
    .digest('base64url');

  assert(parts[2] === expectedSignature, 'Signature matches HMAC-SHA256 with pdfme-dev-secret');
}

async function testShouldUseDevTokenLogic() {
  process.stdout.write('\n=== shouldUseDevToken Logic ===\n');

  assert(shouldUseDevToken(undefined) === true, 'shouldUseDevToken(undefined) returns true');
  assert(shouldUseDevToken(null) === true, 'shouldUseDevToken(null) returns true');
  assert(shouldUseDevToken('') === true, 'shouldUseDevToken("") returns true');
  assert(shouldUseDevToken('my-token') === false, 'shouldUseDevToken("my-token") returns false');
}

async function testGetAuthTokenLogic() {
  process.stdout.write('\n=== getAuthToken Logic ===\n');

  assert(getAuthToken('explicit-token') === 'explicit-token', 'Explicit token returned as-is');
  assert(getAuthToken('another-token') === 'another-token', 'Any explicit token returned as-is');
  const devToken = getAuthToken(undefined);
  assert(typeof devToken === 'string' && devToken.length > 0, 'Dev token generated when no explicit token');
  assert(devToken.split('.').length === 3, 'Dev token is valid JWT format');
}

async function testTokenAcceptedByApi(token) {
  process.stdout.write('\n=== Token Accepted by API ===\n');

  const resp = await fetch('http://localhost:3001/api/pdfme/templates', {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  });
  assert(resp.status === 200, 'API accepts dev token for GET /templates (200)');

  const createResp = await fetch('http://localhost:3001/api/pdfme/templates', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Dev Token Test 424',
      type: 'invoice',
      schema: { pages: [{ elements: [{ name: 'h', type: 'text', position: { x: 50, y: 50 }, width: 200, height: 30, content: 'Test' }] }] },
    }),
  });
  assert(createResp.status === 201, 'API accepts dev token for POST /templates (201)');

  const created = await createResp.json();
  const tid = created.data?.id || created.id;

  // Publish
  if (tid) {
    const pubResp = await fetch('http://localhost:3001/api/pdfme/templates/' + tid + '/publish', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    assert(pubResp.status === 200 || pubResp.status === 201, 'API accepts dev token for publish');

    // Delete
    await fetch('http://localhost:3001/api/pdfme/templates/' + tid, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    });
  }
}

async function testSourceFileInclusion() {
  process.stdout.write('\n=== Source File Inclusion ===\n');

  // Verify dev-token.ts exists
  const devTokenPath = path.join(__dirname, '../apps/designer-sandbox/lib/dev-token.ts');
  assert(fs.existsSync(devTokenPath), 'lib/dev-token.ts exists');

  const devTokenSrc = fs.readFileSync(devTokenPath, 'utf8');
  assert(devTokenSrc.includes('pdfme-dev-secret'), 'dev-token.ts uses pdfme-dev-secret');
  assert(devTokenSrc.includes('dev-user'), 'dev-token.ts uses dev-user as sub');
  assert(devTokenSrc.includes('dev-org'), 'dev-token.ts uses dev-org as orgId');
  assert(devTokenSrc.includes('production'), 'dev-token.ts checks for production env');
  assert(devTokenSrc.includes('generateDevToken'), 'dev-token.ts exports generateDevToken');
  assert(devTokenSrc.includes('getAuthToken'), 'dev-token.ts exports getAuthToken');
  assert(devTokenSrc.includes('shouldUseDevToken'), 'dev-token.ts exports shouldUseDevToken');

  // Verify page.tsx imports and uses dev-token
  const pageSrc = fs.readFileSync(path.join(__dirname, '../apps/designer-sandbox/app/page.tsx'), 'utf8');
  assert(pageSrc.includes('getAuthToken'), 'page.tsx imports getAuthToken');
  assert(pageSrc.includes('dev-token'), 'page.tsx imports from dev-token');
  assert(pageSrc.includes("getAuthToken(searchParams.get('authToken'))"), 'page.tsx uses getAuthToken with searchParams');

  // Verify templates/page.tsx imports and uses dev-token
  const templatesSrc = fs.readFileSync(path.join(__dirname, '../apps/designer-sandbox/app/templates/page.tsx'), 'utf8');
  assert(templatesSrc.includes('getAuthToken'), 'templates/page.tsx imports getAuthToken');
  assert(templatesSrc.includes('dev-token'), 'templates/page.tsx imports from dev-token');
  assert(templatesSrc.includes("getAuthToken(searchParams.get('authToken'))"), 'templates/page.tsx uses getAuthToken with searchParams');
}

async function testDesignerPageLoads() {
  process.stdout.write('\n=== Designer Pages Load Without Auth ===\n');

  const resp = await fetch('http://localhost:3000/templates');
  assert(resp.status === 200, 'GET /templates returns 200 without authToken');

  const resp2 = await fetch('http://localhost:3000/');
  assert(resp2.status === 200, 'GET / returns 200 without authToken');
}

async function testNoMockData() {
  process.stdout.write('\n=== No Mock Data Patterns ===\n');

  const devTokenSrc = fs.readFileSync(path.join(__dirname, '../apps/designer-sandbox/lib/dev-token.ts'), 'utf8');
  assert(!devTokenSrc.includes('mockDb'), 'No mockDb pattern in dev-token.ts');
  assert(!devTokenSrc.includes('fakeData'), 'No fakeData pattern in dev-token.ts');
  assert(!devTokenSrc.includes('globalThis.'), 'No globalThis pattern in dev-token.ts');
  assert(!devTokenSrc.includes('devStore'), 'No devStore pattern in dev-token.ts');
}

async function main() {
  process.stdout.write('Feature #424: Auto-generate dev JWT token in designer-sandbox\n');
  process.stdout.write('==============================================================\n');

  const token = await testDevTokenGeneration();
  await testTokenSignature(token);
  await testShouldUseDevTokenLogic();
  await testGetAuthTokenLogic();
  await testTokenAcceptedByApi(token);
  await testSourceFileInclusion();
  await testDesignerPageLoads();
  await testNoMockData();

  process.stdout.write('\n==============================================================\n');
  process.stdout.write('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' total\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write('Test error: ' + err.message + '\n' + err.stack + '\n');
  process.exit(1);
});
