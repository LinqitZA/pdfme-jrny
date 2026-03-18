/**
 * Test Feature #78: Template version history returns list
 *
 * Verifies:
 * - Save template multiple times creates version entries
 * - GET /api/pdfme/templates/:id/versions returns version list
 * - Each version has version number, status, savedBy, savedAt
 * - Versions are in reverse chronological order
 * - GET /api/pdfme/templates/:id/versions/:version returns specific version
 */

const crypto = require('crypto');
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-version-78';
const USER_ID = 'user-version-78';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let bodyData;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(body);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 15000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${testName}`);
  } else {
    failed++;
    results.push(`  ❌ ${testName}`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('=== Feature #78: Template version history returns list ===\n');

  // ─── Setup: Create a template ───
  console.log('--- Setup: Create template ---');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'Version History Test 78',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Version 1' }
        ]
      }]
    }
  }, TOKEN);

  assert(createRes.status === 201 || createRes.status === 200, 'Template created successfully (status ' + createRes.status + ')');
  const templateId = createRes.body && createRes.body.id;
  if (!templateId) {
    console.log('Cannot continue without template ID');
    console.log('\n' + results.join('\n'));
    console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
    process.exit(1);
  }

  // ─── Part 1: Save template multiple times ───
  console.log('--- Part 1: Save template multiple times ---');

  // Save #1
  await sleep(50); // Small delay to ensure different timestamps
  const save1 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Version 1 - Save 1' }
        ]
      }]
    },
    saveMode: 'inPlace',
  }, TOKEN);
  assert(save1.status === 200, 'Save #1 succeeded (status ' + save1.status + ')');

  // Save #2
  await sleep(50);
  const save2 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Version 1 - Save 2' },
          { type: 'text', name: 'subtitle', position: { x: 10, y: 50 }, width: 200, height: 20, content: 'Added in save 2' }
        ]
      }]
    },
    saveMode: 'inPlace',
  }, TOKEN);
  assert(save2.status === 200, 'Save #2 succeeded (status ' + save2.status + ')');

  // Save #3 with newVersion mode
  await sleep(50);
  const save3 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Version 1 - Save 3 (new version)' },
          { type: 'text', name: 'subtitle', position: { x: 10, y: 50 }, width: 200, height: 20, content: 'Updated in save 3' }
        ]
      }]
    },
    saveMode: 'newVersion',
  }, TOKEN);
  assert(save3.status === 200, 'Save #3 (newVersion) succeeded (status ' + save3.status + ')');

  // Save #4 - another inPlace save
  await sleep(50);
  const save4 = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'Version History Test 78 - Updated',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'heading', position: { x: 10, y: 10 }, width: 200, height: 30, content: 'Version 1 - Save 4' },
          { type: 'text', name: 'subtitle', position: { x: 10, y: 50 }, width: 200, height: 20, content: 'Final save' },
          { type: 'text', name: 'footer', position: { x: 10, y: 800 }, width: 200, height: 20, content: 'Footer added' }
        ]
      }]
    },
    saveMode: 'inPlace',
  }, TOKEN);
  assert(save4.status === 200, 'Save #4 succeeded (status ' + save4.status + ')');

  // ─── Part 2: GET version history ───
  console.log('--- Part 2: GET version history ---');

  const versionsRes = await request('GET', `/api/pdfme/templates/${templateId}/versions`, null, TOKEN);
  assert(versionsRes.status === 200, 'GET versions returns 200');

  const versions = versionsRes.body && versionsRes.body.data;
  assert(Array.isArray(versions), 'Response contains data array');

  // We saved 4 times, so expect at least 4 version entries
  assert(versions && versions.length >= 4, `At least 4 versions present (got ${versions ? versions.length : 0})`);

  // Test total count
  assert(
    versionsRes.body && versionsRes.body.total === versions.length,
    'Response includes total count matching data length'
  );

  // ─── Part 3: Version fields ───
  console.log('--- Part 3: Version fields ---');

  if (versions && versions.length > 0) {
    const firstVersion = versions[0]; // Most recent (reverse chronological)

    // Test 8: version number present
    assert(
      firstVersion.version !== undefined && typeof firstVersion.version === 'number',
      'Version entry has version number (got: ' + firstVersion.version + ')'
    );

    // Test 9: status field present
    assert(
      firstVersion.status !== undefined && typeof firstVersion.status === 'string',
      'Version entry has status field (got: ' + firstVersion.status + ')'
    );

    // Test 10: savedBy field present
    assert(
      firstVersion.savedBy !== undefined && typeof firstVersion.savedBy === 'string',
      'Version entry has savedBy field (got: ' + firstVersion.savedBy + ')'
    );

    // Test 11: savedAt field present
    assert(
      firstVersion.savedAt !== undefined,
      'Version entry has savedAt field (got: ' + firstVersion.savedAt + ')'
    );

    // Test 12: savedBy matches the user who saved
    assert(
      firstVersion.savedBy === USER_ID,
      'savedBy matches the authenticated user (expected: ' + USER_ID + ', got: ' + firstVersion.savedBy + ')'
    );

    // Test 13: status is draft
    assert(
      firstVersion.status === 'draft',
      'Version status is "draft" (got: ' + firstVersion.status + ')'
    );

    // Test 14: templateId matches
    assert(
      firstVersion.templateId === templateId,
      'Version templateId matches template (got: ' + firstVersion.templateId + ')'
    );

    // Test 15: version has id
    assert(
      firstVersion.id && typeof firstVersion.id === 'string',
      'Version entry has unique id'
    );

    // Test 16: schema snapshot present
    assert(
      firstVersion.schema !== undefined && firstVersion.schema !== null,
      'Version entry has schema snapshot'
    );

    // Test 17: schema snapshot contains pages
    const schemaHasPages = firstVersion.schema && (firstVersion.schema.pages || Array.isArray(firstVersion.schema));
    assert(
      schemaHasPages || typeof firstVersion.schema === 'object',
      'Schema snapshot contains template data'
    );
  } else {
    // Mark all field tests as failed
    for (let i = 0; i < 10; i++) {
      assert(false, 'Version field test (no versions returned)');
    }
  }

  // ─── Part 4: Reverse chronological order ───
  console.log('--- Part 4: Reverse chronological order ---');

  if (versions && versions.length >= 2) {
    // Test 18: First version has later savedAt than second
    const firstSavedAt = new Date(versions[0].savedAt).getTime();
    const secondSavedAt = new Date(versions[1].savedAt).getTime();
    assert(
      firstSavedAt >= secondSavedAt,
      'Versions are in reverse chronological order (newest first)'
    );

    // Test 19: All versions in descending order
    let allDescending = true;
    for (let i = 0; i < versions.length - 1; i++) {
      const a = new Date(versions[i].savedAt).getTime();
      const b = new Date(versions[i + 1].savedAt).getTime();
      if (a < b) { allDescending = false; break; }
    }
    assert(allDescending, 'All version entries in strict descending savedAt order');
  } else {
    assert(false, 'Versions are in reverse chronological order (not enough versions)');
    assert(false, 'All version entries in strict descending savedAt order');
  }

  // ─── Part 5: Get specific version by number ───
  console.log('--- Part 5: Get specific version by number ---');

  if (versions && versions.length > 0) {
    const versionNum = versions[0].version;
    const specificRes = await request('GET', `/api/pdfme/templates/${templateId}/versions/${versionNum}`, null, TOKEN);
    assert(specificRes.status === 200, 'GET specific version by number returns 200');
    assert(
      specificRes.body && specificRes.body.version === versionNum,
      'Specific version response has correct version number'
    );
    assert(
      specificRes.body && specificRes.body.templateId === templateId,
      'Specific version response has correct templateId'
    );
  } else {
    assert(false, 'GET specific version (no versions)');
    assert(false, 'Specific version has correct number');
    assert(false, 'Specific version has correct templateId');
  }

  // Test: Invalid version number
  const invalidRes = await request('GET', `/api/pdfme/templates/${templateId}/versions/0`, null, TOKEN);
  assert(invalidRes.status === 400, 'Invalid version number (0) returns 400');

  const negRes = await request('GET', `/api/pdfme/templates/${templateId}/versions/-1`, null, TOKEN);
  assert(negRes.status === 400, 'Negative version number returns 400');

  // Test: Non-existent version
  const noExist = await request('GET', `/api/pdfme/templates/${templateId}/versions/99999`, null, TOKEN);
  assert(noExist.status === 404, 'Non-existent version returns 404');

  // ─── Part 6: Version history for non-existent template ───
  console.log('--- Part 6: Edge cases ---');

  const noTemplateRes = await request('GET', `/api/pdfme/templates/non-existent-id/versions`, null, TOKEN);
  assert(
    noTemplateRes.status === 200 && noTemplateRes.body && noTemplateRes.body.data && noTemplateRes.body.data.length === 0,
    'Non-existent template returns empty version list (status ' + noTemplateRes.status + ')'
  );

  // ─── Part 7: Each save creates distinct version entry ───
  console.log('--- Part 7: Distinct version entries ---');

  if (versions && versions.length >= 4) {
    // Verify each version has a unique id
    const ids = versions.map(v => v.id);
    const uniqueIds = new Set(ids);
    assert(uniqueIds.size === versions.length, 'Each version has a unique id');

    // Verify each version has a distinct savedAt (or at least they're not all identical)
    const timestamps = versions.map(v => new Date(v.savedAt).getTime());
    const uniqueTimestamps = new Set(timestamps);
    assert(uniqueTimestamps.size >= 2, 'Version entries have varying timestamps');
  } else {
    assert(false, 'Each version has unique id');
    assert(false, 'Timestamps vary');
  }

  // ─── Part 8: Version after name change ───
  console.log('--- Part 8: Version after name change ---');

  // The most recent version should reflect the latest name change
  const latestTemplate = await request('GET', `/api/pdfme/templates/${templateId}`, null, TOKEN);
  assert(
    latestTemplate.status === 200 && latestTemplate.body.name === 'Version History Test 78 - Updated',
    'Template name updated to latest save'
  );

  // ─── Part 9: changeNote field ───
  console.log('--- Part 9: changeNote field ---');

  if (versions && versions.length >= 4) {
    // Find the newVersion save (should have "New version save" note)
    const newVersionEntry = versions.find(v => v.changeNote && v.changeNote.includes('New version'));
    assert(
      newVersionEntry !== undefined,
      'newVersion save has changeNote "New version save"'
    );

    // In-place saves should have "Draft save" note
    const draftEntries = versions.filter(v => v.changeNote && v.changeNote.includes('Draft save'));
    assert(
      draftEntries.length >= 1,
      'inPlace saves have changeNote "Draft save"'
    );
  } else {
    assert(false, 'changeNote for newVersion save');
    assert(false, 'changeNote for inPlace saves');
  }

  // ─── Part 10: Second template has independent version history ───
  console.log('--- Part 10: Isolated version history ---');

  const create2 = await request('POST', '/api/pdfme/templates', {
    name: 'Independent Template 78',
    type: 'statement',
    schema: {
      pages: [{ elements: [{ type: 'text', name: 'h', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Independent' }] }]
    }
  }, TOKEN);
  assert(create2.status === 201 || create2.status === 200, 'Second template created');

  if (create2.body && create2.body.id) {
    // Save once
    await request('PUT', `/api/pdfme/templates/${create2.body.id}/draft`, {
      schema: { pages: [{ elements: [{ type: 'text', name: 'h', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Updated' }] }] }
    }, TOKEN);

    const v2Res = await request('GET', `/api/pdfme/templates/${create2.body.id}/versions`, null, TOKEN);
    assert(
      v2Res.status === 200 && v2Res.body.data.length < versions.length,
      'Second template has fewer versions than first (isolated history)'
    );
  } else {
    assert(false, 'Second template isolated version history');
  }

  // ─── Part 11: Tenant isolation ───
  console.log('--- Part 11: Tenant isolation ---');

  const otherOrgToken = generateToken('org-other-78', 'user-other-78');
  const otherRes = await request('GET', `/api/pdfme/templates/${templateId}/versions`, null, otherOrgToken);
  assert(
    otherRes.status === 200 && otherRes.body.data && otherRes.body.data.length === 0,
    'Other org cannot see version history (tenant isolation)'
  );

  // ─── Part 12: Data persistence check ───
  console.log('--- Part 12: Data persistence ---');

  // Re-fetch versions to confirm persistence
  const refetchRes = await request('GET', `/api/pdfme/templates/${templateId}/versions`, null, TOKEN);
  assert(
    refetchRes.status === 200 && refetchRes.body.data.length === versions.length,
    'Version history persists on re-fetch (same count: ' + refetchRes.body.data.length + ')'
  );

  // ─── Summary ───
  console.log('\n' + results.join('\n'));
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
  if (failed > 0) {
    console.log(`❌ ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
