const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-272', 'test-org-272', ['admin']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
var cleanupTemplates = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function createPublishedTemplate(name) {
  var tRes = await request('POST', '/templates', {
    name: name,
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
  });
  var id = tRes.body.id;
  cleanupTemplates.push(id);
  await request('POST', '/templates/' + id + '/publish', {});
  return id;
}

async function run() {
  console.log('=== Feature #272: Bulk entityIds uniqueness validation ===\n');

  // Test 1: Duplicate entityIds should be rejected
  console.log('Test 1: POST bulk with duplicate entityIds');
  var templateId1 = await createPublishedTemplate('Bulk Test 272-1');
  var r1 = await request('POST', '/render/bulk', {
    templateId: templateId1,
    entityIds: ['entity-1', 'entity-2', 'entity-1', 'entity-3'],
    channel: 'email',
  });
  console.log('  Response: ' + JSON.stringify(r1.body).substring(0, 300));
  assert(r1.status === 400, 'Rejected with 400: status=' + r1.status);
  assert(r1.body.message && r1.body.message.toLowerCase().includes('duplicate'), 'Error mentions duplicate: ' + r1.body.message);
  assert(Array.isArray(r1.body.details), 'Response has details array');
  if (r1.body.details && r1.body.details.length > 0) {
    assert(r1.body.details[0].reason && r1.body.details[0].reason.includes('entity-1'), 'Details mention the duplicate ID "entity-1"');
    assert(Array.isArray(r1.body.details[0].duplicates), 'Details include duplicates array');
  }

  // Test 2: All unique entityIds should succeed (202)
  console.log('\nTest 2: POST bulk with all unique entityIds');
  var templateId2 = await createPublishedTemplate('Bulk Test 272-2');
  var r2 = await request('POST', '/render/bulk', {
    templateId: templateId2,
    entityIds: ['unique-1', 'unique-2', 'unique-3'],
    channel: 'email',
  });
  console.log('  Status: ' + r2.status);
  assert(r2.status === 202 || r2.status === 200, 'Accepted with 202: status=' + r2.status);

  // Test 3: Multiple duplicate IDs
  console.log('\nTest 3: Multiple duplicate IDs');
  var templateId3 = await createPublishedTemplate('Bulk Test 272-3');
  var r3 = await request('POST', '/render/bulk', {
    templateId: templateId3,
    entityIds: ['a', 'b', 'a', 'c', 'b', 'd', 'a'],
    channel: 'email',
  });
  console.log('  Response: ' + JSON.stringify(r3.body).substring(0, 300));
  assert(r3.status === 400, 'Rejected with 400: status=' + r3.status);
  if (r3.body.details && r3.body.details[0] && r3.body.details[0].duplicates) {
    var dups = r3.body.details[0].duplicates;
    assert(dups.indexOf('a') >= 0, 'Duplicates include "a": ' + JSON.stringify(dups));
    assert(dups.indexOf('b') >= 0, 'Duplicates include "b": ' + JSON.stringify(dups));
    assert(dups.indexOf('c') < 0, 'Non-duplicate "c" not in list');
  } else {
    assert(false, 'Expected duplicates array in details');
    assert(false, 'Expected duplicates array in details');
    assert(false, 'Expected duplicates array in details');
  }

  // Test 4: Single ID (no duplicates possible) - use separate template to avoid batch conflict
  console.log('\nTest 4: Single entityId (no duplicates)');
  var templateId4 = await createPublishedTemplate('Bulk Test 272-4');
  var r4 = await request('POST', '/render/bulk', {
    templateId: templateId4,
    entityIds: ['single-entity'],
    channel: 'email',
  });
  assert(r4.status === 202 || r4.status === 200, 'Single ID accepted: status=' + r4.status);

  // Test 5: Two identical IDs
  console.log('\nTest 5: Two identical entityIds');
  var templateId5 = await createPublishedTemplate('Bulk Test 272-5');
  var r5 = await request('POST', '/render/bulk', {
    templateId: templateId5,
    entityIds: ['same', 'same'],
    channel: 'email',
  });
  assert(r5.status === 400, 'Two identical IDs rejected: status=' + r5.status);

  // Test 6: Error response structure
  console.log('\nTest 6: Error response structure');
  assert(r1.body.statusCode === 400, 'statusCode is 400');
  assert(r1.body.error === 'Bad Request', 'error is Bad Request: ' + r1.body.error);
  assert(typeof r1.body.message === 'string', 'has message string');
  assert(r1.body.details[0].field === 'entityIds', 'details field is entityIds');

  // Test 7: Large list with one duplicate
  console.log('\nTest 7: Large list with one duplicate at end');
  var largeIds = [];
  for (var i = 0; i < 50; i++) {
    largeIds.push('entity-' + i);
  }
  largeIds.push('entity-0');
  var templateId7 = await createPublishedTemplate('Bulk Test 272-7');
  var r7 = await request('POST', '/render/bulk', {
    templateId: templateId7,
    entityIds: largeIds,
    channel: 'email',
  });
  assert(r7.status === 400, 'Large list with duplicate rejected: status=' + r7.status);

  // Test 8: Case-sensitive uniqueness (entity-A vs entity-a are different)
  console.log('\nTest 8: Case-sensitive entityIds are unique');
  var templateId8 = await createPublishedTemplate('Bulk Test 272-8');
  var r8 = await request('POST', '/render/bulk', {
    templateId: templateId8,
    entityIds: ['Entity-A', 'entity-a', 'ENTITY-A'],
    channel: 'email',
  });
  assert(r8.status === 202 || r8.status === 200, 'Case-different IDs accepted: status=' + r8.status);

  // Test 9: Empty entityIds still fails
  console.log('\nTest 9: Empty entityIds still fails');
  var r9 = await request('POST', '/render/bulk', {
    templateId: templateId1,
    entityIds: [],
    channel: 'email',
  });
  assert(r9.status === 400, 'Empty entityIds rejected: status=' + r9.status);

  // Test 10: Duplicate check comes before other validations
  console.log('\nTest 10: Duplicates detected even without valid templateId');
  var r10 = await request('POST', '/render/bulk', {
    templateId: 'nonexistent',
    entityIds: ['dup1', 'dup1'],
    channel: 'email',
  });
  assert(r10.status === 400, 'Duplicates caught regardless of templateId: status=' + r10.status);
  assert(r10.body.message && r10.body.message.includes('unique'), 'Error about uniqueness: ' + r10.body.message);

  // Cleanup
  console.log('\nCleanup: archiving test templates');
  for (var j = 0; j < cleanupTemplates.length; j++) {
    await request('DELETE', '/templates/' + cleanupTemplates[j]);
  }

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
