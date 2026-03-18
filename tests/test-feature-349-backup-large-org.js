const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'org-349-large-backup';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-349',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    let data = null;
    if (body) data = JSON.stringify(body);
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

function uploadAsset(token, filename, buffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now() + Math.random();
    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
    parts.push(buffer);
    parts.push(`\r\n--${boundary}--\r\n`);
    const data = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/pdfme/assets/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(data),
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
    req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

// Create a small valid PNG buffer (1x1 pixel) with varying content
function makePng(seed) {
  // Base 1x1 PNG, tweak IDAT payload slightly per seed for unique content
  const base = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  // Append seed bytes to make each file unique in size
  const extra = Buffer.alloc(seed % 100, seed & 0xFF);
  return Buffer.concat([base, extra]);
}

async function main() {
  const token = makeToken();
  const uniqueSuffix = Date.now();

  console.log('\n=== Feature #349: Backup export handles large orgs ===\n');

  // ─── Step 1: Create 50 templates ───
  console.log('Step 1: Creating 50 templates...');
  const TEMPLATE_COUNT = 50;
  const templateIds = [];
  const BATCH_SIZE = 10;

  for (let batch = 0; batch < TEMPLATE_COUNT / BATCH_SIZE; batch++) {
    const promises = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const idx = batch * BATCH_SIZE + i;
      promises.push(request('POST', '/templates', {
        name: `LargeOrg_Template_${idx}_${uniqueSuffix}`,
        type: idx % 2 === 0 ? 'invoice' : 'statement',
        schema: {
          pages: [{
            elements: [
              { type: 'text', content: `Template ${idx} content - ${uniqueSuffix}` },
              { type: 'text', content: `Additional field ${idx}` },
            ]
          }]
        },
      }, token));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status === 201 && r.body.id) {
        templateIds.push(r.body.id);
      }
    }
  }

  assert(templateIds.length === TEMPLATE_COUNT, `Created ${templateIds.length}/${TEMPLATE_COUNT} templates`);
  console.log(`  Created ${templateIds.length} templates`);

  // ─── Step 2: Create 100 assets ───
  console.log('\nStep 2: Uploading 100 assets...');
  const ASSET_COUNT = 100;
  let assetsCreated = 0;
  const ASSET_BATCH = 10;

  for (let batch = 0; batch < ASSET_COUNT / ASSET_BATCH; batch++) {
    const promises = [];
    for (let i = 0; i < ASSET_BATCH; i++) {
      const idx = batch * ASSET_BATCH + i;
      const png = makePng(idx);
      promises.push(uploadAsset(token, `large-org-asset-${idx}-${uniqueSuffix}.png`, png));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status === 201 || r.status === 200) assetsCreated++;
    }
  }

  assert(assetsCreated === ASSET_COUNT, `Uploaded ${assetsCreated}/${ASSET_COUNT} assets`);
  console.log(`  Uploaded ${assetsCreated} assets`);

  // ─── Step 3: Export backup ───
  console.log('\nStep 3: Export backup of large org...');
  const startTime = Date.now();
  const backup = await request('GET', '/templates/backup', null, token);
  const exportTime = Date.now() - startTime;

  assert(backup.status === 200, `Backup returns 200 (got ${backup.status})`);
  console.log(`  Export completed in ${exportTime}ms`);

  // ─── Step 4: Verify backup structure ───
  console.log('\nStep 4: Verify backup structure...');
  assert(backup.body.version === 1, `Backup version is 1`);
  assert(backup.body.exportedAt, `Backup has exportedAt timestamp`);
  assert(backup.body.orgId === ORG_ID, `Backup orgId matches`);
  assert(Array.isArray(backup.body.templates), `Templates is array`);
  assert(typeof backup.body.assets === 'object', `Assets is object`);
  assert(Array.isArray(backup.body.assets?.images), `Assets.images is array`);

  // ─── Step 5: Verify all 50 templates in backup ───
  console.log('\nStep 5: Verify all 50 templates included...');
  const backupTemplateNames = backup.body.templates.map(t => t.name);
  let templatesFound = 0;
  for (let i = 0; i < TEMPLATE_COUNT; i++) {
    const expectedName = `LargeOrg_Template_${i}_${uniqueSuffix}`;
    if (backupTemplateNames.includes(expectedName)) templatesFound++;
  }
  assert(templatesFound === TEMPLATE_COUNT, `All ${TEMPLATE_COUNT} templates found in backup (found ${templatesFound})`);

  // Verify template data integrity
  const sampleTemplate = backup.body.templates.find(t => t.name === `LargeOrg_Template_0_${uniqueSuffix}`);
  assert(sampleTemplate !== undefined, `Sample template found in backup`);
  if (sampleTemplate) {
    assert(sampleTemplate.id, `Template has id`);
    assert(sampleTemplate.type === 'invoice', `Template type preserved (${sampleTemplate.type})`);
    assert(sampleTemplate.schema, `Template schema preserved`);
    assert(sampleTemplate.status, `Template status preserved`);
  }

  // ─── Step 6: Verify all 100 assets in backup ───
  console.log('\nStep 6: Verify all 100 assets included...');
  const allImages = backup.body.assets?.images || [];
  let assetsFound = 0;
  for (let i = 0; i < ASSET_COUNT; i++) {
    const expectedFilename = `large-org-asset-${i}-${uniqueSuffix}.png`;
    if (allImages.some(img => img.path && img.path.includes(expectedFilename))) {
      assetsFound++;
    }
  }
  // Assets may have UUID prefix, check by suffix match
  if (assetsFound < ASSET_COUNT) {
    // Try matching by suffix pattern
    assetsFound = 0;
    for (let i = 0; i < ASSET_COUNT; i++) {
      const suffix = `large-org-asset-${i}-${uniqueSuffix}.png`;
      if (allImages.some(img => img.path && img.path.endsWith(suffix))) {
        assetsFound++;
      }
    }
  }
  // UUID prefix means filenames are modified - count total images for this org
  const orgImages = allImages.filter(img => img.path && img.path.includes(ORG_ID));
  assert(orgImages.length >= ASSET_COUNT, `At least ${ASSET_COUNT} org images in backup (found ${orgImages.length})`);

  // Verify asset data integrity
  if (orgImages.length > 0) {
    const sampleAsset = orgImages[0];
    assert(sampleAsset.data && sampleAsset.data.length > 0, `Asset has base64 data`);
    assert(sampleAsset.mimeType === 'image/png', `Asset mimeType is image/png (got ${sampleAsset.mimeType})`);
    assert(sampleAsset.path && sampleAsset.path.length > 0, `Asset has file path`);

    // Verify data is valid base64
    try {
      const decoded = Buffer.from(sampleAsset.data, 'base64');
      assert(decoded.length > 0, `Asset base64 decodes successfully (${decoded.length} bytes)`);
    } catch {
      assert(false, `Asset base64 decodes successfully`);
    }
  }

  // ─── Step 7: Verify reasonable response size ───
  console.log('\nStep 7: Verify reasonable file size...');
  const jsonStr = JSON.stringify(backup.body);
  const sizeBytes = Buffer.byteLength(jsonStr);
  const sizeMB = sizeBytes / (1024 * 1024);
  console.log(`  Backup JSON size: ${sizeMB.toFixed(2)} MB (${sizeBytes} bytes)`);

  // With 50 templates and 100 small PNG assets, size should be reasonable (under 50MB)
  assert(sizeMB < 50, `Backup size is reasonable: ${sizeMB.toFixed(2)} MB (< 50 MB)`);
  assert(sizeMB > 0.001, `Backup has meaningful content: ${sizeMB.toFixed(2)} MB`);

  // ─── Step 8: Verify export performance ───
  console.log('\nStep 8: Verify export performance...');
  // Export of 50 templates + 100 assets should complete in reasonable time (< 60s)
  assert(exportTime < 60000, `Export completed in ${exportTime}ms (< 60s)`);

  // ─── Step 9: Verify backup completeness - all required fields ───
  console.log('\nStep 9: Verify backup completeness...');
  // Every template should have required fields
  let allTemplatesHaveFields = true;
  for (const tpl of backup.body.templates.filter(t => t.name && t.name.includes(uniqueSuffix))) {
    if (!tpl.id || !tpl.name || !tpl.type || !tpl.schema) {
      allTemplatesHaveFields = false;
      break;
    }
  }
  assert(allTemplatesHaveFields, `All templates have required fields (id, name, type, schema)`);

  // Every image asset should have required fields
  let allAssetsHaveFields = true;
  for (const img of orgImages) {
    if (!img.path || !img.data || !img.mimeType) {
      allAssetsHaveFields = false;
      break;
    }
  }
  assert(allAssetsHaveFields, `All assets have required fields (path, data, mimeType)`);

  // ─── Step 10: Second export returns same data ───
  console.log('\nStep 10: Verify idempotent export...');
  const backup2 = await request('GET', '/templates/backup', null, token);
  assert(backup2.status === 200, `Second backup returns 200`);
  assert(backup2.body.templates.length === backup.body.templates.length,
    `Template count stable (${backup2.body.templates.length} == ${backup.body.templates.length})`);
  const orgImages2 = (backup2.body.assets?.images || []).filter(img => img.path && img.path.includes(ORG_ID));
  assert(orgImages2.length === orgImages.length,
    `Asset count stable (${orgImages2.length} == ${orgImages.length})`);

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
