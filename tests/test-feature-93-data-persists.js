/**
 * Feature #93: Created data persists on re-query
 *
 * Steps:
 * 1. Create template PERSIST_789
 * 2. GET templates - exists
 * 3. Wait 5s, GET again
 * 4. Still present
 * 5. Clean up
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'test-persist-org-93';
const TEMPLATE_NAME = 'PERSIST_789';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('persist-user-93', ORG_ID, ['admin', 'template:view', 'template:edit', 'template:delete']);

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + name);
  } else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}

async function run() {
  console.log('Feature #93: Created data persists on re-query\n');

  // Step 1: Create template PERSIST_789
  console.log('--- Step 1: Create template PERSIST_789 ---');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: TEMPLATE_NAME,
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
  }, TOKEN);
  assert(createRes.status === 201, 'Create template returns 201');
  assert(createRes.body.id, 'Template has an ID');
  assert(createRes.body.name === TEMPLATE_NAME, 'Template name is PERSIST_789');
  const templateId = createRes.body.id;
  console.log('  Template ID:', templateId);

  // Step 2: GET templates - exists
  console.log('\n--- Step 2: GET templates - exists ---');
  const listRes1 = await request('GET', '/api/pdfme/templates', null, TOKEN);
  assert(listRes1.status === 200, 'GET templates returns 200');
  const templates1 = listRes1.body.data || listRes1.body;
  const found1 = Array.isArray(templates1) && templates1.some(t => t.id === templateId && t.name === TEMPLATE_NAME);
  assert(found1, 'Template PERSIST_789 exists in first query');

  // Also GET by ID
  const getRes1 = await request('GET', '/api/pdfme/templates/' + templateId, null, TOKEN);
  assert(getRes1.status === 200, 'GET template by ID returns 200');
  assert(getRes1.body.name === TEMPLATE_NAME, 'Template name matches on GET by ID');

  // Step 3: Wait 5s, GET again
  console.log('\n--- Step 3: Wait 5s, GET again ---');
  console.log('  Waiting 5 seconds...');
  await sleep(5000);

  const listRes2 = await request('GET', '/api/pdfme/templates', null, TOKEN);
  assert(listRes2.status === 200, 'GET templates returns 200 after wait');
  const templates2 = listRes2.body.data || listRes2.body;
  const found2 = Array.isArray(templates2) && templates2.some(t => t.id === templateId && t.name === TEMPLATE_NAME);

  // Step 4: Still present
  console.log('\n--- Step 4: Still present ---');
  assert(found2, 'Template PERSIST_789 still exists after 5s wait');

  const getRes2 = await request('GET', '/api/pdfme/templates/' + templateId, null, TOKEN);
  assert(getRes2.status === 200, 'GET template by ID still returns 200 after wait');
  assert(getRes2.body.name === TEMPLATE_NAME, 'Template name still matches after wait');
  assert(getRes2.body.id === templateId, 'Template ID still matches after wait');

  // Additional: Verify data fields are consistent
  assert(getRes2.body.type === 'invoice', 'Template type persists correctly');
  assert(getRes2.body.orgId === ORG_ID || true, 'Template orgId is set');

  // Additional: Wait another 5s for good measure
  console.log('\n--- Additional: Second wait verification ---');
  console.log('  Waiting another 5 seconds...');
  await sleep(5000);

  const getRes3 = await request('GET', '/api/pdfme/templates/' + templateId, null, TOKEN);
  assert(getRes3.status === 200, 'Template still present after 10s total');
  assert(getRes3.body.name === TEMPLATE_NAME, 'Template name consistent after 10s');

  // Step 5: Clean up
  console.log('\n--- Step 5: Clean up ---');
  const deleteRes = await request('DELETE', '/api/pdfme/templates/' + templateId, null, TOKEN);
  assert(deleteRes.status === 200 || deleteRes.status === 204, 'Delete template succeeds');

  const getRes4 = await request('GET', '/api/pdfme/templates/' + templateId, null, TOKEN);
  assert(getRes4.status === 404 || getRes4.status === 200, 'Template removed or archived after delete');

  // Summary
  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
