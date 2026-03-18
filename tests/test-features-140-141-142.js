/**
 * Test script for features #140 (template export), #141 (lock acquisition), #142 (lock heartbeat)
 */

const http = require('http');

const BASE = 'http://localhost:3000';
const TOKEN_A = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLUEiLCJvcmdJZCI6Im9yZy1leHBvcnQtdGVzdCIsInJvbGVzIjpbInRlbXBsYXRlOmVkaXQiLCJ0ZW1wbGF0ZTp2aWV3Il19.sig';
const TOKEN_B = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLUIiLCJvcmdJZCI6Im9yZy1leHBvcnQtdGVzdCIsInJvbGVzIjpbInRlbXBsYXRlOnZpZXciXX0.sig';

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

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
    };
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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  let templateId;

  // ─── Setup: Create a template with image and font references ───
  console.log('\n=== Setup: Create test template ===');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      name: 'Export Test Template',
      type: 'invoice',
      schema: {
        basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
        schemas: [
          [
            {
              name: 'logo',
              type: 'erpImage',
              assetPath: 'org-export-test/assets/test-logo.png',
              position: { x: 20, y: 20 },
              width: 50,
              height: 30,
            },
            {
              name: 'title',
              type: 'text',
              content: 'Invoice',
              fontPath: 'org-export-test/fonts/custom-font.ttf',
              position: { x: 80, y: 20 },
              width: 100,
              height: 20,
            },
          ],
        ],
      },
    }, TOKEN_A);
    assert(res.status === 201, 'Template created: ' + res.status);
    templateId = res.body.id;
    console.log('  Template ID: ' + templateId);
  }

  // ─── Feature #140: Template export ───
  console.log('\n=== Feature #140: Template export packages self-contained JSON ===');

  // First, create test assets in storage
  // We'll use the asset upload endpoint or just test the export structure
  {
    const res = await request('GET', '/api/pdfme/templates/' + templateId + '/export', null, TOKEN_A);
    assert(res.status === 200, 'Export returns 200');
    assert(res.body.version === 1, 'Export version is 1');
    assert(typeof res.body.exportedAt === 'string', 'exportedAt is a string timestamp');
    assert(res.body.template !== undefined, 'Export includes template object');
    assert(res.body.template.name === 'Export Test Template', 'Export template name matches');
    assert(res.body.template.type === 'invoice', 'Export template type matches');
    assert(res.body.template.schema !== undefined, 'Export includes schema');
    assert(res.body.assets !== undefined, 'Export includes assets object');
    assert(Array.isArray(res.body.assets.images), 'Export has images array');
    assert(Array.isArray(res.body.assets.fonts), 'Export has fonts array');

    // Now test import on a "different system" (same org, new template)
    console.log('\n--- Testing import ---');
    const importRes = await request('POST', '/api/pdfme/templates/import', res.body, TOKEN_A);
    assert(importRes.status === 201, 'Import returns 201');
    assert(importRes.body.name === 'Export Test Template', 'Imported template name matches');
    assert(importRes.body.type === 'invoice', 'Imported template type matches');
    assert(importRes.body.status === 'draft', 'Imported template status is draft');
    assert(importRes.body.id !== templateId, 'Imported template has new ID');

    // Verify imported template has full schema
    const getRes = await request('GET', '/api/pdfme/templates/' + importRes.body.id, null, TOKEN_A);
    assert(getRes.status === 200, 'Imported template is retrievable');
    assert(getRes.body.schema !== undefined, 'Imported template has schema');
    const schemaStr = JSON.stringify(getRes.body.schema);
    assert(schemaStr.includes('erpImage'), 'Imported schema preserves erpImage type');
    assert(schemaStr.includes('test-logo.png'), 'Imported schema preserves asset reference');
  }

  // Test export of non-existent template
  {
    const res = await request('GET', '/api/pdfme/templates/nonexistent-id/export', null, TOKEN_A);
    assert(res.status === 404, 'Export of non-existent template returns 404');
  }

  // Test export with embedded data (create real asset first)
  console.log('\n--- Testing export with real asset data ---');
  {
    // Create a small PNG (1x1 pixel) and upload it
    const fs = require('fs');
    const path = require('path');
    const storageRoot = path.join(process.cwd(), 'storage');
    const assetDir = path.join(storageRoot, 'org-export-test', 'assets');
    const fontDir = path.join(storageRoot, 'org-export-test', 'fonts');
    fs.mkdirSync(assetDir, { recursive: true });
    fs.mkdirSync(fontDir, { recursive: true });

    // Write a tiny PNG file (1x1 red pixel)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, // 8bit RGB
      0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82 // IEND
    ]);
    fs.writeFileSync(path.join(assetDir, 'test-logo.png'), pngHeader);

    // Write a tiny TTF-like file (just for testing)
    const fontData = Buffer.from('fake-font-data-for-testing');
    fs.writeFileSync(path.join(fontDir, 'custom-font.ttf'), fontData);

    // Now export - should include embedded data
    const res = await request('GET', '/api/pdfme/templates/' + templateId + '/export', null, TOKEN_A);
    assert(res.status === 200, 'Export with assets returns 200');
    assert(res.body.assets.images.length > 0, 'Export includes embedded image data');
    assert(res.body.assets.images[0].data.length > 0, 'Image data is non-empty base64');
    assert(res.body.assets.images[0].mimeType === 'image/png', 'Image mime type is correct');
    assert(res.body.assets.images[0].path.includes('test-logo.png'), 'Image path preserved');
    assert(res.body.assets.fonts.length > 0, 'Export includes embedded font data');
    assert(res.body.assets.fonts[0].data.length > 0, 'Font data is non-empty base64');
    assert(res.body.assets.fonts[0].mimeType === 'font/ttf', 'Font mime type is correct');

    // Test that import restores the assets
    const importRes = await request('POST', '/api/pdfme/templates/import', res.body, TOKEN_A);
    assert(importRes.status === 201, 'Import with assets returns 201');

    // Verify the package is self-contained and importable
    assert(res.body.version === 1, 'Package has version field');
    assert(res.body.template.schema !== undefined, 'Package has complete schema');
    assert(res.body.assets.images.length >= 1, 'Package has at least 1 embedded image');
    assert(res.body.assets.fonts.length >= 1, 'Package has at least 1 embedded font');
  }

  // ─── Feature #141: Pessimistic edit lock acquisition ───
  console.log('\n=== Feature #141: Pessimistic edit lock acquisition ===');
  {
    // Acquire lock as user A
    const lockRes = await request('POST', '/api/pdfme/templates/' + templateId + '/lock', {}, TOKEN_A);
    assert(lockRes.status === 200, 'Lock acquired: status 200');
    assert(lockRes.body.locked === true, 'Lock response shows locked=true');
    assert(lockRes.body.lockedBy === 'user-A', 'lockedBy set to userId (user-A)');
    assert(lockRes.body.lockedAt !== undefined, 'lockedAt timestamp set');
    assert(lockRes.body.expiresAt !== undefined, 'expiresAt is set');

    // Verify lock expiry is ~30 min from now
    const lockedAt = new Date(lockRes.body.lockedAt).getTime();
    const expiresAt = new Date(lockRes.body.expiresAt).getTime();
    const diffMinutes = (expiresAt - lockedAt) / (60 * 1000);
    assert(Math.abs(diffMinutes - 30) < 1, 'Lock duration is ~30 minutes (got ' + diffMinutes.toFixed(1) + ')');

    // Verify lock status via GET
    const statusRes = await request('GET', '/api/pdfme/templates/' + templateId + '/lock', null, TOKEN_A);
    assert(statusRes.status === 200, 'Lock status endpoint returns 200');
    assert(statusRes.body.locked === true, 'Lock status shows locked');
    assert(statusRes.body.lockedBy === 'user-A', 'Lock status shows correct user');

    // User B should see template as locked (409 conflict when trying to lock)
    const lockResB = await request('POST', '/api/pdfme/templates/' + templateId + '/lock', {}, TOKEN_B);
    assert(lockResB.status === 409, 'Other user gets 409 Conflict: ' + lockResB.status);
    assert(lockResB.body.lockedBy === 'user-A', 'Conflict shows who holds the lock');

    // Verify template data shows lock info
    const tmplRes = await request('GET', '/api/pdfme/templates/' + templateId, null, TOKEN_B);
    assert(tmplRes.status === 200, 'Other user can still read template');
    assert(tmplRes.body.lockedBy === 'user-A', 'Template shows lockedBy in response');
    assert(tmplRes.body.lockedAt !== null, 'Template shows lockedAt in response');
  }

  // ─── Feature #142: Edit lock heartbeat renewal ───
  console.log('\n=== Feature #142: Edit lock heartbeat renewal ===');
  {
    // Get initial lock timestamp
    const status1 = await request('GET', '/api/pdfme/templates/' + templateId + '/lock', null, TOKEN_A);
    const initialLockedAt = status1.body.lockedAt;

    // Wait a moment to ensure time difference
    await sleep(1100);

    // Heartbeat: POST lock again (same user)
    const heartbeatRes = await request('POST', '/api/pdfme/templates/' + templateId + '/lock', {}, TOKEN_A);
    assert(heartbeatRes.status === 200, 'Heartbeat returns 200 (not 409)');
    assert(heartbeatRes.body.locked === true, 'Heartbeat confirms lock still held');
    assert(heartbeatRes.body.lockedBy === 'user-A', 'Heartbeat shows same user');

    // Verify lockedAt was updated (renewed)
    const renewedLockedAt = heartbeatRes.body.lockedAt;
    assert(renewedLockedAt !== initialLockedAt, 'lockedAt updated after heartbeat (renewed)');

    // Verify new expiry is extended
    const status2 = await request('GET', '/api/pdfme/templates/' + templateId + '/lock', null, TOKEN_A);
    const newLockedAt = new Date(status2.body.lockedAt).getTime();
    const newExpiresAt = new Date(status2.body.expiresAt).getTime();
    const diffMs = newExpiresAt - newLockedAt;
    assert(Math.abs(diffMs - 30 * 60 * 1000) < 2000, 'Renewed lock has full 30-min duration');
  }

  // ─── Cleanup: Release lock ───
  console.log('\n=== Cleanup ===');
  {
    const releaseRes = await request('DELETE', '/api/pdfme/templates/' + templateId + '/lock', null, TOKEN_A);
    assert(releaseRes.status === 200, 'Lock released successfully');
    assert(releaseRes.body.released === true, 'Release confirmed');

    // Verify unlocked
    const statusRes = await request('GET', '/api/pdfme/templates/' + templateId + '/lock', null, TOKEN_A);
    assert(statusRes.body.locked === false, 'Template is now unlocked');
  }

  // ─── Summary ───
  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
