/**
 * Feature #15: RBAC enforces render:trigger permission
 *
 * Users with render:trigger can render PDFs via POST /api/pdfme/render/now.
 * Users without this permission get 403 Forbidden.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

function makeJwt(payload) {
  var header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  var sig = crypto.createHmac('sha256', SECRET).update(header + '.' + body).digest('base64url');
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

async function run() {
  var orgId = 'rbac-render-test-' + Date.now();

  // Setup token (needs template permissions to create/publish a template)
  var setupToken = makeJwt({ sub: 'setup-user', orgId: orgId, roles: ['template:edit', 'template:view', 'template:publish', 'render:trigger'] });

  // Token with render:trigger (per feature spec step 1)
  var renderToken = makeJwt({ sub: 'render-user', orgId: orgId, roles: ['render:trigger'] });

  // Token with no roles (per feature spec step 3)
  var noRolesToken = makeJwt({ sub: 'norole-user', orgId: orgId, roles: [] });

  // Token with template:edit only (no render:trigger)
  var editorToken = makeJwt({ sub: 'editor-user', orgId: orgId, roles: ['template:edit', 'template:view'] });

  // Token with template:view only
  var viewerToken = makeJwt({ sub: 'viewer-user', orgId: orgId, roles: ['template:view'] });

  console.log('\n=== Feature #15: RBAC enforces render:trigger permission ===\n');

  // --- Setup: Create and publish a template ---
  console.log('--- Setup: Create and publish template ---');

  var createRes = await request('POST', '/api/pdfme/templates', setupToken, {
    name: 'RBAC-Render-Test',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'companyName', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test Company' },
          { name: 'invoiceNum', type: 'text', position: { x: 10, y: 35 }, width: 100, height: 15, content: '{document.number}' },
        ],
      }],
    },
  });
  var templateId = createRes.data.id;
  assert('Template created', !!templateId);

  // Publish template
  var pubRes = await request('POST', '/api/pdfme/templates/' + templateId + '/publish', setupToken);
  var published = pubRes.status === 200 || pubRes.status === 201;
  assert('Template published', published && pubRes.data.status === 'published');

  var renderBody = {
    templateId: templateId,
    entityId: 'test-entity-1',
    channel: 'email',
    inputs: [{ 'document.number': 'INV-RBAC-001' }],
  };

  // --- Test 1: User with render:trigger CAN render (per feature spec step 1-2) ---
  console.log('\n--- User with render:trigger can render ---');
  var r1 = await request('POST', '/api/pdfme/render/now', renderToken, renderBody);
  assert('Render with render:trigger returns 200/201', r1.status === 200 || r1.status === 201);
  assert('Render returns document object', !!(r1.data.document && r1.data.document.id));
  assert('Document status is done', r1.data.document && r1.data.document.status === 'done');

  if (r1.status !== 200) {
    console.log('  (Render result: ' + r1.status + ' ' + JSON.stringify(r1.data).substring(0, 200) + ')');
  }

  // --- Test 2: Setup user with render:trigger can also render ---
  console.log('\n--- Full user with render:trigger can render ---');
  var r2 = await request('POST', '/api/pdfme/render/now', setupToken, renderBody);
  assert('Full user render returns 200/201', r2.status === 200 || r2.status === 201);

  // --- Test 3: User with no roles CANNOT render (403) (per feature spec step 3-4) ---
  console.log('\n--- User with no roles gets 403 ---');
  var r3 = await request('POST', '/api/pdfme/render/now', noRolesToken, renderBody);
  assert('No roles render returns 403', r3.status === 403);
  assert('Error message mentions permissions', typeof r3.data.message === 'string' && r3.data.message.toLowerCase().includes('permission'));

  // --- Test 4: Editor without render:trigger CANNOT render (403) ---
  console.log('\n--- Editor without render:trigger gets 403 ---');
  var r4 = await request('POST', '/api/pdfme/render/now', editorToken, renderBody);
  assert('Editor render returns 403', r4.status === 403);

  // --- Test 5: Viewer without render:trigger CANNOT render (403) ---
  console.log('\n--- Viewer gets 403 ---');
  var r5 = await request('POST', '/api/pdfme/render/now', viewerToken, renderBody);
  assert('Viewer render returns 403', r5.status === 403);

  // --- Test 6: Unauthenticated request gets 401 ---
  console.log('\n--- Unauthenticated request gets 401 ---');
  var r6 = await request('POST', '/api/pdfme/render/now', null, renderBody);
  assert('No auth render returns 401', r6.status === 401);

  // --- Test 7: 403 error response structure ---
  console.log('\n--- Error response structure ---');
  assert('403 response has statusCode', r3.data.statusCode === 403);
  assert('403 response has error field', r3.data.error === 'Forbidden');
  assert('403 response has message', typeof r3.data.message === 'string');
  assert('403 message mentions render:trigger', r3.data.message.includes('render:trigger'));

  // --- Test 8: Permission check before body validation ---
  console.log('\n--- Permission check before body validation ---');
  var r8 = await request('POST', '/api/pdfme/render/now', noRolesToken, {});
  assert('Empty body with no roles still returns 403 (not 400)', r8.status === 403);

  // --- Test 9: Different permission combinations ---
  console.log('\n--- Permission combinations ---');
  var renderBulkToken = makeJwt({ sub: 'bulk-user', orgId: orgId, roles: ['render:bulk'] });
  var r9 = await request('POST', '/api/pdfme/render/now', renderBulkToken, renderBody);
  assert('render:bulk alone cannot trigger render (403)', r9.status === 403);

  var deleteToken = makeJwt({ sub: 'delete-user', orgId: orgId, roles: ['template:delete'] });
  var r10 = await request('POST', '/api/pdfme/render/now', deleteToken, renderBody);
  assert('template:delete alone cannot trigger render (403)', r10.status === 403);

  // --- Test 10: Cross-org with render:trigger but wrong org ---
  console.log('\n--- Cross-org render passes auth but fails on data ---');
  var otherOrgToken = makeJwt({ sub: 'other-user', orgId: 'other-org-render', roles: ['render:trigger'] });
  var r11 = await request('POST', '/api/pdfme/render/now', otherOrgToken, renderBody);
  assert('Cross-org passes RBAC (not 403)', r11.status !== 403);
  assert('Cross-org fails on business logic (template not accessible)', r11.status !== 200);

  // Cleanup
  var cleanupToken = makeJwt({ sub: 'cleanup', orgId: orgId, roles: ['template:delete'] });
  await request('DELETE', '/api/pdfme/templates/' + templateId, cleanupToken);

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) { console.error(err); process.exit(1); });
