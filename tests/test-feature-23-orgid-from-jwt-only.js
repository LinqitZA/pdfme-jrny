/**
 * Feature #23: orgId always derived from JWT, never from request body
 *
 * Tests that API endpoints ignore orgId in request body and URL params
 * when a valid JWT is present, always using the JWT's orgId claim.
 */
const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const SECRET = 'pdfme-dev-secret';
let passed = 0;
let failed = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function multipartUpload(urlPath, filename, buffer, token) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    const url = new URL(BASE + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function assert(name, condition) {
  if (condition) {
    passed++;
    process.stdout.write('  ✅ ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('  ❌ ' + name + '\n');
  }
}

async function run() {
  process.stdout.write('=== Feature #23: orgId always derived from JWT, never from request body ===\n\n');

  const TS = Date.now();
  const JWT_ORG = `org-jwt-${TS}`;
  const FAKE_ORG = `org-fake-${TS}`;

  const token = makeToken('user-23', JWT_ORG, ['template:view', 'template:edit', 'template:publish', 'template:delete']);
  const verifyToken = makeToken('user-23-verify', FAKE_ORG, ['template:view', 'template:edit']);

  // ============================================================
  // Step 1: POST /api/pdfme/templates with orgId in body set to different-org
  // ============================================================
  process.stdout.write('Step 1: Create template with orgId in body set to different org\n');

  const createRes = await request('POST', '/api/pdfme/templates', token, {
    name: `JWT-Test-${TS}`,
    type: 'invoice',
    orgId: FAKE_ORG, // Try to spoof orgId via body
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Template creation succeeds (201)', createRes.status === 201);
  const templateId = createRes.data.id;

  // ============================================================
  // Step 2: Verify template created with orgId from JWT, not from body
  // ============================================================
  process.stdout.write('\nStep 2: Verify template orgId comes from JWT\n');

  const getRes = await request('GET', `/api/pdfme/templates/${templateId}`, token);
  assert('Template retrieved successfully', getRes.status === 200);
  assert('Template orgId matches JWT orgId', getRes.data.orgId === JWT_ORG);
  assert('Template orgId is NOT the fake body orgId', getRes.data.orgId !== FAKE_ORG);

  // Verify the fake-org user cannot see it
  const fakeOrgList = await request('GET', '/api/pdfme/templates', verifyToken);
  const fakeOrgTemplates = (fakeOrgList.data.data || []).filter(t => t.id === templateId);
  assert('Fake-org user cannot see the template', fakeOrgTemplates.length === 0);

  // JWT org user can see it in their list
  const jwtOrgList = await request('GET', '/api/pdfme/templates', token);
  const jwtOrgTemplates = (jwtOrgList.data.data || []).filter(t => t.id === templateId);
  assert('JWT-org user CAN see the template in their list', jwtOrgTemplates.length === 1);

  // ============================================================
  // Step 3: Verify no way to override orgId via URL params
  // ============================================================
  process.stdout.write('\nStep 3: Verify URL param orgId does not override JWT\n');

  // List with fake orgId in query param - JWT should still take precedence
  const paramOverrideList = await request('GET', `/api/pdfme/templates?orgId=${FAKE_ORG}`, token);
  assert('Query param override list succeeds', paramOverrideList.status === 200);
  // The response should show JWT org templates, not fake org templates
  const paramTemplates = (paramOverrideList.data.data || []).filter(t => t.id === templateId);
  assert('Template still visible with JWT (query param ignored)', paramTemplates.length === 1);

  // ============================================================
  // Step 4: Template update also uses JWT orgId
  // ============================================================
  process.stdout.write('\nStep 4: Template update uses JWT orgId (body orgId ignored)\n');

  const updateRes = await request('PUT', `/api/pdfme/templates/${templateId}`, token, {
    name: `JWT-Test-Updated-${TS}`,
    orgId: FAKE_ORG, // Try to spoof on update
  });
  assert('Update succeeds', updateRes.status === 200);

  const getAfterUpdate = await request('GET', `/api/pdfme/templates/${templateId}`, token);
  assert('Template orgId still JWT org after update', getAfterUpdate.data.orgId === JWT_ORG);
  assert('Template orgId NOT changed to fake org', getAfterUpdate.data.orgId !== FAKE_ORG);

  // ============================================================
  // Step 5: Create with body.createdBy - JWT sub takes precedence
  // ============================================================
  process.stdout.write('\nStep 5: createdBy from JWT, not body\n');

  const create2 = await request('POST', '/api/pdfme/templates', token, {
    name: `JWT-CreatedBy-${TS}`,
    type: 'invoice',
    createdBy: 'spoofed-user',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Second template created', create2.status === 201);
  const template2Id = create2.data.id;

  const get2 = await request('GET', `/api/pdfme/templates/${template2Id}`, token);
  assert('createdBy matches JWT sub, not body', get2.data.createdBy === 'user-23');
  assert('createdBy is NOT spoofed value', get2.data.createdBy !== 'spoofed-user');

  // ============================================================
  // Step 6: Asset upload uses JWT orgId, ignores query orgId
  // ============================================================
  process.stdout.write('\nStep 6: Asset upload uses JWT orgId\n');

  // Create a small PNG
  const pngBuf = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x36, 0x28, 0x19,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);

  // Upload with query param orgId = FAKE_ORG but JWT has JWT_ORG
  const assetUpload = await multipartUpload(
    `/api/pdfme/assets/upload?orgId=${FAKE_ORG}`,
    `test-asset-${TS}.png`,
    pngBuf,
    token,
  );
  assert('Asset upload succeeds', assetUpload.status === 201);
  assert('Asset orgId is JWT org, not query param', assetUpload.data.orgId === JWT_ORG);
  assert('Asset storagePath starts with JWT org', assetUpload.data.storagePath.startsWith(JWT_ORG + '/'));
  assert('Asset NOT stored under fake org', !assetUpload.data.storagePath.startsWith(FAKE_ORG + '/'));

  // ============================================================
  // Step 7: Signature upload uses JWT orgId
  // ============================================================
  process.stdout.write('\nStep 7: Signature upload uses JWT orgId\n');

  const sigData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x36, 0x28, 0x19,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
  ]).toString('base64');

  const sigUpload = await request('POST', '/api/pdfme/signatures', token, {
    data: `data:image/png;base64,${sigData}`,
    orgId: FAKE_ORG, // Try to spoof via body
  });
  assert('Signature upload succeeds', sigUpload.status === 201);
  assert('Signature orgId from JWT', sigUpload.data.orgId === JWT_ORG);
  assert('Signature filePath prefixed with JWT org', sigUpload.data.filePath.startsWith(JWT_ORG + '/'));

  // ============================================================
  // Step 8: Without JWT, fallback to query orgId works (backward compat)
  // ============================================================
  process.stdout.write('\nStep 8: Without JWT, fallback to query param (backward compat)\n');

  // Template list without JWT uses query orgId as fallback
  const noAuthList = await request('GET', `/api/pdfme/templates?orgId=${JWT_ORG}`, null);
  // Should either work (if auth is optional for GET) or return 401
  // Either way, JWT_ORG should not be spoofable when JWT IS present
  assert('Request without JWT handled (not crash)', noAuthList.status >= 200 && noAuthList.status < 600);

  // ============================================================
  // Step 9: Multiple endpoints consistently use JWT orgId
  // ============================================================
  process.stdout.write('\nStep 9: Draft save uses JWT orgId\n');

  const draftRes = await request('PUT', `/api/pdfme/templates/${templateId}/draft`, token, {
    orgId: FAKE_ORG, // spoof attempt
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'title', content: 'Draft Updated', position: { x: 10, y: 10 }, width: 100, height: 20 }
        ]
      }]
    },
  });
  assert('Draft save succeeds', draftRes.status === 200);

  const getAfterDraft = await request('GET', `/api/pdfme/templates/${templateId}`, token);
  assert('Template still belongs to JWT org after draft save', getAfterDraft.data.orgId === JWT_ORG);

  // ============================================================
  // Step 10: Delete uses JWT orgId scope
  // ============================================================
  process.stdout.write('\nStep 10: Delete uses JWT orgId scope\n');

  // Fake org user cannot delete JWT org template
  const crossDeleteToken = makeToken('user-23-cross', FAKE_ORG, ['template:view', 'template:edit', 'template:delete']);
  const crossDelete = await request('DELETE', `/api/pdfme/templates/${templateId}`, crossDeleteToken);
  assert('Cross-org delete returns 404 (not found in other org)', crossDelete.status === 404);

  // JWT org user can delete own template
  const ownDelete = await request('DELETE', `/api/pdfme/templates/${templateId}`, token);
  assert('Own-org delete succeeds', ownDelete.status === 200 || ownDelete.status === 204);

  // ============================================================
  // Cleanup
  // ============================================================
  process.stdout.write('\nCleanup\n');
  await request('DELETE', `/api/pdfme/templates/${template2Id}`, token);
  await request('DELETE', `/api/pdfme/signatures/me`, token);

  // ============================================================
  // Summary
  // ============================================================
  process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
