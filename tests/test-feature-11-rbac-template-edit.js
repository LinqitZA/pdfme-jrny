/**
 * Feature #11: RBAC enforces template:edit permission
 * Only Template Designer+ can save draft templates
 */
const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000';
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
  const editToken = makeToken('rbac-e-11', 'org-rbac-11', ['template:edit', 'template:view']);
  const viewOnlyToken = makeToken('rbac-v-11', 'org-rbac-11', ['template:view']);
  const noRolesToken = makeToken('rbac-n-11', 'org-rbac-11', []);
  const fullToken = makeToken('rbac-f-11', 'org-rbac-11', ['template:view', 'template:edit', 'template:publish']);

  console.log('Feature #11: RBAC enforces template:edit permission');
  console.log('');

  // Step 1: Create a template
  console.log('Step 1: Create a template for edit testing');
  const createRes = await request('POST', '/api/pdfme/templates', fullToken, {
    name: 'RBAC Edit Test F11',
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] }
  });
  assert(createRes.status === 201, 'Template created for edit testing');
  const templateId = createRes.body.id;

  // Step 2: User with template:edit can save draft
  console.log('Step 2: User with template:edit can save draft');
  const draftBody = {
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title-edited', x: 10, y: 10, width: 100, height: 10 }] }] }
  };
  const editRes = await request('PUT', '/api/pdfme/templates/' + templateId + '/draft', editToken, draftBody);
  assert(editRes.status === 200, 'PUT /api/pdfme/templates/:id/draft returns 200 with template:edit role');

  // Step 3: User with template:view only gets 403
  console.log('Step 3: User with template:view only gets 403 on draft save');
  const view403 = await request('PUT', '/api/pdfme/templates/' + templateId + '/draft', viewOnlyToken, draftBody);
  assert(view403.status === 403, 'PUT /api/pdfme/templates/:id/draft returns 403 with only template:view');
  assert(view403.body.message && view403.body.message.includes('Insufficient permissions'), 'Error mentions insufficient permissions');
  assert(view403.body.message && view403.body.message.includes('template:edit'), 'Error mentions template:edit permission');

  // Step 4: User with no roles gets 403
  console.log('Step 4: User with no roles gets 403 on draft save');
  const noRoles403 = await request('PUT', '/api/pdfme/templates/' + templateId + '/draft', noRolesToken, draftBody);
  assert(noRoles403.status === 403, 'PUT /api/pdfme/templates/:id/draft returns 403 with no roles');

  // Step 5: Error envelope structure
  console.log('Step 5: Error envelope format');
  assert(view403.body.statusCode === 403, 'Error has statusCode 403');
  assert(view403.body.error === 'Forbidden', 'Error has error: Forbidden');

  // Step 6: Full access token can also save draft
  console.log('Step 6: Full access token can save draft');
  const fullDraft = await request('PUT', '/api/pdfme/templates/' + templateId + '/draft', fullToken, draftBody);
  assert(fullDraft.status === 200, 'PUT draft returns 200 with full access token');

  // Step 7: Verify draft was actually saved
  console.log('Step 7: Verify draft was saved');
  const getRes = await request('GET', '/api/pdfme/templates/' + templateId, editToken);
  assert(getRes.status === 200, 'Can retrieve template after draft save');

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId, fullToken);

  console.log('');
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
