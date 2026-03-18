/**
 * Feature #10: RBAC enforces template:view permission
 * Only users with template:view can list/view templates
 */
const crypto = require('crypto');
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
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
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function run() {
  const viewToken = makeToken('rbac-v-10', 'org-rbac-10', ['template:view']);
  const noRolesToken = makeToken('rbac-n-10', 'org-rbac-10', []);
  const fullToken = makeToken('rbac-f-10', 'org-rbac-10', ['template:view', 'template:edit', 'template:publish']);

  console.log('Feature #10: RBAC enforces template:view permission');
  console.log('');

  // Step 1: Create JWT with roles=['template:view']
  console.log('Step 1: User with template:view can list templates');
  const listRes = await request('GET', '/api/pdfme/templates', viewToken);
  assert(listRes.status === 200, 'GET /api/pdfme/templates returns 200 with template:view role');
  assert(Array.isArray(listRes.body.data), 'Response contains data array');

  // Step 2: Create a template to test getById
  console.log('Step 2: Create a template for view testing');
  const createRes = await request('POST', '/api/pdfme/templates', fullToken, {
    name: 'RBAC View Test F10',
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] }
  });
  assert(createRes.status === 201, 'Template created successfully');
  const templateId = createRes.body.id;

  // Step 3: User with template:view can get by ID
  console.log('Step 3: User with template:view can get template by ID');
  const getRes = await request('GET', '/api/pdfme/templates/' + templateId, viewToken);
  assert(getRes.status === 200, 'GET /api/pdfme/templates/:id returns 200 with template:view role');
  assert(getRes.body.id === templateId, 'Correct template returned');

  // Step 4: User with NO roles gets 403 on list
  console.log('Step 4: User with no roles gets 403 on list');
  const list403 = await request('GET', '/api/pdfme/templates', noRolesToken);
  assert(list403.status === 403, 'GET /api/pdfme/templates returns 403 with no roles');
  assert(list403.body.message && list403.body.message.includes('Insufficient permissions'), 'Error message mentions insufficient permissions');

  // Step 5: User with NO roles gets 403 on get by ID
  console.log('Step 5: User with no roles gets 403 on get by ID');
  const get403 = await request('GET', '/api/pdfme/templates/' + templateId, noRolesToken);
  assert(get403.status === 403, 'GET /api/pdfme/templates/:id returns 403 with no roles');
  assert(get403.body.message && get403.body.message.includes('Insufficient permissions'), 'Error message mentions insufficient permissions on getById');

  // Step 6: User with template:edit only (no view) gets 403 on list
  console.log('Step 6: User with template:edit only (no view) gets 403');
  const editOnlyToken = makeToken('rbac-eo-10', 'org-rbac-10', ['template:edit']);
  const editList = await request('GET', '/api/pdfme/templates', editOnlyToken);
  assert(editList.status === 403, 'GET /api/pdfme/templates returns 403 with only template:edit (no template:view)');

  // Step 7: Error message format is correct
  console.log('Step 7: Error message format verification');
  assert(list403.body.statusCode === 403, 'Error body includes statusCode 403');
  assert(list403.body.error === 'Forbidden', 'Error body includes error: Forbidden');
  assert(typeof list403.body.message === 'string', 'Error body includes message string');

  // Step 8: Types endpoint also requires template:view
  console.log('Step 8: Types endpoint also requires template:view');
  const typesRes = await request('GET', '/api/pdfme/templates/types', viewToken);
  assert(typesRes.status === 200, 'GET /api/pdfme/templates/types returns 200 with template:view');
  const types403 = await request('GET', '/api/pdfme/templates/types', noRolesToken);
  assert(types403.status === 403, 'GET /api/pdfme/templates/types returns 403 with no roles');

  // Step 9: Versions endpoint also requires template:view
  console.log('Step 9: Version history requires template:view');
  const versRes = await request('GET', '/api/pdfme/templates/' + templateId + '/versions', viewToken);
  assert(versRes.status === 200, 'GET versions returns 200 with template:view');
  const vers403 = await request('GET', '/api/pdfme/templates/' + templateId + '/versions', noRolesToken);
  assert(vers403.status === 403, 'GET versions returns 403 with no roles');

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId, fullToken);

  console.log('');
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
