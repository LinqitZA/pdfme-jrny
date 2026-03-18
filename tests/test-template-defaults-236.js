/**
 * Feature #236: New template has sensible defaults
 * Newly created template has correct default values
 *
 * Steps:
 * 1. POST /api/pdfme/templates with minimal data
 * 2. Verify status=draft
 * 3. Verify version=1
 * 4. Verify createdAt set to now
 * 5. Verify lockedBy and lockedAt are null
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-defaults-236';

const token = signJwt({ sub: 'defaults-test-user', orgId: ORG_ID, roles: ['template:edit'] });

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
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
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
  console.log('Feature #236: New template has sensible defaults\n');

  // Test 1: Create template with minimal data
  console.log('Test 1: Create template with minimal required fields');
  const beforeCreate = new Date();
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Defaults Test 236',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{ name: 'company', type: 'text', position: { x: 20, y: 30 }, width: 100, height: 10 }]],
      columns: ['company'],
    },
  });
  const afterCreate = new Date();
  assert(res.status === 201, `Template created (status ${res.status})`);
  const tpl = res.body;
  assert(tpl.id && typeof tpl.id === 'string', `Has valid id: ${tpl.id}`);

  // Test 2: Verify status=draft
  console.log('\nTest 2: Verify status=draft');
  assert(tpl.status === 'draft', `Status is draft (got: ${tpl.status})`);

  // Test 3: Verify version=1
  console.log('\nTest 3: Verify version=1');
  assert(tpl.version === 1, `Version is 1 (got: ${tpl.version})`);

  // Test 4: Verify createdAt set to now
  console.log('\nTest 4: Verify createdAt is set to approximately now');
  assert(tpl.createdAt, `createdAt is set: ${tpl.createdAt}`);
  const createdAt = new Date(tpl.createdAt);
  const timeDiffMs = Math.abs(createdAt.getTime() - beforeCreate.getTime());
  assert(timeDiffMs < 10000, `createdAt within 10s of request time (diff: ${timeDiffMs}ms)`);
  assert(createdAt >= new Date(beforeCreate.getTime() - 1000), `createdAt not before request`);

  // Test 5: Verify lockedBy and lockedAt are null
  console.log('\nTest 5: Verify lockedBy and lockedAt are null');
  assert(tpl.lockedBy === null || tpl.lockedBy === undefined, `lockedBy is null/undefined (got: ${tpl.lockedBy})`);
  assert(tpl.lockedAt === null || tpl.lockedAt === undefined, `lockedAt is null/undefined (got: ${tpl.lockedAt})`);

  // Test 6: Verify name is preserved
  console.log('\nTest 6: Verify name is preserved');
  assert(tpl.name === 'Defaults Test 236', `Name matches: ${tpl.name}`);

  // Test 7: Verify type is preserved
  console.log('\nTest 7: Verify type is preserved');
  assert(tpl.type === 'invoice', `Type matches: ${tpl.type}`);

  // Test 8: Verify updatedAt is set (from GET response, not create response)
  console.log('\nTest 8: Verify updatedAt is set (via GET)');

  // Test 9: Verify orgId from JWT is applied
  console.log('\nTest 9: Verify orgId from JWT');
  // Fetch the template directly to check full fields
  const getRes = await request('GET', `/api/pdfme/templates/${tpl.id}`);
  assert(getRes.status === 200, `Template retrievable by ID`);
  assert(getRes.body.updatedAt, `updatedAt is set: ${getRes.body.updatedAt}`);

  // Test 10: Verify schema is stored
  console.log('\nTest 10: Verify schema is stored');
  assert(getRes.body.schema !== null && getRes.body.schema !== undefined, `Schema is stored`);

  // Test 11: Verify publishedVer default
  console.log('\nTest 11: Verify publishedVer default');
  const publishedVer = getRes.body.publishedVer || tpl.publishedVer;
  assert(publishedVer === null || publishedVer === undefined || publishedVer === 0,
    `publishedVer is null/0 for draft (got: ${publishedVer})`);

  // Test 12: Verify forkedFromId is null
  console.log('\nTest 12: Verify forkedFromId is null');
  const forkedFrom = getRes.body.forkedFromId || tpl.forkedFromId;
  assert(forkedFrom === null || forkedFrom === undefined,
    `forkedFromId is null for new template (got: ${forkedFrom})`);

  // Test 13: Verify createdBy from JWT sub
  console.log('\nTest 13: Verify createdBy from JWT sub claim');
  const createdBy = getRes.body.createdBy || tpl.createdBy;
  assert(createdBy === 'defaults-test-user', `createdBy matches JWT sub: ${createdBy}`);

  // Test 14: Create second template - verify independent defaults
  console.log('\nTest 14: Second template has independent defaults');
  const res2 = await request('POST', '/api/pdfme/templates', {
    name: 'Defaults Test 236 B',
    type: 'statement',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{ name: 'amount', type: 'text', position: { x: 20, y: 30 }, width: 80, height: 10 }]],
      columns: ['amount'],
    },
  });
  assert(res2.status === 201, `Second template created`);
  assert(res2.body.status === 'draft', `Second template is also draft`);
  assert(res2.body.version === 1, `Second template version is also 1`);
  assert(res2.body.id !== tpl.id, `Second template has different ID`);

  // Test 15a: Verify lockedBy/lockedAt null from GET response
  console.log('\nTest 15a: Verify lockedBy/lockedAt null from full GET response');
  assert(getRes.body.lockedBy === null, `lockedBy null in GET response (got: ${getRes.body.lockedBy})`);
  assert(getRes.body.lockedAt === null, `lockedAt null in GET response (got: ${getRes.body.lockedAt})`);

  // Test 15: Verify saveMode default
  console.log('\nTest 15: Verify saveMode default');
  const saveMode = getRes.body.saveMode;
  // saveMode default from DB schema - either 'manual' or null depending on schema definition
  assert(saveMode === 'manual' || saveMode === null || saveMode === undefined, `saveMode is default value: ${saveMode}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
