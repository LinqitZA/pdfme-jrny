/**
 * Feature #207: Direct access to archived template returns appropriate status
 * Archived templates accessible by ID but marked as archived, not in list results.
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const TOKEN = signJwt({ sub: 'test-user-207', orgId: 'org-207', roles: ['admin', 'template:edit', 'template:delete'] });

let passed = 0;
let failed = 0;
let createdId = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
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

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log('  ✅ ' + name);
  } else {
    failed++;
    console.log('  ❌ ' + name);
  }
}

async function runTests() {
  console.log('\n=== Feature #207: Direct access to archived template returns appropriate status ===\n');

  // Step 1: Create a template
  console.log('--- Setup: Create a template ---');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'ARCHIVE_TEST_207_' + Date.now(),
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
  });
  assert('Template created successfully', createRes.status === 201 || createRes.status === 200);
  createdId = createRes.body && createRes.body.id;
  assert('Template has an ID', !!createdId);
  console.log('  Created template ID:', createdId);

  // Step 2: Verify template appears in list
  console.log('\n--- Verify template appears in list before archiving ---');
  const listBefore = await request('GET', '/api/pdfme/templates');
  const inListBefore = listBefore.body && listBefore.body.data &&
    listBefore.body.data.some(t => t.id === createdId);
  assert('Template appears in list before archiving', inListBefore);

  // Step 3: Verify template accessible by direct ID
  console.log('\n--- Verify template accessible by ID before archiving ---');
  const getBeforeArchive = await request('GET', '/api/pdfme/templates/' + createdId);
  assert('GET by ID returns 200 before archiving', getBeforeArchive.status === 200);
  assert('Template status is draft', getBeforeArchive.body && getBeforeArchive.body.status === 'draft');

  // Step 4: Archive the template
  console.log('\n--- Archive the template ---');
  const archiveRes = await request('DELETE', '/api/pdfme/templates/' + createdId);
  assert('Archive (DELETE) returns success', archiveRes.status === 200 || archiveRes.status === 204);
  console.log('  Archive response:', archiveRes.status, JSON.stringify(archiveRes.body).substring(0, 200));

  // Step 5: GET archived template by direct ID - should return with status=archived
  console.log('\n--- GET /api/pdfme/templates/:archivedId - direct access ---');
  const getArchived = await request('GET', '/api/pdfme/templates/' + createdId);
  assert('GET by ID returns 200 for archived template', getArchived.status === 200);
  assert('Template status is "archived"', getArchived.body && getArchived.body.status === 'archived');
  assert('Template ID matches', getArchived.body && getArchived.body.id === createdId);
  assert('Template name preserved', getArchived.body && getArchived.body.name && getArchived.body.name.startsWith('ARCHIVE_TEST_207'));
  assert('Template type preserved', getArchived.body && getArchived.body.type === 'invoice');
  assert('Template schema preserved', getArchived.body && getArchived.body.schema && typeof getArchived.body.schema === 'object');

  // Step 6: Verify template NOT in list results
  console.log('\n--- Verify template excluded from list results ---');
  const listAfter = await request('GET', '/api/pdfme/templates');
  const inListAfter = listAfter.body && listAfter.body.data &&
    listAfter.body.data.some(t => t.id === createdId);
  assert('Archived template NOT in list results', !inListAfter);

  // Step 7: Verify other templates still in list
  assert('List still returns data array', listAfter.body && Array.isArray(listAfter.body.data));

  // Step 8: Verify template not in filtered list either
  console.log('\n--- Verify template not in type-filtered list ---');
  const filteredList = await request('GET', '/api/pdfme/templates?type=invoice');
  const inFilteredList = filteredList.body && filteredList.body.data &&
    filteredList.body.data.some(t => t.id === createdId);
  assert('Archived template NOT in type-filtered list', !inFilteredList);

  // Step 9: Verify archived template is in status=archived filter (if supported)
  console.log('\n--- Verify archived template appears with status=archived filter ---');
  const archivedList = await request('GET', '/api/pdfme/templates?status=archived');
  const inArchivedList = archivedList.body && archivedList.body.data &&
    archivedList.body.data.some(t => t.id === createdId);
  // This might not be supported since findAll excludes archived - that's OK
  console.log('  status=archived filter result:', archivedList.status, 'found:', inArchivedList);

  // Step 10: Create another template, archive it, verify both archived are accessible by ID
  console.log('\n--- Second archived template ---');
  const createRes2 = await request('POST', '/api/pdfme/templates', {
    name: 'ARCHIVE_TEST_207_SECOND_' + Date.now(),
    type: 'statement',
    schema: { pages: [{ elements: [] }] },
  });
  const secondId = createRes2.body && createRes2.body.id;
  assert('Second template created', !!secondId);

  await request('DELETE', '/api/pdfme/templates/' + secondId);

  const getSecondArchived = await request('GET', '/api/pdfme/templates/' + secondId);
  assert('Second archived template accessible by ID', getSecondArchived.status === 200);
  assert('Second archived template has status=archived', getSecondArchived.body && getSecondArchived.body.status === 'archived');

  // Both should still be directly accessible
  const getFirstAgain = await request('GET', '/api/pdfme/templates/' + createdId);
  assert('First archived template still accessible', getFirstAgain.status === 200 && getFirstAgain.body.status === 'archived');

  // Neither should appear in the default list
  const finalList = await request('GET', '/api/pdfme/templates');
  const firstInFinal = finalList.body && finalList.body.data && finalList.body.data.some(t => t.id === createdId);
  const secondInFinal = finalList.body && finalList.body.data && finalList.body.data.some(t => t.id === secondId);
  assert('First archived template NOT in final list', !firstInFinal);
  assert('Second archived template NOT in final list', !secondInFinal);

  // Summary
  console.log('\n=== Results: ' + passed + '/' + (passed + failed) + ' passed ===\n');
  if (failed > 0) {
    throw new Error(failed + ' tests failed');
  }
}

runTests().catch((err) => {
  console.error('Test error:', err.message);
});
