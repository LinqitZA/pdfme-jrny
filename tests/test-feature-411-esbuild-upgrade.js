/**
 * Feature #411: Upgrade esbuild to fix development server request forgery vulnerability
 * Tests that esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99) is no longer present via drizzle-kit deps
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const secret = 'pdfme-dev-secret';

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ORG_ID = 'org-test-411';
const USER_ID = 'user-test-411';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['template:view', 'template:edit', 'template:publish', 'template:delete', 'render:trigger', 'audit:view']
});

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${message}`);
  } else {
    failed++;
    results.push(`  ❌ ${message}`);
  }
}

async function run() {
  console.log('=== Feature #411: Upgrade esbuild to fix dev server request forgery vulnerability ===\n');

  // --- Step 1: Verify drizzle-kit version ---
  console.log('--- Step 1: Verify drizzle-kit version in package.json ---');
  const nestPkgPath = path.join(__dirname, '..', 'nest-module', 'package.json');
  const nestPkg = JSON.parse(fs.readFileSync(nestPkgPath, 'utf8'));
  const dkVersion = nestPkg.dependencies['drizzle-kit'];

  assert(!!dkVersion, `drizzle-kit dependency exists (${dkVersion})`);
  assert(dkVersion === '^0.31.10', `drizzle-kit is at latest stable (${dkVersion})`);

  // --- Step 2: Verify drizzle-orm updated ---
  console.log('--- Step 2: Verify drizzle-orm version updated ---');
  const ormVersion = nestPkg.dependencies['drizzle-orm'];
  assert(!!ormVersion, `drizzle-orm dependency exists (${ormVersion})`);

  // drizzle-orm may be hoisted or in workspace-local node_modules
  let installedOrmPath = path.join(__dirname, '..', 'node_modules', 'drizzle-orm', 'package.json');
  if (!fs.existsSync(installedOrmPath)) {
    installedOrmPath = path.join(__dirname, '..', 'nest-module', 'node_modules', 'drizzle-orm', 'package.json');
  }
  const installedOrm = JSON.parse(fs.readFileSync(installedOrmPath, 'utf8'));
  const ormInstalledVer = installedOrm.version;
  const [ormMajor, ormMinor] = ormInstalledVer.split('.').map(Number);
  assert(ormMinor >= 45, `drizzle-orm is >= 0.45 (installed: ${ormInstalledVer})`);

  // --- Step 3: Verify esbuild override in root package.json ---
  console.log('--- Step 3: Verify esbuild override in root package.json ---');
  const rootPkgPath = path.join(__dirname, '..', 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  const overrides = rootPkg.overrides || {};

  assert(!!overrides, 'Root package.json has overrides section');
  const esbuildOverride = overrides['@esbuild-kit/core-utils'];
  assert(!!esbuildOverride, '@esbuild-kit/core-utils has an esbuild override');
  assert(esbuildOverride && esbuildOverride.esbuild, `esbuild override value: ${JSON.stringify(esbuildOverride)}`);

  // --- Step 4: Verify no vulnerable esbuild installed ---
  console.log('--- Step 4: Verify no vulnerable esbuild (<=0.24.2) installed ---');

  // Check all esbuild instances in node_modules
  function findEsbuildVersions(dir, results = []) {
    const esbuildPkg = path.join(dir, 'node_modules', 'esbuild', 'package.json');
    if (fs.existsSync(esbuildPkg)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(esbuildPkg, 'utf8'));
        results.push({ path: esbuildPkg, version: pkg.version });
      } catch (e) {}
    }
    // Also check nested node_modules
    const nestedNm = path.join(dir, 'node_modules');
    if (fs.existsSync(nestedNm)) {
      try {
        const entries = fs.readdirSync(nestedNm);
        for (const entry of entries) {
          if (entry.startsWith('.') || entry === 'esbuild') continue;
          const fullPath = path.join(nestedNm, entry);
          if (entry.startsWith('@')) {
            // Scoped package
            try {
              const scopeEntries = fs.readdirSync(fullPath);
              for (const se of scopeEntries) {
                findEsbuildVersions(path.join(fullPath, se), results);
              }
            } catch (e) {}
          } else {
            findEsbuildVersions(fullPath, results);
          }
        }
      } catch (e) {}
    }
    return results;
  }

  const projectRoot = path.join(__dirname, '..');
  const esbuildInstances = findEsbuildVersions(projectRoot);

  assert(esbuildInstances.length > 0, `Found ${esbuildInstances.length} esbuild installation(s)`);

  let hasVulnerable = false;
  for (const instance of esbuildInstances) {
    const [major, minor, patch] = instance.version.split('.').map(Number);
    const isVuln = major === 0 && (minor < 24 || (minor === 24 && patch <= 2));
    if (isVuln) {
      hasVulnerable = true;
      results.push(`  ❌ VULNERABLE esbuild ${instance.version} at ${instance.path}`);
      failed++;
    }
  }

  if (!hasVulnerable) {
    assert(true, 'No vulnerable esbuild (<=0.24.2) found anywhere in node_modules');
  }

  // All esbuild instances should be >= 0.25.0
  const allSafe = esbuildInstances.every(i => {
    const [, minor] = i.version.split('.').map(Number);
    return minor >= 25;
  });
  assert(allSafe, `All esbuild instances are >= 0.25.0`);

  // Show versions found
  for (const instance of esbuildInstances) {
    assert(true, `esbuild ${instance.version} at ${instance.path.replace(projectRoot + '/', '')}`);
  }

  // --- Step 5: Verify @esbuild-kit/core-utils no longer uses vulnerable esbuild ---
  console.log('--- Step 5: Verify @esbuild-kit/core-utils esbuild is safe ---');
  const coreUtilsEsbuild = path.join(projectRoot, 'node_modules', '@esbuild-kit', 'core-utils', 'node_modules', 'esbuild', 'package.json');
  if (fs.existsSync(coreUtilsEsbuild)) {
    const pkg = JSON.parse(fs.readFileSync(coreUtilsEsbuild, 'utf8'));
    const [, minor] = pkg.version.split('.').map(Number);
    assert(minor >= 25, `@esbuild-kit/core-utils esbuild is ${pkg.version} (>= 0.25.0)`);
  } else {
    // If no nested esbuild, it's using the deduped version which should be safe
    assert(true, '@esbuild-kit/core-utils uses deduped esbuild (safe version)');
  }

  // --- Step 6: Verify database operations work with drizzle-orm 0.45 ---
  console.log('--- Step 6: Verify database operations work with drizzle-orm 0.45 ---');

  // Create template
  const createRes = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'DRIZZLE_UPGRADE_TEST_411',
      type: 'invoice',
      schema: {
        pages: [{
          elements: [{
            name: 'heading',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Drizzle ORM 0.45 Test'
          }]
        }]
      }
    })
  });
  assert(createRes.status === 201, `Template created with drizzle-orm 0.45 (${createRes.status})`);
  const template = await createRes.json();
  const templateId = template.id;
  assert(!!templateId, `Template has ID: ${templateId}`);

  // Read back template
  const getRes = await fetch(`${BASE}/templates/${templateId}`, { headers });
  assert(getRes.status === 200, `Template retrieved (${getRes.status})`);
  const got = await getRes.json();
  assert(got.name === 'DRIZZLE_UPGRADE_TEST_411', 'Template data persisted correctly');
  assert(got.status === 'draft', `Template status is draft (${got.status})`);

  // Update template
  const updateRes = await fetch(`${BASE}/templates/${templateId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      schema: {
        pages: [{
          elements: [{
            name: 'heading',
            type: 'text',
            position: { x: 50, y: 50 },
            width: 200,
            height: 30,
            content: 'Updated with drizzle-orm 0.45'
          }]
        }]
      }
    })
  });
  assert(updateRes.status === 200, `Template updated (${updateRes.status})`);

  // List templates
  const listRes = await fetch(`${BASE}/templates`, { headers });
  assert(listRes.status === 200, `Template list works (${listRes.status})`);
  const listData = await listRes.json();
  const found = (listData.data || listData).find(t => t.name === 'DRIZZLE_UPGRADE_TEST_411');
  assert(!!found, 'Updated template found in list');

  // Publish
  const pubRes = await fetch(`${BASE}/templates/${templateId}/publish`, {
    method: 'POST',
    headers
  });
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published (${pubRes.status})`);

  // Render
  const renderRes = await fetch(`${BASE}/render/now`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      templateId,
      entityId: 'test-411-entity',
      channel: 'email',
      inputs: [{ heading: 'Rendered with drizzle-orm 0.45' }]
    })
  });
  assert(renderRes.status === 200 || renderRes.status === 201, `PDF rendered (${renderRes.status})`);

  // Audit log
  const auditRes = await fetch(`${BASE}/audit?entityType=template&entityId=${templateId}&limit=50`, {
    headers
  });
  assert(auditRes.status === 200, `Audit log query works (${auditRes.status})`);
  const auditData = await auditRes.json();
  assert(auditData.data && auditData.data.length > 0, `Audit entries exist (${auditData.data?.length})`);

  // --- Cleanup ---
  console.log('\n--- Cleanup ---');
  if (templateId) {
    await fetch(`${BASE}/templates/${templateId}`, { method: 'DELETE', headers });
  }
  console.log('  Cleaned up test template');

  // --- Print results ---
  console.log('');
  results.forEach(r => console.log(r));
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
