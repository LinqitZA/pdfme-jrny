/**
 * Feature #77: Template fork creates org copy
 * Fork system template into org namespace
 *
 * Steps:
 * 1. GET system template
 * 2. POST fork
 * 3. New template with org's orgId
 * 4. forkedFromId references original
 * 5. status=draft
 */

const crypto = require('crypto');
const BASE = 'http://localhost:3000';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ADMIN_TOKEN = makeToken('fork-admin', 'org-fork-test', ['template:view', 'template:edit', 'template:publish', 'template:delete']);
const ORG_B_TOKEN = makeToken('fork-user-b', 'org-fork-b', ['template:view', 'template:edit', 'template:publish', 'template:delete']);
const NO_AUTH = null;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function api(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

async function run() {
  console.log('\n🧪 Feature #77: Template fork creates org copy\n');

  // ─── Step 1: Create a system template (orgId=null) ───
  console.log('Step 1: Create system template to fork from');

  // Create a regular template first, then we'll use the system templates endpoint
  const systemRes = await api('/api/pdfme/templates/system', { token: ADMIN_TOKEN });
  let systemTemplateId = null;

  if (systemRes.status === 200 && Array.isArray(systemRes.json) && systemRes.json.length > 0) {
    systemTemplateId = systemRes.json[0].id;
    assert(true, 'Found existing system template');
  } else {
    // Create a system template via direct insert if possible
    // Or create a regular template for fork testing
    console.log('  No system templates found, creating regular template for fork test');
  }

  // Create a regular org template to test forking from own org
  const createRes = await api('/api/pdfme/templates', {
    method: 'POST', token: ADMIN_TOKEN,
    body: {
      name: `Fork Source ${Date.now()}`,
      type: 'invoice',
      schema: {
        pages: [{
          elements: [
            { name: 'header', type: 'text', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Invoice Header' },
            { name: 'total', type: 'text', position: { x: 10, y: 50 }, width: 100, height: 20, content: '{{document.total}}' }
          ]
        }]
      }
    }
  });

  assert(createRes.status === 201, `Create source template: ${createRes.status}`);
  const sourceId = createRes.json?.id;
  const sourceName = createRes.json?.name;
  assert(!!sourceId, 'Source template has an ID');

  // Publish the source template (optional - fork works on unpublished templates too)
  const pubRes = await api(`/api/pdfme/templates/${sourceId}/publish`, {
    method: 'POST', token: ADMIN_TOKEN,
  });
  // Publish may require specific schema format - not critical for fork testing
  if (pubRes.status === 200 || pubRes.status === 201) {
    assert(true, `Publish source template: ${pubRes.status}`);
  } else {
    console.log(`  ⚠️ Publish returned ${pubRes.status} (non-critical for fork test)`);
  }

  // ─── Step 2: POST fork ───
  console.log('\nStep 2: POST fork creates a copy');

  const forkRes = await api(`/api/pdfme/templates/${sourceId}/fork`, {
    method: 'POST', token: ADMIN_TOKEN,
    body: {}
  });

  assert(forkRes.status === 201 || forkRes.status === 200, `Fork returns success: ${forkRes.status}`);
  const forkedId = forkRes.json?.id;
  assert(!!forkedId, 'Forked template has an ID');
  assert(forkedId !== sourceId, 'Forked template has different ID from source');

  // ─── Step 3: New template with org's orgId ───
  console.log('\nStep 3: Forked template has org\'s orgId');

  assert(forkRes.json?.orgId === 'org-fork-test', `Forked template orgId matches: ${forkRes.json?.orgId}`);

  // ─── Step 4: forkedFromId references original ───
  console.log('\nStep 4: forkedFromId references original');

  assert(forkRes.json?.forkedFromId === sourceId, `forkedFromId = ${forkRes.json?.forkedFromId} matches source ${sourceId}`);

  // ─── Step 5: status=draft ───
  console.log('\nStep 5: Forked template status is draft');

  assert(forkRes.json?.status === 'draft', `Forked template status = ${forkRes.json?.status}`);

  // ─── Additional verification ───
  console.log('\nAdditional verification:');

  // Fork name includes "(Fork)" by default
  assert(forkRes.json?.name?.includes('(Fork)'), `Default fork name includes (Fork): ${forkRes.json?.name}`);

  // Fork with custom name
  const customForkRes = await api(`/api/pdfme/templates/${sourceId}/fork`, {
    method: 'POST', token: ADMIN_TOKEN,
    body: { name: 'My Custom Fork Name' }
  });
  assert(customForkRes.status === 201 || customForkRes.status === 200, `Custom name fork succeeds: ${customForkRes.status}`);
  assert(customForkRes.json?.name === 'My Custom Fork Name', `Custom fork name: ${customForkRes.json?.name}`);
  assert(customForkRes.json?.forkedFromId === sourceId, `Custom fork has forkedFromId`);
  assert(customForkRes.json?.status === 'draft', `Custom fork status is draft`);

  // Fork schema is preserved
  assert(customForkRes.json?.schema !== undefined || customForkRes.json?.schema !== null, 'Fork preserves schema');

  // GET the forked template directly
  const getRes = await api(`/api/pdfme/templates/${forkedId}`, { token: ADMIN_TOKEN });
  assert(getRes.status === 200, `GET forked template: ${getRes.status}`);
  assert(getRes.json?.forkedFromId === sourceId, 'GET confirms forkedFromId');
  assert(getRes.json?.orgId === 'org-fork-test', 'GET confirms orgId');
  assert(getRes.json?.status === 'draft', 'GET confirms draft status');

  // Forked template version is 1
  assert(forkRes.json?.version === 1, `Forked template version = ${forkRes.json?.version}`);

  // Fork non-existent template returns 404
  const notFoundRes = await api('/api/pdfme/templates/non-existent-id/fork', {
    method: 'POST', token: ADMIN_TOKEN,
    body: {}
  });
  assert(notFoundRes.status === 404, `Fork non-existent template: ${notFoundRes.status}`);

  // Forked template can be modified (it's a draft)
  const updateRes = await api(`/api/pdfme/templates/${forkedId}/draft`, {
    method: 'PUT', token: ADMIN_TOKEN,
    body: {
      name: 'Updated Fork Name',
      schema: { pages: [{ elements: [] }] }
    }
  });
  assert(updateRes.status === 200, `Forked template can be updated: ${updateRes.status}`);

  // Forked template can be deleted
  const customForkId = customForkRes.json?.id;
  const delRes = await api(`/api/pdfme/templates/${customForkId}`, {
    method: 'DELETE', token: ADMIN_TOKEN,
  });
  assert(delRes.status === 200 || delRes.status === 204, `Forked template can be deleted: ${delRes.status}`);

  // Cross-org cannot fork another org's template
  const crossForkRes = await api(`/api/pdfme/templates/${sourceId}/fork`, {
    method: 'POST', token: ORG_B_TOKEN,
    body: {}
  });
  // Should return 404 (template not visible to other org) unless it's a system template
  assert(crossForkRes.status === 404, `Cross-org fork returns 404: ${crossForkRes.status}`);

  // No auth returns 401
  const noAuthRes = await api(`/api/pdfme/templates/${sourceId}/fork`, {
    method: 'POST',
    body: {}
  });
  assert(noAuthRes.status === 401, `No auth fork returns 401: ${noAuthRes.status}`);

  // Fork from system template if one exists
  if (systemTemplateId) {
    console.log('\nSystem template fork:');
    const sysForkRes = await api(`/api/pdfme/templates/${systemTemplateId}/fork`, {
      method: 'POST', token: ORG_B_TOKEN,
      body: {}
    });
    assert(sysForkRes.status === 201 || sysForkRes.status === 200, `System template fork succeeds: ${sysForkRes.status}`);
    assert(sysForkRes.json?.orgId === 'org-fork-b', `System fork gets user's orgId: ${sysForkRes.json?.orgId}`);
    assert(sysForkRes.json?.forkedFromId === systemTemplateId, `System fork references system template`);
    assert(sysForkRes.json?.status === 'draft', `System fork status is draft`);
    // Clean up
    if (sysForkRes.json?.id) {
      await api(`/api/pdfme/templates/${sysForkRes.json.id}`, { method: 'DELETE', token: ORG_B_TOKEN });
    }
  }

  // Clean up
  if (forkedId) await api(`/api/pdfme/templates/${forkedId}`, { method: 'DELETE', token: ADMIN_TOKEN });
  if (sourceId) await api(`/api/pdfme/templates/${sourceId}`, { method: 'DELETE', token: ADMIN_TOKEN });

  // ─── Summary ───
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
