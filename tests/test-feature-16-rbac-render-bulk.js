/**
 * Feature #16: RBAC enforces render:bulk permission
 *
 * Tests that only users with 'render:bulk' role can trigger bulk renders.
 * Users without this permission get 403 Forbidden.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
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
  process.stdout.write('=== Feature #16: RBAC enforces render:bulk permission ===\n\n');

  const bulkBody = {
    templateId: 'test-template',
    entityIds: ['entity-1', 'entity-2'],
    channel: 'email',
  };

  // Step 1: User with render:bulk permission can access bulk render
  process.stdout.write('Step 1: User with render:bulk role can POST /api/pdfme/render/bulk\n');

  const tokenWithBulk = makeToken({ sub: 'user-bulk', orgId: 'org-rbac-16', roles: ['render:bulk'] });
  const res1 = await request('POST', '/api/pdfme/render/bulk', tokenWithBulk, bulkBody);
  // Should NOT be 403 - may be 202 or 404 (template not found) or other non-permission error
  assert('render:bulk role gets past permission check (not 403)', res1.status !== 403);
  assert('render:bulk role returns 202 or template-related error', res1.status === 202 || res1.status === 404 || res1.status === 400 || res1.status === 500);

  // Step 2: User with render:trigger only gets 403
  process.stdout.write('\nStep 2: User with render:trigger only gets 403\n');

  const tokenTriggerOnly = makeToken({ sub: 'user-trigger', orgId: 'org-rbac-16', roles: ['render:trigger'] });
  const res2 = await request('POST', '/api/pdfme/render/bulk', tokenTriggerOnly, bulkBody);
  assert('render:trigger only returns 403', res2.status === 403);
  assert('Error message mentions insufficient permissions', typeof res2.data === 'object' && res2.data.message && res2.data.message.includes('permissions'));

  // Step 3: User with no roles gets 403
  process.stdout.write('\nStep 3: User with no roles gets 403\n');

  const tokenNoRoles = makeToken({ sub: 'user-noroles', orgId: 'org-rbac-16', roles: [] });
  const res3 = await request('POST', '/api/pdfme/render/bulk', tokenNoRoles, bulkBody);
  assert('Empty roles returns 403', res3.status === 403);

  // Step 4: User with multiple roles including render:bulk succeeds
  process.stdout.write('\nStep 4: User with multiple roles including render:bulk succeeds\n');

  const tokenMultiRoles = makeToken({ sub: 'user-multi', orgId: 'org-rbac-16', roles: ['template:view', 'render:bulk', 'template:edit'] });
  const res4 = await request('POST', '/api/pdfme/render/bulk', tokenMultiRoles, bulkBody);
  assert('Multiple roles with render:bulk passes permission check (not 403)', res4.status !== 403);

  // Step 5: User with unrelated roles gets 403
  process.stdout.write('\nStep 5: User with unrelated roles gets 403\n');

  const tokenUnrelated = makeToken({ sub: 'user-unrelated', orgId: 'org-rbac-16', roles: ['template:view', 'template:edit', 'system:seed'] });
  const res5 = await request('POST', '/api/pdfme/render/bulk', tokenUnrelated, bulkBody);
  assert('Unrelated roles (no render:bulk) returns 403', res5.status === 403);

  // Step 6: No auth header at all returns 401
  process.stdout.write('\nStep 6: No auth returns 401\n');

  const res6 = await request('POST', '/api/pdfme/render/bulk', null, bulkBody);
  assert('No auth header returns 401', res6.status === 401);

  // Step 7: render:now endpoint does NOT require render:bulk
  process.stdout.write('\nStep 7: render:now endpoint does NOT require render:bulk permission\n');

  const tokenTriggerNow = makeToken({ sub: 'user-trigger', orgId: 'org-rbac-16', roles: ['render:trigger'] });
  const res7 = await request('POST', '/api/pdfme/render/now', tokenTriggerNow, { templateId: 'test', entityId: 'e1', channel: 'email' });
  assert('render:trigger can access /render/now (not 403)', res7.status !== 403);

  // Step 8: Error response format is correct for 403
  process.stdout.write('\nStep 8: 403 error response format\n');

  assert('403 response has statusCode field', typeof res2.data === 'object' && res2.data.statusCode === 403);
  assert('403 response has error field', typeof res2.data === 'object' && res2.data.error === 'Forbidden');
  assert('403 response mentions render:bulk in message', typeof res2.data === 'object' && res2.data.message && res2.data.message.includes('render:bulk'));

  // Summary
  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
