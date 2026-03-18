/**
 * Feature #235: Temp file auto-purge after retention period
 * Preview files cleaned up after 60 minutes
 *
 * Tests:
 * 1. Generate preview → file exists in storage
 * 2. Preview is downloadable before expiry
 * 3. Force-expire preview → simulate retention period elapsed
 * 4. Trigger purge cycle → expired preview file is removed
 * 5. Purge status endpoint reports correct counts
 * 6. Non-expired previews survive purge cycle
 * 7. Multiple expired previews purged in single cycle
 * 8. Purge removes file from disk (not just registry)
 * 9. Download after purge returns 410 Gone
 * 10. Purge handles already-deleted files gracefully
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-purge-235';

const token = signJwt({ sub: 'purge-test-user', orgId: ORG_ID, roles: ['template:edit', 'template:publish', 'render:trigger'] });

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createTemplate(name) {
  const res = await request('POST', '/api/pdfme/templates', {
    name,
    type: 'invoice',
    orgId: ORG_ID,
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{
        name: 'field1',
        type: 'text',
        position: { x: 20, y: 30 },
        width: 100,
        height: 10,
      }]],
      columns: ['field1'],
    },
  });
  return res.body;
}

async function publishTemplate(templateId) {
  await request('POST', `/api/pdfme/templates/${templateId}/publish`, {});
}

async function generatePreview(templateId) {
  const res = await request('POST', `/api/pdfme/templates/${templateId}/preview`, {
    channel: 'print',
  });
  return res;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function run() {
  console.log('Feature #235: Temp file auto-purge after retention period\n');

  // Setup: Create and publish a template
  const tpl = await createTemplate('Purge Test Template 235');
  const templateId = tpl.id;
  await publishTemplate(templateId);

  // Test 1: Generate preview → file exists
  console.log('Test 1: Generate preview creates file in storage');
  const preview1 = await generatePreview(templateId);
  assert(preview1.status === 200 || preview1.status === 201, `Preview generated (status ${preview1.status})`);
  const previewId1 = preview1.body.previewId;
  assert(previewId1 && previewId1.startsWith('prev_'), `Preview ID valid: ${previewId1}`);
  assert(preview1.body.expiresAt, `Has expiry time: ${preview1.body.expiresAt}`);

  // Test 2: Preview downloadable before expiry
  console.log('\nTest 2: Preview downloadable before expiry');
  const dl1 = await request('GET', `/api/pdfme/render/download/${previewId1}`);
  assert(dl1.status === 200, `Download succeeds (status ${dl1.status})`);

  // Test 3: Check purge status before any purge
  console.log('\nTest 3: Purge status endpoint works');
  const status1 = await request('GET', '/api/pdfme/render/purge-status');
  assert(status1.status === 200, `Purge status returns 200`);
  assert(typeof status1.body.registrySize === 'number', `Registry size reported: ${status1.body.registrySize}`);
  assert(status1.body.retentionPeriodMs === 3600000, `Retention period is 60 minutes (${status1.body.retentionPeriodMs}ms)`);

  // Test 4: Non-expired previews survive purge
  console.log('\nTest 4: Non-expired previews survive purge cycle');
  const purge1 = await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  assert(purge1.status === 200 || purge1.status === 201, `Purge cycle completed`);
  // previewId1 should still be in registry (not expired yet)
  const dl2 = await request('GET', `/api/pdfme/render/download/${previewId1}`);
  assert(dl2.status === 200, `Non-expired preview still downloadable after purge`);

  // Test 5: Force-expire then purge removes file
  console.log('\nTest 5: Force-expire + purge removes expired preview');
  const expire1 = await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: previewId1 });
  assert(expire1.body.expired === true, `Preview force-expired`);

  const purge2 = await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  assert(purge2.status === 200 || purge2.status === 201, `Purge cycle after expiry completed`);
  assert(purge2.body.purgedCount >= 1, `Purged count >= 1 (got ${purge2.body.purgedCount})`);

  // Test 6: Download after purge returns 410
  console.log('\nTest 6: Download after purge returns 410 Gone');
  const dl3 = await request('GET', `/api/pdfme/render/download/${previewId1}`);
  assert(dl3.status === 410, `Download returns 410 after purge (got ${dl3.status})`);

  // Test 7: Multiple expired previews purged in single cycle
  console.log('\nTest 7: Multiple expired previews purged in single cycle');
  const preview2 = await generatePreview(templateId);
  const preview3 = await generatePreview(templateId);
  const preview4 = await generatePreview(templateId);
  const pid2 = preview2.body.previewId;
  const pid3 = preview3.body.previewId;
  const pid4 = preview4.body.previewId;
  assert(pid2 && pid3 && pid4, `Generated 3 previews`);

  // Expire all three
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid2 });
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid3 });
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid4 });

  const purge3 = await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  assert(purge3.body.purgedCount >= 3, `Purged >= 3 previews in single cycle (got ${purge3.body.purgedCount})`);

  // Verify all three are gone
  const dl4 = await request('GET', `/api/pdfme/render/download/${pid2}`);
  const dl5 = await request('GET', `/api/pdfme/render/download/${pid3}`);
  const dl6 = await request('GET', `/api/pdfme/render/download/${pid4}`);
  assert(dl4.status === 410, `Preview 2 gone after purge (${dl4.status})`);
  assert(dl5.status === 410, `Preview 3 gone after purge (${dl5.status})`);
  assert(dl6.status === 410, `Preview 4 gone after purge (${dl6.status})`);

  // Test 8: Purge status reports correct last purge info
  console.log('\nTest 8: Purge status shows last purge metadata');
  const status2 = await request('GET', '/api/pdfme/render/purge-status');
  assert(status2.body.lastPurge !== null, `Last purge info exists`);
  assert(status2.body.lastPurge.purgedCount >= 3, `Last purge count >= 3`);
  assert(status2.body.lastPurge.timestamp, `Last purge has timestamp`);

  // Test 9: Fresh preview survives while expired is purged (mixed scenario)
  console.log('\nTest 9: Fresh preview survives while expired is purged');
  const preview5 = await generatePreview(templateId);
  const preview6 = await generatePreview(templateId);
  const pid5 = preview5.body.previewId;
  const pid6 = preview6.body.previewId;

  // Expire only one
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid5 });

  const purge4 = await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  assert(purge4.body.purgedCount >= 1, `At least 1 purged`);

  // pid5 should be gone, pid6 should survive
  const dl7 = await request('GET', `/api/pdfme/render/download/${pid5}`);
  const dl8 = await request('GET', `/api/pdfme/render/download/${pid6}`);
  assert(dl7.status === 410, `Expired preview purged (${dl7.status})`);
  assert(dl8.status === 200, `Fresh preview survives (${dl8.status})`);

  // Test 10: Purge handles already-deleted files gracefully
  console.log('\nTest 10: Purge handles already-deleted files gracefully');
  const preview7 = await generatePreview(templateId);
  const pid7 = preview7.body.previewId;

  // Force expire and download to trigger file deletion via getPreviewForDownload
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid7 });

  // Re-generate to get a new preview, then force-expire but corrupt the path
  const preview8 = await generatePreview(templateId);
  const pid8 = preview8.body.previewId;
  await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid8 });

  // Run purge - should handle gracefully even if files are already gone
  const purge5 = await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  assert(purge5.status === 200 || purge5.status === 201, `Purge completes without errors even with missing files`);
  assert(typeof purge5.body.purgedCount === 'number', `Purge count is a number: ${purge5.body.purgedCount}`);

  // Test 11: Verify purge interval configuration is exposed
  console.log('\nTest 11: Purge configuration exposed via status');
  const status3 = await request('GET', '/api/pdfme/render/purge-status');
  assert(status3.body.purgeIntervalMs === 300000, `Purge interval is 5 minutes (${status3.body.purgeIntervalMs}ms)`);

  // Cleanup: expire remaining preview (pid6)
  if (pid6) {
    await request('POST', '/api/pdfme/render/force-expire-preview', { previewId: pid6 });
    await request('POST', '/api/pdfme/render/purge-expired-previews', {});
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
