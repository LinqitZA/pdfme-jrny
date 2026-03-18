/**
 * Feature #14: RBAC enforces template:import permission
 *
 * Only users with template:import role can import templates.
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
  return new Promise(function(resolve, reject) {
    var url = new URL(BASE + path);
    var options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
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

function makeImportPackage(name) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: name,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: { images: [], fonts: [] },
  };
}

async function run() {
  var orgId = 'rbac-import-test-' + Date.now();

  // Token with template:import permission (Template Admin)
  var importToken = makeJwt({ sub: 'import-admin', orgId: orgId, roles: ['template:import'] });

  // Token with template:import plus view/edit (full admin)
  var fullAdminToken = makeJwt({ sub: 'full-admin', orgId: orgId, roles: ['template:import', 'template:edit', 'template:view', 'template:delete'] });

  // Token with only template:edit (no import)
  var editorToken = makeJwt({ sub: 'editor', orgId: orgId, roles: ['template:edit', 'template:view'] });

  // Token with only template:view
  var viewerToken = makeJwt({ sub: 'viewer', orgId: orgId, roles: ['template:view'] });

  // Token with no roles
  var basicToken = makeJwt({ sub: 'basic', orgId: orgId, roles: [] });

  console.log('\n=== Feature #14: RBAC enforces template:import permission ===\n');

  // --- Test 1: User with template:import CAN import (per feature spec step 1-2) ---
  console.log('--- User with template:import can import ---');
  var imp1 = await request('POST', '/api/pdfme/templates/import', importToken, makeImportPackage('Import-Test-1'));
  assert('Import with template:import returns 201', imp1.status === 201);
  assert('Import returns template id', !!imp1.data.id);
  assert('Import returns template name', imp1.data.name === 'Import-Test-1');

  // --- Test 2: Full admin with template:import can import ---
  console.log('\n--- Full admin can import ---');
  var imp2 = await request('POST', '/api/pdfme/templates/import', fullAdminToken, makeImportPackage('Import-Test-2'));
  assert('Full admin import returns 201', imp2.status === 201);
  assert('Full admin import returns template id', !!imp2.data.id);

  // --- Test 3: Editor without template:import CANNOT import (403) (per feature spec step 3-4) ---
  console.log('\n--- Editor without template:import gets 403 ---');
  var imp3 = await request('POST', '/api/pdfme/templates/import', editorToken, makeImportPackage('Import-Test-3'));
  assert('Editor import returns 403', imp3.status === 403);
  assert('Error message mentions permissions', typeof imp3.data.message === 'string' && imp3.data.message.toLowerCase().includes('permission'));

  // --- Test 4: Viewer cannot import (403) ---
  console.log('\n--- Viewer gets 403 ---');
  var imp4 = await request('POST', '/api/pdfme/templates/import', viewerToken, makeImportPackage('Import-Test-4'));
  assert('Viewer import returns 403', imp4.status === 403);

  // --- Test 5: Basic user with no roles cannot import (403) ---
  console.log('\n--- Basic user with no roles gets 403 ---');
  var imp5 = await request('POST', '/api/pdfme/templates/import', basicToken, makeImportPackage('Import-Test-5'));
  assert('Basic user import returns 403', imp5.status === 403);

  // --- Test 6: Unauthenticated request gets 401 ---
  console.log('\n--- Unauthenticated request gets 401 ---');
  var imp6 = await request('POST', '/api/pdfme/templates/import', null, makeImportPackage('Import-Test-6'));
  assert('No auth import returns 401', imp6.status === 401);

  // --- Test 7: Imported template is accessible to the same org ---
  console.log('\n--- Imported template accessible via GET ---');
  var getImp = await request('GET', '/api/pdfme/templates/' + imp1.data.id, fullAdminToken);
  assert('Imported template retrievable', getImp.status === 200);
  assert('Imported template name matches', getImp.data.name === 'Import-Test-1');
  assert('Imported template status is draft', getImp.data.status === 'draft');

  // --- Test 8: Cross-org isolation ---
  console.log('\n--- Cross-org isolation ---');
  var otherOrgToken = makeJwt({ sub: 'other-admin', orgId: 'other-org-import-test', roles: ['template:import', 'template:view'] });
  var getCrossOrg = await request('GET', '/api/pdfme/templates/' + imp1.data.id, otherOrgToken);
  assert('Cross-org cannot access imported template (404)', getCrossOrg.status === 404);

  // --- Test 9: 403 response structure ---
  console.log('\n--- Error response structure ---');
  assert('403 response has statusCode', imp3.data.statusCode === 403);
  assert('403 response has error field', imp3.data.error === 'Forbidden');
  assert('403 response has message', typeof imp3.data.message === 'string');

  // Cleanup: delete imported templates
  var cleanupToken = makeJwt({ sub: 'cleanup', orgId: orgId, roles: ['template:delete', 'template:view'] });
  if (imp1.data.id) await request('DELETE', '/api/pdfme/templates/' + imp1.data.id, cleanupToken);
  if (imp2.data.id) await request('DELETE', '/api/pdfme/templates/' + imp2.data.id, cleanupToken);

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) { console.error(err); process.exit(1); });
