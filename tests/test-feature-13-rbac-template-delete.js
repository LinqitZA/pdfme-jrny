/**
 * Feature #13: RBAC enforces template:delete permission
 *
 * Only users with template:delete role can archive templates.
 * Users without this permission get 403 Forbidden.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function request(method, path, token, bodyData) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(JSON.stringify(bodyData));
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write('  \u2705 ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  \u274C ' + name + '\n');
  }
}

async function createTestTemplate(token, suffix) {
  const res = await request('POST', '/api/pdfme/templates', token, {
    name: 'RBAC-Delete-Test-' + suffix,
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
  });
  return res.data.id;
}

async function run() {
  const orgId = 'rbac-delete-test-' + Date.now();

  // Template Admin: has template:delete plus view/edit for setup
  const adminToken = makeJwt({ sub: 'admin-user', orgId, roles: ['template:delete', 'template:edit', 'template:view'] });

  // Token with ONLY template:delete (per feature spec step 1)
  const deleteOnlyToken = makeJwt({ sub: 'delete-only-user', orgId, roles: ['template:delete'] });

  // Token with ONLY template:edit (per feature spec step 3) - no delete permission
  const editorToken = makeJwt({ sub: 'editor-user', orgId, roles: ['template:edit', 'template:view'] });

  // Token with no roles at all (basic user)
  const basicToken = makeJwt({ sub: 'basic-user', orgId, roles: [] });

  // Token with template:view only
  const viewerToken = makeJwt({ sub: 'viewer-user', orgId, roles: ['template:view'] });

  // Token with render:trigger only
  const renderToken = makeJwt({ sub: 'render-user', orgId, roles: ['render:trigger'] });

  console.log('\n=== Feature #13: RBAC enforces template:delete permission ===\n');

  // --- Test 1: User with template:delete CAN delete (per feature spec step 1-2) ---
  console.log('--- User with template:delete can delete ---');
  const tpl1 = await createTestTemplate(adminToken, '1');
  assert('Template created for delete test', !!tpl1);

  const del1 = await request('DELETE', '/api/pdfme/templates/' + tpl1, deleteOnlyToken);
  assert('DELETE with template:delete returns 200', del1.status === 200);
  assert('DELETE returns archived status', del1.data.status === 'archived');
  assert('DELETE returns correct id', del1.data.id === tpl1);

  // --- Test 2: Admin with full permissions can also delete ---
  console.log('\n--- Admin with full permissions can delete ---');
  const tpl2 = await createTestTemplate(adminToken, '2');
  assert('Template created for admin delete test', !!tpl2);

  const del2 = await request('DELETE', '/api/pdfme/templates/' + tpl2, adminToken);
  assert('Admin DELETE returns 200', del2.status === 200);
  assert('Admin DELETE returns archived status', del2.data.status === 'archived');

  // --- Test 3: Editor with template:edit only CANNOT delete (403) (per feature spec step 3-4) ---
  console.log('\n--- Editor with template:edit only gets 403 ---');
  const tpl3 = await createTestTemplate(adminToken, '3');
  assert('Template created for editor delete test', !!tpl3);

  const del3 = await request('DELETE', '/api/pdfme/templates/' + tpl3, editorToken);
  assert('Editor DELETE returns 403', del3.status === 403);
  assert('Editor DELETE error message mentions permissions',
    typeof del3.data.message === 'string' && del3.data.message.toLowerCase().includes('permission'));

  // Verify template is NOT archived (still accessible)
  const check3 = await request('GET', '/api/pdfme/templates/' + tpl3, adminToken);
  assert('Template still exists after forbidden delete', check3.status === 200);
  assert('Template status still draft', check3.data.status === 'draft');

  // --- Test 4: Viewer with template:view only CANNOT delete (403) ---
  console.log('\n--- Viewer with template:view only gets 403 ---');
  const tpl4 = await createTestTemplate(adminToken, '4');
  assert('Template created for viewer delete test', !!tpl4);

  const del4 = await request('DELETE', '/api/pdfme/templates/' + tpl4, viewerToken);
  assert('Viewer DELETE returns 403', del4.status === 403);

  // --- Test 5: Basic user with no roles CANNOT delete (403) ---
  console.log('\n--- Basic user with no roles gets 403 ---');
  const del5 = await request('DELETE', '/api/pdfme/templates/' + tpl4, basicToken);
  assert('Basic user DELETE returns 403', del5.status === 403);

  // --- Test 6: Render user CANNOT delete (403) ---
  console.log('\n--- Render user gets 403 ---');
  const del6 = await request('DELETE', '/api/pdfme/templates/' + tpl4, renderToken);
  assert('Render user DELETE returns 403', del6.status === 403);

  // --- Test 7: No auth at all gets 401 ---
  console.log('\n--- Unauthenticated request gets 401 ---');
  const del7 = await request('DELETE', '/api/pdfme/templates/' + tpl4);
  assert('No auth DELETE returns 401', del7.status === 401);

  // --- Test 8: Admin can delete template that editor couldn't ---
  console.log('\n--- Admin can delete template that editor could not ---');
  const del8 = await request('DELETE', '/api/pdfme/templates/' + tpl3, adminToken);
  assert('Admin DELETE of previously-forbidden template returns 200', del8.status === 200);
  assert('Template now archived', del8.data.status === 'archived');

  // --- Test 9: Different org admin cannot delete cross-org template ---
  console.log('\n--- Cross-org isolation ---');
  const otherOrgToken = makeJwt({ sub: 'other-admin', orgId: 'other-org-999', roles: ['template:delete', 'template:view'] });
  const del9 = await request('DELETE', '/api/pdfme/templates/' + tpl4, otherOrgToken);
  assert('Cross-org DELETE returns 404 (not found in their org)', del9.status === 404);

  // --- Test 10: Non-existent template returns 404 for authorized user ---
  console.log('\n--- Non-existent template returns 404 for admin ---');
  const del10 = await request('DELETE', '/api/pdfme/templates/non-existent-id-xyz', adminToken);
  assert('Non-existent template returns 404 for admin', del10.status === 404);

  // --- Test 11: 403 response has correct error structure ---
  console.log('\n--- Error response structure ---');
  const tpl5 = await createTestTemplate(adminToken, '5');
  const del11 = await request('DELETE', '/api/pdfme/templates/' + tpl5, editorToken);
  assert('403 response has statusCode field', del11.data.statusCode === 403);
  assert('403 response has error field', del11.data.error === 'Forbidden');
  assert('403 response has message field', typeof del11.data.message === 'string');

  // Cleanup remaining test templates
  await request('DELETE', '/api/pdfme/templates/' + tpl4, adminToken);
  await request('DELETE', '/api/pdfme/templates/' + tpl5, adminToken);

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) { console.error(err); process.exit(1); });
