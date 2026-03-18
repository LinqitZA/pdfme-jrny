/**
 * Feature #17: RBAC enforces system:seed permission
 *
 * Tests that only users with 'system:seed' role can trigger system template seeding.
 * Users without this permission get 403 Forbidden.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

function makeToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write('  ✅ ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  ❌ ' + name + '\n');
  }
}

async function run() {
  process.stdout.write('=== Feature #17: RBAC enforces system:seed permission ===\n\n');

  // Step 1: User with system:seed permission can trigger seeding
  process.stdout.write('Step 1: User with system:seed role can POST /api/pdfme/system/seed\n');

  const tokenWithSeed = makeToken({ sub: 'super-admin', orgId: 'org-admin', roles: ['system:seed'] });
  const res1 = await request('POST', '/api/pdfme/system/seed', tokenWithSeed, {});
  assert('system:seed role returns 200', res1.status === 200);
  assert('Response indicates success', typeof res1.data === 'object' && res1.data.success === true);
  assert('Response has message', typeof res1.data === 'object' && typeof res1.data.message === 'string');

  // Step 2: User without system:seed gets 403
  process.stdout.write('\nStep 2: User without system:seed role gets 403\n');

  const tokenNoSeed = makeToken({ sub: 'regular-user', orgId: 'org-admin', roles: ['template:view', 'template:edit', 'render:bulk'] });
  const res2 = await request('POST', '/api/pdfme/system/seed', tokenNoSeed, {});
  assert('Without system:seed returns 403', res2.status === 403);
  assert('403 response has Forbidden error', typeof res2.data === 'object' && res2.data.error === 'Forbidden');
  assert('403 message mentions permissions', typeof res2.data === 'object' && res2.data.message && res2.data.message.includes('permissions'));
  assert('403 message mentions system:seed', typeof res2.data === 'object' && res2.data.message && res2.data.message.includes('system:seed'));

  // Step 3: User with empty roles gets 403
  process.stdout.write('\nStep 3: User with empty roles gets 403\n');

  const tokenEmpty = makeToken({ sub: 'empty-user', orgId: 'org-admin', roles: [] });
  const res3 = await request('POST', '/api/pdfme/system/seed', tokenEmpty, {});
  assert('Empty roles returns 403', res3.status === 403);

  // Step 4: No auth returns 401
  process.stdout.write('\nStep 4: No auth returns 401\n');

  const res4 = await request('POST', '/api/pdfme/system/seed', null, {});
  assert('No auth returns 401', res4.status === 401);

  // Step 5: User with system:seed among multiple roles succeeds
  process.stdout.write('\nStep 5: User with system:seed among multiple roles succeeds\n');

  const tokenMulti = makeToken({ sub: 'admin-multi', orgId: 'org-admin', roles: ['template:view', 'system:seed', 'render:bulk'] });
  const res5 = await request('POST', '/api/pdfme/system/seed', tokenMulti, {});
  assert('Multiple roles with system:seed returns 200', res5.status === 200);
  assert('Seed succeeds with multiple roles', typeof res5.data === 'object' && res5.data.success === true);

  // Step 6: Seeding is idempotent - can run twice
  process.stdout.write('\nStep 6: Seeding is idempotent\n');

  const res6 = await request('POST', '/api/pdfme/system/seed', tokenWithSeed, {});
  assert('Second seed also returns 200', res6.status === 200);
  assert('Second seed also succeeds', typeof res6.data === 'object' && res6.data.success === true);

  // Step 7: Verify system templates exist after seeding
  process.stdout.write('\nStep 7: System templates exist after seeding\n');

  const tokenView = makeToken({ sub: 'viewer', orgId: 'org-admin', roles: ['template:view'] });
  const res7 = await request('GET', '/api/pdfme/templates/system', tokenView, null);
  assert('System templates endpoint returns 200', res7.status === 200);
  assert('System templates data is array', typeof res7.data === 'object' && Array.isArray(res7.data.data));
  assert('At least one system template exists', res7.data.data && res7.data.data.length > 0);

  // Summary
  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
