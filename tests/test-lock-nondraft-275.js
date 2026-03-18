const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const JWT_TOKEN = createJwt({ sub: 'test-user-275', orgId: 'test-org-275', roles: ['template:admin'] });

let passed = 0;
let failed = 0;

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`,
        ...headers,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function createTemplate(name, type) {
  const res = await request('POST', '/api/pdfme/templates', {
    name, type, schema: { basePdf: 'BLANK_PDF', pages: [] },
  });
  return res.body;
}

async function run() {
  console.log('=== Feature #275: Lock acquisition on non-draft fails ===\n');

  const createdIds = [];

  // Create test templates
  console.log('--- Setup: Create test templates ---');
  const draftTpl = await createTemplate('LOCK_TEST_275_draft', 'invoice');
  createdIds.push(draftTpl.id);
  console.log(`  Created draft template: ${draftTpl.id} (status: ${draftTpl.status})`);

  // Create and publish a template (need valid schema for publish to succeed)
  const pubTpl = await createTemplate('LOCK_TEST_275_published', 'invoice');
  createdIds.push(pubTpl.id);
  // Save a schema with pages to pass validation
  await request('PUT', `/api/pdfme/templates/${pubTpl.id}/draft`, {
    schema: { basePdf: 'BLANK_PDF', schemas: [[{ name: { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 } }]] },
  });
  const pubRes = await request('POST', `/api/pdfme/templates/${pubTpl.id}/publish`);
  console.log(`  Publish result: status=${pubRes.status}, body.status=${pubRes.body.status}`);
  if (pubRes.body.status !== 'published') {
    console.log(`  Publish response:`, JSON.stringify(pubRes.body));
    // Try force-publishing via direct update as fallback
    await request('PUT', `/api/pdfme/templates/${pubTpl.id}`, { status: 'published' });
  }
  const pubCheck = await request('GET', `/api/pdfme/templates/${pubTpl.id}`);
  console.log(`  Created published template: ${pubTpl.id} (status: ${pubCheck.body.status})`);

  // Create and archive a template
  const archTpl = await createTemplate('LOCK_TEST_275_archived', 'invoice');
  createdIds.push(archTpl.id);
  await request('DELETE', `/api/pdfme/templates/${archTpl.id}`);
  console.log(`  Created archived template: ${archTpl.id}`);

  // ---- GROUP 1: Lock on draft succeeds ----
  console.log('\n--- Group 1: Lock on draft template → succeeds ---');

  {
    const res = await request('POST', `/api/pdfme/templates/${draftTpl.id}/lock`);
    assert(res.status === 200, `Lock on draft returns 200 (got ${res.status})`);
    assert(res.body.locked === true, `Lock response has locked=true (got ${res.body.locked})`);
    assert(res.body.lockedBy === 'test-user-275', `Lock response has correct lockedBy (got ${res.body.lockedBy})`);
    assert(res.body.lockedAt, `Lock response has lockedAt (got ${res.body.lockedAt})`);
    assert(res.body.expiresAt, `Lock response has expiresAt (got ${res.body.expiresAt})`);
  }

  // Release the draft lock
  await request('DELETE', `/api/pdfme/templates/${draftTpl.id}/lock`);

  // ---- GROUP 2: Lock on archived fails ----
  console.log('\n--- Group 2: Lock on archived template → fails ---');

  {
    const res = await request('POST', `/api/pdfme/templates/${archTpl.id}/lock`);
    assert(res.status === 422, `Lock on archived returns 422 (got ${res.status})`);
    assert(res.body.message && res.body.message.toLowerCase().includes('archived'), `Error mentions archived (got ${res.body.message})`);
  }

  {
    const res = await request('POST', `/api/pdfme/templates/${archTpl.id}/lock`);
    assert(res.body.statusCode === 422, `Error envelope has statusCode 422 (got ${res.body.statusCode})`);
    assert(res.body.error === 'Unprocessable Entity', `Error envelope has Unprocessable Entity (got ${res.body.error})`);
  }

  // ---- GROUP 3: Lock on published fails ----
  console.log('\n--- Group 3: Lock on published template → fails ---');

  {
    const res = await request('POST', `/api/pdfme/templates/${pubTpl.id}/lock`);
    assert(res.status === 422, `Lock on published returns 422 (got ${res.status})`);
    assert(res.body.message && res.body.message.toLowerCase().includes('published'), `Error mentions published (got ${res.body.message})`);
  }

  // ---- GROUP 4: Lock on nonexistent template ----
  console.log('\n--- Group 4: Lock on nonexistent template → 404 ---');

  {
    const res = await request('POST', '/api/pdfme/templates/nonexistent-id-12345/lock');
    assert(res.status === 404, `Lock on nonexistent returns 404 (got ${res.status})`);
    assert(res.body.message && res.body.message.includes('not found'), `Error mentions not found (got ${res.body.message})`);
  }

  // ---- GROUP 5: Draft lock works after re-acquiring ----
  console.log('\n--- Group 5: Re-acquiring lock on draft still works ---');

  {
    const res = await request('POST', `/api/pdfme/templates/${draftTpl.id}/lock`);
    assert(res.status === 200, `Re-lock on draft returns 200 (got ${res.status})`);
    assert(res.body.locked === true, `Re-lock has locked=true (got ${res.body.locked})`);
  }

  // Release and verify status
  {
    const res = await request('DELETE', `/api/pdfme/templates/${draftTpl.id}/lock`);
    assert(res.status === 200, `Release lock returns 200 (got ${res.status})`);
  }

  // ---- GROUP 6: Lock on archived with different user also fails ----
  console.log('\n--- Group 6: Different user also cannot lock archived ---');
  {
    const otherToken = createJwt({ sub: 'other-user-275', orgId: 'test-org-275', roles: ['template:admin'] });
    const res = await request('POST', `/api/pdfme/templates/${archTpl.id}/lock`, undefined, { 'Authorization': `Bearer ${otherToken}` });
    assert(res.status === 422, `Other user lock on archived returns 422 (got ${res.status})`);
  }

  // ---- GROUP 7: Verify template status unchanged after failed lock ----
  console.log('\n--- Group 7: Failed lock does not modify template ---');
  {
    // Try to lock archived
    await request('POST', `/api/pdfme/templates/${archTpl.id}/lock`);
    // Template should still have no lock
    const lockStatus = await request('GET', `/api/pdfme/templates/${archTpl.id}/lock`);
    assert(!lockStatus.body.lockedBy || lockStatus.body.lockedBy === '', `Archived template has no lockedBy after failed lock attempt (got ${lockStatus.body.lockedBy})`);
  }

  // ---- Cleanup ----
  console.log('\n--- Cleanup ---');
  for (const id of createdIds) {
    await request('DELETE', `/api/pdfme/templates/${id}`);
    console.log(`  Deleted: ${id}`);
  }

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
