const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-343',
    orgId: orgId || 'org-343',
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function main() {
  const token = makeToken();
  const uniqueSuffix = Date.now();
  const templateName = `ImportTest_${uniqueSuffix}`;

  const exportPkg = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: templateName,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: { images: [], fonts: [] },
  };

  console.log('\n=== Feature #343: Template import creates as draft never overwrites ===\n');

  // Test 1: First import creates as draft
  console.log('Test 1: First import creates a draft');
  const r1 = await request('POST', '/templates/import', exportPkg, token);
  assert(r1.status === 201, `Import returns 201 (got ${r1.status})`);
  assert(r1.body.status === 'draft', `Status is draft (got ${r1.body.status})`);
  assert(r1.body.id, `Has unique ID: ${r1.body.id}`);
  const id1 = r1.body.id;
  const name1 = r1.body.name;
  console.log(`  Created: id=${id1}, name="${name1}"`);

  // Test 2: Second import creates another draft, doesn't overwrite
  console.log('\nTest 2: Second import creates new draft (no overwrite)');
  const r2 = await request('POST', '/templates/import', exportPkg, token);
  assert(r2.status === 201, `Second import returns 201 (got ${r2.status})`);
  assert(r2.body.status === 'draft', `Status is draft (got ${r2.body.status})`);
  assert(r2.body.id !== id1, `Different ID from first import (${r2.body.id} vs ${id1})`);
  const id2 = r2.body.id;
  const name2 = r2.body.name;
  console.log(`  Created: id=${id2}, name="${name2}"`);

  // Verify first template still exists unchanged
  const check1 = await request('GET', `/templates/${id1}`, null, token);
  assert(check1.status === 200, `First template still exists`);
  assert(check1.body.name === name1, `First template name unchanged: "${check1.body.name}"`);
  assert(check1.body.status === 'draft', `First template still draft`);

  // Test 3: Third import creates yet another draft
  console.log('\nTest 3: Third import creates yet another draft');
  const r3 = await request('POST', '/templates/import', exportPkg, token);
  assert(r3.status === 201, `Third import returns 201 (got ${r3.status})`);
  assert(r3.body.status === 'draft', `Status is draft (got ${r3.body.status})`);
  assert(r3.body.id !== id1, `Different ID from first`);
  assert(r3.body.id !== id2, `Different ID from second`);
  const id3 = r3.body.id;
  const name3 = r3.body.name;
  console.log(`  Created: id=${id3}, name="${name3}"`);

  // Test 4: All three have unique names
  console.log('\nTest 4: All imports have unique names or suffixes');
  const names = new Set([name1, name2, name3]);
  assert(names.size === 3, `All 3 names are unique: "${name1}", "${name2}", "${name3}"`);

  // Test 5: Names contain the original name as prefix
  assert(name1.startsWith(templateName), `Name 1 starts with original: "${name1}"`);
  assert(name2.startsWith(templateName), `Name 2 starts with original: "${name2}"`);
  assert(name3.startsWith(templateName), `Name 3 starts with original: "${name3}"`);

  // Test 6: Imported templates all have version 1
  console.log('\nTest 5: All imports have version 1');
  assert(r1.body.version === 1, `Import 1 version=1`);
  assert(r2.body.version === 1, `Import 2 version=1`);
  assert(r3.body.version === 1, `Import 3 version=1`);

  // Test 7: Verify data persists - fetch all three
  console.log('\nTest 6: All three templates retrievable');
  const c1 = await request('GET', `/templates/${id1}`, null, token);
  const c2 = await request('GET', `/templates/${id2}`, null, token);
  const c3 = await request('GET', `/templates/${id3}`, null, token);
  assert(c1.status === 200, `Template 1 retrievable`);
  assert(c2.status === 200, `Template 2 retrievable`);
  assert(c3.status === 200, `Template 3 retrievable`);

  // Test 8: Even if original template has a different status (e.g. published), import is still draft
  console.log('\nTest 7: Import with published-looking export still creates draft');
  const publishedExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: `PublishedImportTest_${uniqueSuffix}`,
      type: 'statement',
      schema: { pages: [{ elements: [] }] },
      status: 'published', // This should be ignored
    },
    assets: { images: [], fonts: [] },
  };
  const r4 = await request('POST', '/templates/import', publishedExport, token);
  assert(r4.status === 201, `Published-source import returns 201`);
  assert(r4.body.status === 'draft', `Still created as draft even if source was published (got ${r4.body.status})`);

  // Cleanup
  for (const id of [id1, id2, id3, r4.body.id]) {
    if (id) await request('DELETE', `/templates/${id}`, null, token);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
