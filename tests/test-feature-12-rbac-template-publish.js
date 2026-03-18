/**
 * Feature #12: RBAC enforces template:publish permission
 * Only Template Admin can publish templates
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
  const publishToken = makeToken('rbac-p-12', 'org-rbac-12', ['template:view', 'template:edit', 'template:publish']);
  const editOnlyToken = makeToken('rbac-eo-12', 'org-rbac-12', ['template:view', 'template:edit']);
  const viewOnlyToken = makeToken('rbac-vo-12', 'org-rbac-12', ['template:view']);
  const fullToken = publishToken;

  console.log('Feature #12: RBAC enforces template:publish permission');
  console.log('');

  // Step 1: Create a template for publish testing
  console.log('Step 1: Create template for publish testing');
  const createRes = await request('POST', '/api/pdfme/templates', fullToken, {
    name: 'RBAC Publish Test F12',
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title', x: 10, y: 10, width: 100, height: 10 }] }] }
  });
  assert(createRes.status === 201, 'Template created for publish testing');
  const templateId1 = createRes.body.id;

  // Step 2: User with template:publish can publish
  console.log('Step 2: User with template:publish can publish');
  const pubRes = await request('POST', '/api/pdfme/templates/' + templateId1 + '/publish', publishToken);
  assert(pubRes.status === 201 || pubRes.status === 200, 'POST /api/pdfme/templates/:id/publish succeeds with template:publish role');
  assert(pubRes.body.status === 'published', 'Template status changed to published');

  // Step 3: Create another template to test rejection
  console.log('Step 3: Create another template for rejection test');
  const createRes2 = await request('POST', '/api/pdfme/templates', fullToken, {
    name: 'RBAC Publish Reject F12',
    type: 'invoice',
    schema: { basePdf: { width: 210, height: 297 }, pages: [{ elements: [{ type: 'text', name: 'title2', x: 10, y: 10, width: 100, height: 10 }] }] }
  });
  assert(createRes2.status === 201, 'Second template created');
  const templateId2 = createRes2.body.id;

  // Step 4: User with template:edit only (no publish) gets 403
  console.log('Step 4: User with template:edit only gets 403 on publish');
  const edit403 = await request('POST', '/api/pdfme/templates/' + templateId2 + '/publish', editOnlyToken);
  assert(edit403.status === 403, 'POST /api/pdfme/templates/:id/publish returns 403 with only template:edit');
  assert(edit403.body.message && edit403.body.message.includes('Insufficient permissions'), 'Error mentions insufficient permissions');
  assert(edit403.body.message && edit403.body.message.includes('template:publish'), 'Error mentions template:publish permission');

  // Step 5: User with template:view only gets 403
  console.log('Step 5: User with template:view only gets 403 on publish');
  const view403 = await request('POST', '/api/pdfme/templates/' + templateId2 + '/publish', viewOnlyToken);
  assert(view403.status === 403, 'POST /api/pdfme/templates/:id/publish returns 403 with only template:view');

  // Step 6: Error envelope structure
  console.log('Step 6: Error envelope format');
  assert(edit403.body.statusCode === 403, 'Error has statusCode 403');
  assert(edit403.body.error === 'Forbidden', 'Error has error: Forbidden');

  // Step 7: Template status unchanged after rejected publish
  console.log('Step 7: Template status unchanged after rejected publish');
  const getRes = await request('GET', '/api/pdfme/templates/' + templateId2, fullToken);
  assert(getRes.status === 200, 'Can still retrieve template');
  assert(getRes.body.status === 'draft', 'Template still in draft after rejected publish');

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId1, fullToken);
  await request('DELETE', '/api/pdfme/templates/' + templateId2, fullToken);

  console.log('');
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
