const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-344',
    orgId: orgId || 'org-344',
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

  // Create a fake image (small PNG-like data)
  const imageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const imageBase64 = imageData.toString('base64');

  // Create a different image
  const differentImageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMBAQApDs4AAAAASUVORK5CYII=', 'base64');
  const differentImageBase64 = differentImageData.toString('base64');

  const exportPkg = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: `DedupeTest_${uniqueSuffix}`,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: {
      images: [
        {
          path: `org-344/assets/test-logo.png`,
          data: imageBase64,
          mimeType: 'image/png',
        },
      ],
      fonts: [],
    },
  };

  console.log('\n=== Feature #344: Template import deduplicates assets ===\n');

  // Test 1: First import - asset should be uploaded
  console.log('Test 1: First import uploads the asset');
  const r1 = await request('POST', '/templates/import', exportPkg, token);
  assert(r1.status === 201, `First import returns 201 (got ${r1.status})`);
  assert(r1.body.assetsExtracted && r1.body.assetsExtracted.images === 1, `First import extracted 1 image (got ${r1.body.assetsExtracted?.images})`);
  const skipped1 = r1.body.assetsSkipped || { images: 0, fonts: 0 };
  assert(skipped1.images === 0, `First import skipped 0 images (got ${skipped1.images})`);
  const id1 = r1.body.id;
  console.log(`  Created template: ${id1}`);

  // Test 2: Second import with SAME asset - should be deduplicated (skipped)
  console.log('\nTest 2: Second import with same asset is deduplicated');
  const exportPkg2 = { ...exportPkg, template: { ...exportPkg.template, name: `DedupeTest2_${uniqueSuffix}` } };
  const r2 = await request('POST', '/templates/import', exportPkg2, token);
  assert(r2.status === 201, `Second import returns 201 (got ${r2.status})`);
  const skipped2 = r2.body.assetsSkipped || { images: 0, fonts: 0 };
  assert(skipped2.images === 1, `Second import skipped 1 duplicate image (got ${skipped2.images})`);
  assert(r2.body.assetsExtracted.images === 0, `Second import extracted 0 new images (got ${r2.body.assetsExtracted.images})`);
  const id2 = r2.body.id;

  // Test 3: Template still references the asset correctly (template created successfully)
  console.log('\nTest 3: Both templates created successfully despite dedup');
  const c1 = await request('GET', `/templates/${id1}`, null, token);
  const c2 = await request('GET', `/templates/${id2}`, null, token);
  assert(c1.status === 200, `First template retrievable`);
  assert(c2.status === 200, `Second template retrievable`);
  assert(c1.body.id !== c2.body.id, `Different template IDs`);

  // Test 4: Import with a DIFFERENT asset at same path - should upload (not skip)
  console.log('\nTest 4: Different content at same path uploads (not skipped)');
  const exportPkg3 = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: `DedupeTest3_${uniqueSuffix}`,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: {
      images: [
        {
          path: `org-344/assets/test-logo.png`,
          data: differentImageBase64,  // Different content!
          mimeType: 'image/png',
        },
      ],
      fonts: [],
    },
  };
  const r3 = await request('POST', '/templates/import', exportPkg3, token);
  assert(r3.status === 201, `Third import returns 201 (got ${r3.status})`);
  assert(r3.body.assetsExtracted.images === 1, `Third import uploaded 1 new image (different content) (got ${r3.body.assetsExtracted.images})`);
  const skipped3 = r3.body.assetsSkipped || { images: 0, fonts: 0 };
  assert(skipped3.images === 0, `Third import skipped 0 images (content differs) (got ${skipped3.images})`);
  const id3 = r3.body.id;

  // Test 5: Import with multiple assets, some new some existing
  console.log('\nTest 5: Mixed assets - some new, some existing');
  const newImageData = Buffer.alloc(16, 0xFF);
  const exportPkg4 = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: `DedupeTest4_${uniqueSuffix}`,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: {
      images: [
        {
          path: `org-344/assets/test-logo.png`,
          data: differentImageBase64,  // Same as r3 wrote (exists)
          mimeType: 'image/png',
        },
        {
          path: `org-344/assets/brand-new-asset.png`,
          data: newImageData.toString('base64'),  // New asset
          mimeType: 'image/png',
        },
      ],
      fonts: [],
    },
  };
  const r4 = await request('POST', '/templates/import', exportPkg4, token);
  assert(r4.status === 201, `Fourth import returns 201`);
  assert(r4.body.assetsExtracted.images === 1, `One new image uploaded (got ${r4.body.assetsExtracted.images})`);
  const skipped4 = r4.body.assetsSkipped || { images: 0, fonts: 0 };
  assert(skipped4.images === 1, `One existing image skipped (got ${skipped4.images})`);
  const id4 = r4.body.id;

  // Test 6: Import with no assets at all
  console.log('\nTest 6: Import with no assets works cleanly');
  const exportPkg5 = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: `DedupeTestNoAssets_${uniqueSuffix}`,
      type: 'invoice',
      schema: { pages: [{ elements: [] }] },
    },
    assets: { images: [], fonts: [] },
  };
  const r5 = await request('POST', '/templates/import', exportPkg5, token);
  assert(r5.status === 201, `No-asset import returns 201`);
  assert(r5.body.assetsExtracted.images === 0, `No images extracted`);
  assert(r5.body.assetsExtracted.fonts === 0, `No fonts extracted`);
  const id5 = r5.body.id;

  // Cleanup
  for (const id of [id1, id2, id3, id4, id5]) {
    if (id) await request('DELETE', `/templates/${id}`, null, token);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
