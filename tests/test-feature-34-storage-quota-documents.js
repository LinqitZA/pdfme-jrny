/**
 * Feature #34: Storage quota enforcement for documents
 *
 * Steps:
 * 1. Configure low quota for test tenant
 * 2. Generate documents until quota exceeded
 * 3. Verify 413 Payload Too Large response
 * 4. Verify error mentions storage quota
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles: roles || ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'system:seed'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'org-quota-test-34';
const USER_ID = 'user-quota-34';
const TOKEN = makeToken(USER_ID, ORG_ID);

// Second org for isolation testing
const ORG_ID_B = 'org-quota-test-34b';
const TOKEN_B = makeToken('user-quota-34b', ORG_ID_B);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

async function createTemplate(token, orgId, nameSuffix) {
  const name = `quota-test-template-${nameSuffix}-${Date.now()}`;
  const res = await request('POST', '/api/pdfme/templates', token, {
    name,
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'field1',
              type: 'text',
              position: { x: 10, y: 10 },
              width: 100,
              height: 20,
            },
          ],
        },
      ],
    },
  });
  return res.body;
}

async function publishTemplate(token, templateId) {
  return await request('POST', `/api/pdfme/templates/${templateId}/publish`, token);
}

async function renderDocument(token, templateId, entityId) {
  // Reset rate limit first to avoid 429s
  await request('POST', '/api/pdfme/render/rate-limit/reset', token, {});

  return await request('POST', '/api/pdfme/render/now', token, {
    templateId,
    entityId: entityId || `entity-${Date.now()}`,
    channel: 'email',
  });
}

async function setOrgQuota(token, quotaBytes) {
  return await request('PUT', '/api/pdfme/org-settings', token, {
    documentsQuotaBytes: quotaBytes,
  });
}

async function getOrgSettings(token) {
  return await request('GET', '/api/pdfme/org-settings', token);
}

async function resetOrgSettings(token) {
  return await request('POST', '/api/pdfme/org-settings/reset', token);
}

async function run() {
  console.log('Feature #34: Storage quota enforcement for documents\n');

  // Step 1: Create and publish a template
  console.log('Step 1: Setup - Create and publish a template');
  const template = await createTemplate(TOKEN, ORG_ID, 'main');
  assert(template.id, `Template created: ${template.id}`);

  const pubRes = await publishTemplate(TOKEN, template.id);
  assert(pubRes.status === 200 || pubRes.status === 201, `Template published (status ${pubRes.status})`);

  // Step 2: Configure a very low quota for the test tenant
  console.log('\nStep 2: Configure low quota for test tenant');
  const setRes = await setOrgQuota(TOKEN, 100); // 100 bytes - extremely low
  assert(setRes.status === 200, `Quota set (status ${setRes.status})`);

  const settingsRes = await getOrgSettings(TOKEN);
  assert(settingsRes.body.settings.documentsQuotaBytes === 100, `Quota is 100 bytes: ${settingsRes.body.settings.documentsQuotaBytes}`);

  // Step 3: First render should succeed (no documents yet, or small enough)
  // Actually with 100 bytes quota, even the first document may fail since PDFs are > 100 bytes
  console.log('\nStep 3: Attempt render with very low quota (100 bytes)');
  const renderRes1 = await renderDocument(TOKEN, template.id, 'entity-quota-1');
  // A generated PDF is typically > 100 bytes, so this should fail
  assert(renderRes1.status === 413, `Render rejected with 413 (got ${renderRes1.status})`);
  assert(renderRes1.body.error === 'Payload Too Large', `Error is "Payload Too Large": "${renderRes1.body.error}"`);
  assert(
    renderRes1.body.message && renderRes1.body.message.toLowerCase().includes('storage quota'),
    `Error message mentions storage quota: "${renderRes1.body.message}"`
  );

  // Step 4: Increase quota to allow at least one document
  console.log('\nStep 4: Increase quota to allow one document, then exceed');
  // Set a generous quota first to allow one render
  await setOrgQuota(TOKEN, 50 * 1024 * 1024); // 50MB - generous
  const renderOk = await renderDocument(TOKEN, template.id, 'entity-quota-ok');
  assert(renderOk.status === 201, `Render succeeded with generous quota (status ${renderOk.status})`);
  assert(renderOk.body.document, 'Response contains document');

  // Now set quota just barely above current usage (we know at least one doc exists)
  // Set quota to something very small - slightly less than current usage
  console.log('\nStep 5: Set quota below current usage and try again');
  await setOrgQuota(TOKEN, 1); // 1 byte - definitely below usage now
  const renderRes2 = await renderDocument(TOKEN, template.id, 'entity-quota-2');
  assert(renderRes2.status === 413, `Second render rejected with 413 (got ${renderRes2.status})`);
  assert(
    renderRes2.body.message && renderRes2.body.message.toLowerCase().includes('quota'),
    `Error mentions quota: "${renderRes2.body.message}"`
  );

  // Step 6: Verify quota info is in the response
  console.log('\nStep 6: Verify error response contains quota details');
  assert(renderRes2.body.quotaExceeded === true, `quotaExceeded flag is true`);
  assert(typeof renderRes2.body.currentUsageBytes === 'number', `currentUsageBytes is a number: ${renderRes2.body.currentUsageBytes}`);
  assert(typeof renderRes2.body.quotaBytes === 'number', `quotaBytes is a number: ${renderRes2.body.quotaBytes}`);
  assert(renderRes2.body.currentUsageBytes > renderRes2.body.quotaBytes, `Current usage (${renderRes2.body.currentUsageBytes}) exceeds quota (${renderRes2.body.quotaBytes})`);

  // Step 7: Increase quota again - rendering should work
  console.log('\nStep 7: Increase quota - rendering resumes');
  await setOrgQuota(TOKEN, 100 * 1024 * 1024); // 100MB
  const renderRes3 = await renderDocument(TOKEN, template.id, 'entity-quota-3');
  assert(renderRes3.status === 201, `Render succeeds after quota increase (status ${renderRes3.status})`);

  // Step 8: Reset settings - default quota (5GB) should allow renders
  console.log('\nStep 8: Reset to defaults - renders work with default quota');
  await resetOrgSettings(TOKEN);
  const renderRes4 = await renderDocument(TOKEN, template.id, 'entity-quota-4');
  assert(renderRes4.status === 201, `Render succeeds with default quota (status ${renderRes4.status})`);

  // Step 9: Tenant isolation - other org not affected by quota
  console.log('\nStep 9: Tenant isolation - other org not affected');
  const templateB = await createTemplate(TOKEN_B, ORG_ID_B, 'other');
  assert(templateB.id, `Org B template created`);
  await publishTemplate(TOKEN_B, templateB.id);

  // Set org A quota to 1 byte
  await setOrgQuota(TOKEN, 1);
  // Org B should still be able to render (default quota)
  const renderResB = await renderDocument(TOKEN_B, templateB.id, 'entity-b-1');
  assert(renderResB.status === 201, `Org B render succeeds despite Org A quota limit (status ${renderResB.status})`);

  // Org A should still be blocked
  const renderResA = await renderDocument(TOKEN, template.id, 'entity-quota-5');
  assert(renderResA.status === 413, `Org A still blocked (status ${renderResA.status})`);

  // Cleanup: reset org A settings
  await resetOrgSettings(TOKEN);

  console.log(`\n--- Results: ${passed} passed, ${failed} failed out of ${passed + failed} ---`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
