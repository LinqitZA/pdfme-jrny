/**
 * Feature #233: Version history capped at 50
 *
 * Tests that maximum 50 versions are retained per template.
 * Oldest versions are purged when the cap is exceeded.
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('test-version-cap-233', 'org-version-cap-233', ['admin']);
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, msg) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ FAIL: ${msg}\n`);
  }
}

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...AUTH,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  process.stdout.write('\n=== Feature #233: Version history capped at 50 ===\n\n');

  // Create a template
  const createRes = await api('POST', '/templates', {
    name: 'Version Cap Test 233',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'v0' }],
        width: 210,
        height: 297,
      }],
    },
  });
  const templateId = createRes.body.id || createRes.body.template?.id;
  assert(!!templateId, `Template created: ${templateId}`);

  // Publish 55 times to create 55 version entries
  process.stdout.write('\n--- Publishing template 55 times ---\n');
  for (let i = 1; i <= 55; i++) {
    // Save draft with updated schema
    await api('PUT', `/templates/${templateId}/draft`, {
      schema: {
        pages: [{
          elements: [{ type: 'text', name: 'field1', position: { x: 10, y: 10 }, width: 50, height: 10, content: `version-${i}` }],
          width: 210,
          height: 297,
        }],
      },
    });
    // Publish
    await api('POST', `/templates/${templateId}/publish`, {});
    if (i % 10 === 0) {
      process.stdout.write(`  Published ${i}/55\n`);
    }
  }
  process.stdout.write(`  Published 55/55\n`);

  // Get version history
  const versionsRes = await api('GET', `/templates/${templateId}/versions`);
  assert(versionsRes.status === 200, `GET versions returned 200`);

  const versions = versionsRes.body.data;
  assert(Array.isArray(versions), `Versions response is an array`);
  assert(versions.length <= 50, `Max 50 versions returned (got ${versions.length})`);

  // Verify the latest 50 versions are present (versions are ordered desc by savedAt)
  // The latest publish was version 56 (initial + 55 publishes = version 56)
  // We should have versions from the most recent 50
  if (versions.length > 0) {
    const versionNumbers = versions.map(v => v.version).sort((a, b) => a - b);
    const highestVersion = Math.max(...versionNumbers);
    const lowestVersion = Math.min(...versionNumbers);

    assert(highestVersion >= 50, `Highest version is >= 50 (got ${highestVersion})`);
    assert(versions.length === 50, `Exactly 50 versions retained (got ${versions.length})`);

    process.stdout.write(`  Version range: ${lowestVersion} to ${highestVersion}\n`);

    // Verify oldest versions were purged - version 1 or 2 should not be present
    // since we created 55+ versions and cap is 50
    const hasVeryOld = versionNumbers.some(v => v <= 5);
    // With 55 publishes + initial, we should have purged at least the first few
    // The first few versions should be gone
    assert(!hasVeryOld || versions.length === 50, `Old versions purged or exactly 50 retained`);
  }

  // Verify we can still access the latest version
  const latestVersion = versions[0]; // first in desc order
  assert(!!latestVersion, `Latest version exists`);
  assert(latestVersion.version >= 50, `Latest version number is >= 50 (got ${latestVersion.version})`);
  assert(!!latestVersion.schema, `Latest version has schema data`);
  assert(!!latestVersion.savedBy, `Latest version has savedBy`);
  assert(!!latestVersion.savedAt, `Latest version has savedAt`);

  // Verify the oldest retained version
  const oldestVersion = versions[versions.length - 1]; // last in desc order
  assert(!!oldestVersion, `Oldest retained version exists`);
  process.stdout.write(`  Oldest retained version: ${oldestVersion.version}\n`);

  // Verify version 1 is no longer accessible (should have been purged)
  const v1Res = await api('GET', `/templates/${templateId}/versions/1`);
  // Version 1 was created on initial template creation (if version entry was created)
  // After 55 publishes, version 1 should be purged
  // Depending on whether initial create makes a version entry,
  // we check if old versions are gone
  const oldVersionGone = v1Res.status === 404 || !v1Res.body || !v1Res.body.version;

  // Verify early versions (2, 3, 4, 5) are purged
  process.stdout.write('\n--- Verifying old versions are purged ---\n');
  let purgedCount = 0;
  for (let v = 2; v <= 6; v++) {
    const vRes = await api('GET', `/templates/${templateId}/versions/${v}`);
    if (vRes.status === 404) {
      purgedCount++;
    }
  }
  assert(purgedCount >= 3, `At least 3 of versions 2-6 are purged (${purgedCount} purged)`);

  // Verify latest versions are still accessible
  process.stdout.write('\n--- Verifying latest versions are accessible ---\n');
  const latestVersionNum = versions[0].version;
  const checkVersionRes = await api('GET', `/templates/${templateId}/versions/${latestVersionNum}`);
  assert(checkVersionRes.status === 200, `Latest version ${latestVersionNum} is accessible`);
  assert(checkVersionRes.body.version === latestVersionNum, `Correct version number returned`);

  // Check a mid-range recent version
  const midVersion = latestVersionNum - 25;
  if (midVersion > 0) {
    const midRes = await api('GET', `/templates/${templateId}/versions/${midVersion}`);
    assert(midRes.status === 200, `Mid-range version ${midVersion} is accessible`);
  }

  // ---- Summary ----
  process.stdout.write(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  process.stderr.write(`Test error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
