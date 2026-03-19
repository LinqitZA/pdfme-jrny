/**
 * Feature #434: Auto-fork system templates on load in designer
 *
 * Tests that when a system template (orgId=null) is loaded in the designer,
 * it automatically forks to create an org-owned copy before editing.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';

const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

// Regular org user token
const TOKEN = jwt.sign(
  { sub: 'test-user-434', orgId: 'org-434', roles: ['template:read','template:edit','template:delete','template:view','template:create','template:publish'] },
  SECRET, { expiresIn: '1h' }
);
const AUTH = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// System token (no orgId) for creating system templates
const SYSTEM_TOKEN = jwt.sign(
  { sub: 'system-admin', roles: ['template:read','template:edit','template:view','template:create','template:delete'] },
  SECRET, { expiresIn: '1h' }
);
const SYSTEM_AUTH = { 'Authorization': `Bearer ${SYSTEM_TOKEN}`, 'Content-Type': 'application/json' };

let systemTemplateId = null;
let orgTemplateId = null;
const createdIds = []; // Track all created templates for cleanup

async function api(method, path, body, headers) {
  const hdrs = headers || AUTH;
  const opts = { method, headers: hdrs };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  return { status: res.status, data: await res.json().catch(() => null) };
}

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== Feature #434: Auto-fork system templates on load in designer ===\n');

  // ── Setup: Create test templates ──
  console.log('--- Setup: Create test templates ---');

  // Create a normal org template
  {
    const res = await api('POST', '/templates', {
      name: 'TEST_434_OrgTemplate',
      type: 'invoice',
      schema: { pageSize: { width: 210, height: 297 }, pages: [{ id: 'p1', label: 'Page 1', elements: [] }] }
    });
    assert(res.status === 201, `Created org template: ${res.status}`);
    orgTemplateId = res.data?.id;
    if (orgTemplateId) createdIds.push(orgTemplateId);
    assert(!!orgTemplateId, `Org template ID: ${orgTemplateId}`);
  }

  // Verify org template has orgId set
  if (orgTemplateId) {
    const get = await api('GET', `/templates/${orgTemplateId}`);
    assert(get.data?.orgId === 'org-434', `Org template has orgId=org-434: got ${get.data?.orgId}`);
  }

  // Create a system template (orgId=null) using system token (no orgId in JWT)
  {
    const res = await api('POST', '/templates', {
      name: 'TEST_434_SystemTemplate',
      type: 'invoice',
      schema: {
        pageSize: { width: 210, height: 297 },
        pages: [{ id: 'p1', label: 'Page 1', elements: [
          { id: 'el1', type: 'text', x: 20, y: 20, w: 100, h: 30, content: 'System Template Text' }
        ] }]
      }
    }, SYSTEM_AUTH);
    assert(res.status === 201, `Created system template: ${res.status}`);
    systemTemplateId = res.data?.id;
    if (systemTemplateId) createdIds.push(systemTemplateId);
    assert(!!systemTemplateId, `System template ID: ${systemTemplateId}`);
  }

  // Verify system template has orgId=null
  if (systemTemplateId) {
    const get = await api('GET', `/templates/${systemTemplateId}`);
    assert(get.data?.orgId === null, `System template has orgId=null: got ${JSON.stringify(get.data?.orgId)}`);
  }

  // ── Test 1: Fork endpoint works directly ──
  console.log('\n--- Test 1: Fork endpoint functionality ---');
  if (systemTemplateId) {
    const forkRes = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'TEST_434_ForkDirect' });
    assert(forkRes.status === 200 || forkRes.status === 201, `Fork endpoint returns success: ${forkRes.status}`);
    assert(!!forkRes.data?.id, `Fork returns new template ID: ${forkRes.data?.id}`);
    assert(forkRes.data?.id !== systemTemplateId, `Fork ID differs from source`);
    assert(forkRes.data?.orgId === 'org-434', `Fork has caller's orgId: ${forkRes.data?.orgId}`);
    assert(forkRes.data?.status === 'draft', `Fork has status=draft: ${forkRes.data?.status}`);
    assert(forkRes.data?.version === 1, `Fork has version=1: ${forkRes.data?.version}`);
    assert(forkRes.data?.forkedFromId === systemTemplateId, `Fork has forkedFromId: ${forkRes.data?.forkedFromId}`);
    assert(forkRes.data?.name === 'TEST_434_ForkDirect', `Fork uses provided name: ${forkRes.data?.name}`);
    assert(!!forkRes.data?.schema, `Fork has schema copied from source`);

    if (forkRes.data?.id) {
      createdIds.push(forkRes.data.id);
      await api('DELETE', `/templates/${forkRes.data.id}`);
    }
  }

  // ── Test 2: Org-owned template loads without forking ──
  console.log('\n--- Test 2: Org-owned template loads normally (no fork) ---');
  if (orgTemplateId) {
    const res = await api('GET', `/templates/${orgTemplateId}`);
    assert(res.status === 200, `Org template loads: ${res.status}`);
    assert(res.data?.orgId !== null, `Org template has non-null orgId: ${res.data?.orgId}`);

    // Save should work directly (no 403)
    const saveRes = await api('PUT', `/templates/${orgTemplateId}`, { name: 'TEST_434_OrgTemplate_Updated' });
    assert(saveRes.status === 200, `Org template save succeeds: ${saveRes.status}`);
  }

  // ── Test 3: System template save fails (403 or 404 - both block editing) ──
  console.log('\n--- Test 3: System template save is blocked ---');
  if (systemTemplateId) {
    const saveRes = await api('PUT', `/templates/${systemTemplateId}`, { name: 'TEST_434_ShouldFail' });
    assert(saveRes.status === 403 || saveRes.status === 404, `System template save blocked (403/404): ${saveRes.status}`);
    // Also test draft save which has explicit system template check
    const draftRes = await api('PUT', `/templates/${systemTemplateId}/draft`, { schema: { pages: [] } });
    assert(draftRes.status === 403, `System template draft save returns 403: ${draftRes.status}`);
  }

  // ── Test 4: Fork with default name adds (Fork) suffix ──
  console.log('\n--- Test 4: Fork default name behavior ---');
  if (systemTemplateId) {
    const forkRes = await api('POST', `/templates/${systemTemplateId}/fork`, {});
    assert(forkRes.status === 200 || forkRes.status === 201, `Fork without name succeeds: ${forkRes.status}`);
    assert(forkRes.data?.name?.includes('(Fork)'), `Default fork name includes (Fork): ${forkRes.data?.name}`);
    if (forkRes.data?.id) {
      createdIds.push(forkRes.data.id);
      await api('DELETE', `/templates/${forkRes.data.id}`);
    }
  }

  // ── Test 5: Fork with explicit name preserves it ──
  console.log('\n--- Test 5: Fork with explicit name ---');
  if (systemTemplateId) {
    const forkRes = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'My Custom Invoice' });
    assert(forkRes.status === 200 || forkRes.status === 201, `Fork with name succeeds: ${forkRes.status}`);
    assert(forkRes.data?.name === 'My Custom Invoice', `Fork name preserved: ${forkRes.data?.name}`);
    if (forkRes.data?.id) {
      createdIds.push(forkRes.data.id);
      // Verify the forked template can be saved
      const saveRes = await api('PUT', `/templates/${forkRes.data.id}`, { name: 'My Custom Invoice Updated' });
      assert(saveRes.status === 200, `Forked template can be saved: ${saveRes.status}`);
      await api('DELETE', `/templates/${forkRes.data.id}`);
    }
  }

  // ── Test 6: Frontend code has auto-fork logic ──
  console.log('\n--- Test 6: Frontend code contains auto-fork logic ---');
  {
    const fs = require('fs');
    const code = fs.readFileSync('apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

    assert(code.includes('template.orgId === null'), 'Code checks template.orgId === null');
    assert(code.includes('/fork'), 'Code calls fork endpoint');
    assert(code.includes('setActiveTemplateId(forkedTemplate.id)'), 'Code updates activeTemplateId after fork');
    assert(code.includes('history.replaceState'), 'Code updates URL via history.replaceState');
    assert(code.includes('Forked from system template'), 'Code shows informational toast');
    assert(code.includes('read-only mode'), 'Code handles fork failure with read-only mode');
    assert(code.includes('setIsReadOnly(true)'), 'Code sets read-only on fork failure');

    // Verify fork happens before state population
    const forkIndex = code.indexOf('templates/${activeTemplateId}/fork');
    const populateIndex = code.indexOf('// Populate state from template data');
    assert(forkIndex > 0 && forkIndex < populateIndex, 'Fork happens before state population');

    // Verify lock uses template.id (which may be forked)
    assert(code.includes('lockTemplateId'), 'Lock uses lockTemplateId variable');
    assert(code.includes('template.id || activeTemplateId'), 'lockTemplateId falls back to activeTemplateId');
  }

  // ── Test 7: Fork preserves schema content ──
  console.log('\n--- Test 7: Fork preserves schema content ---');
  if (systemTemplateId) {
    const origRes = await api('GET', `/templates/${systemTemplateId}`);
    const origSchema = origRes.data?.schema;

    const forkRes = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'TEST_434_SchemaCheck' });
    assert(forkRes.status === 200 || forkRes.status === 201, `Fork for schema check succeeds`);

    if (forkRes.data?.id) {
      createdIds.push(forkRes.data.id);
      const forkGet = await api('GET', `/templates/${forkRes.data.id}`);
      const forkSchema = forkGet.data?.schema;

      assert(JSON.stringify(origSchema) === JSON.stringify(forkSchema), 'Forked schema is identical to original');
      assert(forkGet.data?.forkedFromId === systemTemplateId, `forkedFromId references source: ${forkGet.data?.forkedFromId}`);
      await api('DELETE', `/templates/${forkRes.data.id}`);
    }
  }

  // ── Test 8: Multiple forks create unique copies ──
  console.log('\n--- Test 8: Multiple forks create unique copies ---');
  if (systemTemplateId) {
    const fork1 = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'TEST_434_Fork1' });
    const fork2 = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'TEST_434_Fork2' });

    assert(fork1.data?.id !== fork2.data?.id, `Each fork gets unique ID`);
    assert(fork1.data?.name === 'TEST_434_Fork1', `Fork 1 name correct`);
    assert(fork2.data?.name === 'TEST_434_Fork2', `Fork 2 name correct`);

    if (fork1.data?.id) {
      createdIds.push(fork1.data.id);
      await api('PUT', `/templates/${fork1.data.id}`, { name: 'TEST_434_Fork1_Modified' });
      if (fork2.data?.id) {
        const fork2Check = await api('GET', `/templates/${fork2.data.id}`);
        assert(fork2Check.data?.name === 'TEST_434_Fork2', 'Modifying fork1 does not affect fork2');
      }
      await api('DELETE', `/templates/${fork1.data.id}`);
    }
    if (fork2.data?.id) {
      createdIds.push(fork2.data.id);
      await api('DELETE', `/templates/${fork2.data.id}`);
    }
  }

  // ── Test 9: Forked template appears in template list with draft status ──
  console.log('\n--- Test 9: Forked template in template list ---');
  if (systemTemplateId) {
    const forkRes = await api('POST', `/templates/${systemTemplateId}/fork`, { name: 'TEST_434_ListCheck' });
    if (forkRes.data?.id) {
      createdIds.push(forkRes.data.id);
      const listRes = await api('GET', '/templates?limit=100');
      const templates = listRes.data?.data || [];
      const found = templates.find(t => t.id === forkRes.data.id);
      assert(!!found, `Forked template appears in list`);
      assert(found?.status === 'draft', `Forked template has draft status: ${found?.status}`);
      assert(found?.orgId === 'org-434', `Forked template has user's orgId: ${found?.orgId}`);

      await api('DELETE', `/templates/${forkRes.data.id}`);
    }
  }

  // ── Cleanup ──
  console.log('\n--- Cleanup ---');
  if (orgTemplateId) {
    await api('DELETE', `/templates/${orgTemplateId}`);
    console.log(`  🗑️  Deleted org template`);
  }
  if (systemTemplateId) {
    // System templates need system auth (no orgId) to delete
    const delRes = await api('DELETE', `/templates/${systemTemplateId}`, null, SYSTEM_AUTH);
    console.log(`  🗑️  Delete system template: ${delRes.status}`);
  }

  // ── Summary ──
  console.log(`\n=== Results: ${passed}/${passed + failed} passing ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
