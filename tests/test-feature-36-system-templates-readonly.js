/**
 * Feature #36: System templates are read-only via API
 *
 * Steps:
 * 1. GET /api/pdfme/templates/system lists system templates
 * 2. Attempt PUT /api/pdfme/templates/:systemId/draft returns 403
 * 3. Attempt DELETE /api/pdfme/templates/:systemId returns 403
 * 4. Fork endpoint POST /api/pdfme/templates/:systemId/fork returns 200/201
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const roles = ['template:view','template:edit','template:publish','template:delete','render:trigger','render:bulk','system:seed'];
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now()/1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'org-sysro-36';
const USER_ID = 'user-sysro-36';
const TOKEN = makeToken(USER_ID, ORG_ID);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': 'Bearer ' + (token || TOKEN),
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
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
    console.log('  \u2713 ' + msg);
  } else {
    failed++;
    console.log('  \u2717 ' + msg);
  }
}

async function run() {
  console.log('Feature #36: System templates are read-only via API\n');

  // Step 1: GET /api/pdfme/templates/system lists system templates
  console.log('Step 1: List system templates');
  const listRes = await request('GET', '/api/pdfme/templates/system');
  assert(listRes.status === 200, 'GET /templates/system returns 200 (got ' + listRes.status + ')');
  assert(Array.isArray(listRes.body.data), 'Response has data array');
  assert(listRes.body.data.length > 0, 'At least one system template exists (' + (listRes.body.data ? listRes.body.data.length : 0) + ' found)');

  const systemTemplate = listRes.body.data[0];
  const systemId = systemTemplate.id;
  console.log('  Using system template: ' + systemId + ' (' + systemTemplate.name + ')');

  assert(systemTemplate.orgId === null, 'System template orgId is null');
  assert(systemTemplate.status === 'published', 'System template status is published');

  // Step 1b: Can read individual system template
  const getRes = await request('GET', '/api/pdfme/templates/system/' + systemId);
  assert(getRes.status === 200, 'GET /templates/system/:id returns 200');
  assert(getRes.body.id === systemId, 'Returns correct template');

  // Step 2: PUT /api/pdfme/templates/:systemId/draft returns 403
  console.log('\nStep 2: Attempt to save draft on system template - should return 403');
  const draftRes = await request('PUT', '/api/pdfme/templates/' + systemId + '/draft', TOKEN, {
    name: 'Hacked System Template',
    schema: systemTemplate.schema,
  });
  assert(draftRes.status === 403, 'PUT /templates/:systemId/draft returns 403 (got ' + draftRes.status + ')');
  assert(draftRes.body.error === 'Forbidden', 'Error is "Forbidden": "' + draftRes.body.error + '"');
  assert(
    draftRes.body.message && draftRes.body.message.toLowerCase().includes('system template'),
    'Message mentions system template: "' + draftRes.body.message + '"'
  );
  assert(
    draftRes.body.message && draftRes.body.message.toLowerCase().includes('read-only'),
    'Message mentions read-only: "' + draftRes.body.message + '"'
  );

  // Step 3: DELETE /api/pdfme/templates/:systemId returns 403
  console.log('\nStep 3: Attempt to delete system template - should return 403');
  const deleteRes = await request('DELETE', '/api/pdfme/templates/' + systemId);
  assert(deleteRes.status === 403, 'DELETE /templates/:systemId returns 403 (got ' + deleteRes.status + ')');
  assert(deleteRes.body.error === 'Forbidden', 'Error is "Forbidden": "' + deleteRes.body.error + '"');
  assert(
    deleteRes.body.message && deleteRes.body.message.toLowerCase().includes('system template'),
    'Message mentions system template: "' + deleteRes.body.message + '"'
  );

  // Step 3b: Verify template still exists after failed delete
  const stillExists = await request('GET', '/api/pdfme/templates/system/' + systemId);
  assert(stillExists.status === 200, 'System template still exists after attempted delete');

  // Step 4: POST /api/pdfme/templates/:systemId/fork returns 200/201
  console.log('\nStep 4: Fork system template - should succeed');
  const forkRes = await request('POST', '/api/pdfme/templates/' + systemId + '/fork', TOKEN, {
    name: 'My Forked Template ' + Date.now(),
  });
  assert(forkRes.status === 200 || forkRes.status === 201, 'POST /templates/:systemId/fork returns 200/201 (got ' + forkRes.status + ')');
  assert(forkRes.body.id, 'Forked template has id: ' + forkRes.body.id);
  assert(forkRes.body.id !== systemId, 'Forked template has different id from system template');
  assert(forkRes.body.orgId === ORG_ID, 'Forked template belongs to user org: ' + forkRes.body.orgId);
  assert(forkRes.body.forkedFromId === systemId, 'forkedFromId references system template: ' + forkRes.body.forkedFromId);

  // Step 4b: Forked template can be modified
  const forkedId = forkRes.body.id;
  const modifyRes = await request('PUT', '/api/pdfme/templates/' + forkedId + '/draft', TOKEN, {
    name: 'Modified Forked Template',
  });
  assert(modifyRes.status === 200, 'Forked template can be modified (status ' + modifyRes.status + ')');

  // Step 4c: Forked template can be deleted
  const deleteForkedRes = await request('DELETE', '/api/pdfme/templates/' + forkedId);
  assert(deleteForkedRes.status === 200, 'Forked template can be deleted (status ' + deleteForkedRes.status + ')');

  // Step 5: Multiple system templates are all protected
  console.log('\nStep 5: All system templates are protected');
  if (listRes.body.data.length > 1) {
    const secondSystem = listRes.body.data[1];
    const draftRes2 = await request('PUT', '/api/pdfme/templates/' + secondSystem.id + '/draft', TOKEN, {
      name: 'Hacked ' + secondSystem.name,
    });
    assert(draftRes2.status === 403, 'Second system template also returns 403 on draft save');

    const deleteRes2 = await request('DELETE', '/api/pdfme/templates/' + secondSystem.id);
    assert(deleteRes2.status === 403, 'Second system template also returns 403 on delete');
  } else {
    console.log('  (Only one system template found, skipping multi-template test)');
  }

  console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ---');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
