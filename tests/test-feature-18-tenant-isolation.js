/**
 * Feature #18: Tenant isolation - templates scoped to orgId
 *
 * Tests that template queries always filter by orgId from JWT.
 * Org-A cannot see org-B templates. Both can see system templates.
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
      path: url.pathname + (url.search || ''),
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
  process.stdout.write('=== Feature #18: Tenant isolation - templates scoped to orgId ===\n\n');

  const ORG_A = 'org-isolation-A-' + Date.now();
  const ORG_B = 'org-isolation-B-' + Date.now();
  const tokenA = makeToken({ sub: 'userA', orgId: ORG_A, roles: ['template:view', 'template:edit', 'template:delete'] });
  const tokenB = makeToken({ sub: 'userB', orgId: ORG_B, roles: ['template:view', 'template:edit', 'template:delete'] });

  // Step 1: Create template with org-A JWT
  process.stdout.write('Step 1: Create template with org-A JWT\n');

  const resA = await request('POST', '/api/pdfme/templates', tokenA, {
    name: 'OrgA-Template-' + Date.now(),
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Org A Invoice', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Org-A template created (201)', resA.status === 201);
  const templateAId = resA.data && resA.data.id;
  assert('Org-A template has an ID', !!templateAId);

  // Step 2: Create template with org-B JWT
  process.stdout.write('\nStep 2: Create template with org-B JWT\n');

  const resB = await request('POST', '/api/pdfme/templates', tokenB, {
    name: 'OrgB-Template-' + Date.now(),
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Org B Invoice', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Org-B template created (201)', resB.status === 201);
  const templateBId = resB.data && resB.data.id;
  assert('Org-B template has an ID', !!templateBId);

  // Step 3: List templates with org-A JWT - only sees org-A + system templates
  process.stdout.write('\nStep 3: List templates with org-A JWT\n');

  const listA = await request('GET', '/api/pdfme/templates', tokenA, null);
  assert('Org-A list returns 200', listA.status === 200);
  const orgATemplates = listA.data && listA.data.data;
  assert('Org-A list has data array', Array.isArray(orgATemplates));

  // Check org-A sees its own template
  const foundOwnA = orgATemplates && orgATemplates.some(function(t) { return t.id === templateAId; });
  assert('Org-A sees its own template', foundOwnA);

  // Check org-A does NOT see org-B template
  const foundBInA = orgATemplates && orgATemplates.some(function(t) { return t.id === templateBId; });
  assert('Org-A does NOT see org-B template', !foundBInA);

  // Check org-A can see system templates (orgId null)
  const sysInA = orgATemplates && orgATemplates.some(function(t) { return !t.orgId || t.orgId === '' || t.orgId === null; });
  assert('Org-A can see system templates', sysInA);

  // Step 4: List templates with org-B JWT - only sees org-B + system templates
  process.stdout.write('\nStep 4: List templates with org-B JWT\n');

  const listB = await request('GET', '/api/pdfme/templates', tokenB, null);
  assert('Org-B list returns 200', listB.status === 200);
  const orgBTemplates = listB.data && listB.data.data;
  assert('Org-B list has data array', Array.isArray(orgBTemplates));

  // Check org-B sees its own template
  const foundOwnB = orgBTemplates && orgBTemplates.some(function(t) { return t.id === templateBId; });
  assert('Org-B sees its own template', foundOwnB);

  // Check org-B does NOT see org-A template
  const foundAInB = orgBTemplates && orgBTemplates.some(function(t) { return t.id === templateAId; });
  assert('Org-B does NOT see org-A template', !foundAInB);

  // Check org-B can see system templates
  const sysInB = orgBTemplates && orgBTemplates.some(function(t) { return !t.orgId || t.orgId === '' || t.orgId === null; });
  assert('Org-B can see system templates', sysInB);

  // Step 5: Org-A cannot GET org-B template by ID - returns 404
  process.stdout.write('\nStep 5: Org-A cannot GET org-B template by ID\n');

  const crossGet = await request('GET', '/api/pdfme/templates/' + templateBId, tokenA, null);
  assert('Org-A gets 404 for org-B template', crossGet.status === 404);

  // Also test reverse: org-B cannot get org-A template
  const crossGetReverse = await request('GET', '/api/pdfme/templates/' + templateAId, tokenB, null);
  assert('Org-B gets 404 for org-A template', crossGetReverse.status === 404);

  // Step 6: Org-A cannot update org-B template
  process.stdout.write('\nStep 6: Cross-org update blocked\n');

  const crossUpdate = await request('PUT', '/api/pdfme/templates/' + templateBId, tokenA, { name: 'Hacked' });
  assert('Org-A cannot update org-B template (404)', crossUpdate.status === 404);

  // Step 7: Org-A cannot delete org-B template
  process.stdout.write('\nStep 7: Cross-org delete blocked\n');

  const crossDelete = await request('DELETE', '/api/pdfme/templates/' + templateBId, tokenA, null);
  assert('Org-A cannot delete org-B template (404)', crossDelete.status === 404);

  // Step 8: Both orgs can access the same system template
  process.stdout.write('\nStep 8: Both orgs can access system templates\n');

  // Find a system template from org-A's list
  const sysTpl = orgATemplates && orgATemplates.find(function(t) { return !t.orgId || t.orgId === '' || t.orgId === null; });
  if (sysTpl) {
    const sysGetA = await request('GET', '/api/pdfme/templates/' + sysTpl.id, tokenA, null);
    assert('Org-A can GET system template', sysGetA.status === 200);

    const sysGetB = await request('GET', '/api/pdfme/templates/' + sysTpl.id, tokenB, null);
    assert('Org-B can GET same system template', sysGetB.status === 200);
  } else {
    assert('System template found for cross-org test', false);
    assert('Skipped: system template cross-org test', false);
  }

  // Cleanup: delete test templates
  await request('DELETE', '/api/pdfme/templates/' + templateAId, tokenA, null);
  await request('DELETE', '/api/pdfme/templates/' + templateBId, tokenB, null);

  // Summary
  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
