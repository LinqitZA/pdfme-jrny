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

const TOKEN = makeToken('test-user-270', 'test-org-270', ['admin']);

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

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function run() {
  console.log('=== Feature #270: Required fields validation on template ===\n');

  // Test 1: Create template with empty schema (no pages/elements)
  console.log('Test 1: Create template with empty schema');
  const t1 = await request('POST', '/templates', {
    name: 'Empty Template 270',
    type: 'invoice',
    schema: {},
  });
  assert(t1.status === 201, 'Template created with empty schema: status=' + t1.status);
  const templateId1 = t1.body.id;
  console.log('  Template ID: ' + templateId1);

  // Test 2: Try to publish empty template - should fail validation
  console.log('\nTest 2: Publish empty template (no pages)');
  const p1 = await request('POST', '/templates/' + templateId1 + '/publish', {});
  console.log('  Response: ' + JSON.stringify(p1.body).substring(0, 300));
  assert(p1.status === 422, 'Publish rejected with 422: status=' + p1.status);
  assert(p1.body.message && p1.body.message.includes('validation'), 'Error message mentions validation: ' + p1.body.message);
  assert(Array.isArray(p1.body.details), 'Response has details array');
  if (p1.body.details) {
    const hasPageError = p1.body.details.some(function(d) { return d.message && d.message.toLowerCase().includes('page'); });
    assert(hasPageError, 'Validation error mentions pages');
  }

  // Test 3: Create template with pages but NO elements
  console.log('\nTest 3: Create template with pages but no elements');
  const t2 = await request('POST', '/templates', {
    name: 'No Elements 270',
    type: 'invoice',
    schema: { pages: [{}] },
  });
  assert(t2.status === 201, 'Template created: status=' + t2.status);
  const templateId2 = t2.body.id;

  // Test 4: Publish template with pages but no elements - should warn
  console.log('\nTest 4: Publish template with pages but no elements');
  const p2 = await request('POST', '/templates/' + templateId2 + '/publish', {});
  console.log('  Status: ' + p2.status + ', Body: ' + JSON.stringify(p2.body).substring(0, 300));
  assert(p2.status === 422, 'Publish rejected for empty pages: status=' + p2.status);
  if (p2.body.details) {
    const hasElementWarning = p2.body.details.some(function(d) {
      return d.message && (d.message.toLowerCase().includes('element') || d.message.toLowerCase().includes('empty'));
    });
    assert(hasElementWarning, 'Validation warns about missing elements');
  }

  // Test 5: Create template with pages and empty elements array
  console.log('\nTest 5: Create template with empty elements array');
  const t3 = await request('POST', '/templates', {
    name: 'Empty Elements 270',
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
  });
  assert(t3.status === 201, 'Template created: status=' + t3.status);
  const templateId3 = t3.body.id;

  // Test 6: Publish with empty elements - should also fail
  console.log('\nTest 6: Publish template with empty elements array');
  const p3 = await request('POST', '/templates/' + templateId3 + '/publish', {});
  console.log('  Status: ' + p3.status + ', Body: ' + JSON.stringify(p3.body).substring(0, 300));
  assert(p3.status === 422, 'Publish rejected for empty elements: status=' + p3.status);

  // Test 7: Create template with valid elements - publish should succeed
  console.log('\nTest 7: Create template with valid elements');
  const t4 = await request('POST', '/templates', {
    name: 'Valid Template 270',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{
          type: 'text',
          content: 'Hello World',
          position: { x: 10, y: 10 },
          width: 100,
          height: 20,
        }],
      }],
    },
  });
  assert(t4.status === 201, 'Template created with elements: status=' + t4.status);
  const templateId4 = t4.body.id;

  // Test 8: Publish valid template - should succeed
  console.log('\nTest 8: Publish valid template');
  const p4 = await request('POST', '/templates/' + templateId4 + '/publish', {});
  console.log('  Status: ' + p4.status);
  assert(p4.status === 200 || p4.status === 201, 'Publish succeeds: status=' + p4.status);
  if (p4.body.status) {
    assert(p4.body.status === 'published', 'Template status is published: ' + p4.body.status);
  }

  // Test 9: Template with multiple empty pages
  console.log('\nTest 9: Template with multiple empty pages');
  const t5 = await request('POST', '/templates', {
    name: 'Multi Empty Pages 270',
    type: 'invoice',
    schema: { pages: [{}, {}, {}] },
  });
  assert(t5.status === 201, 'Template created: status=' + t5.status);
  const templateId5 = t5.body.id;

  const p5 = await request('POST', '/templates/' + templateId5 + '/publish', {});
  assert(p5.status === 422, 'Publish rejected for multiple empty pages: status=' + p5.status);

  // Test 10: Template with one valid page and one empty page
  console.log('\nTest 10: Template with mixed pages (one valid, one empty)');
  const t6 = await request('POST', '/templates', {
    name: 'Mixed Pages 270',
    type: 'invoice',
    schema: {
      pages: [
        { elements: [{ type: 'text', content: 'Page 1', position: { x: 10, y: 10 }, width: 100, height: 20 }] },
        { elements: [] },
      ],
    },
  });
  assert(t6.status === 201, 'Template created: status=' + t6.status);
  const templateId6 = t6.body.id;

  const p6 = await request('POST', '/templates/' + templateId6 + '/publish', {});
  console.log('  Status: ' + p6.status + ', Body: ' + JSON.stringify(p6.body).substring(0, 200));
  assert(p6.status === 422, 'Publish rejected - has empty page: status=' + p6.status);

  // Test 11: Schema with schemas key instead of pages
  console.log('\nTest 11: Schema uses "schemas" key (no elements)');
  const t7 = await request('POST', '/templates', {
    name: 'Schemas Key 270',
    type: 'invoice',
    schema: { schemas: [{}] },
  });
  assert(t7.status === 201, 'Template created: status=' + t7.status);
  const templateId7 = t7.body.id;

  const p7 = await request('POST', '/templates/' + templateId7 + '/publish', {});
  assert(p7.status === 422, 'Publish rejected for schemas with no elements: status=' + p7.status);

  // Test 12: Validate error response structure
  console.log('\nTest 12: Validate error response structure');
  assert(p1.body.statusCode === 422, 'Error statusCode is 422');
  assert(p1.body.error === 'Unprocessable Entity', 'Error type is Unprocessable Entity: ' + p1.body.error);
  assert(typeof p1.body.message === 'string', 'Error has message string');
  assert(Array.isArray(p1.body.details) && p1.body.details.length > 0, 'Error has non-empty details array');

  // Test 13: Template with null schema should fail creation
  console.log('\nTest 13: Template with missing schema fails creation');
  const t8 = await request('POST', '/templates', {
    name: 'No Schema 270',
    type: 'invoice',
  });
  assert(t8.status === 400, 'Template creation rejected without schema: status=' + t8.status);

  // Test 14: Template missing name should fail creation
  console.log('\nTest 14: Template with missing name fails creation');
  const t9 = await request('POST', '/templates', {
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text' }] }] },
  });
  assert(t9.status === 400, 'Template creation rejected without name: status=' + t9.status);

  // Test 15: Template missing type should fail creation
  console.log('\nTest 15: Template with missing type fails creation');
  const t10 = await request('POST', '/templates', {
    name: 'No Type 270',
    schema: { pages: [{ elements: [{ type: 'text' }] }] },
  });
  assert(t10.status === 400, 'Template creation rejected without type: status=' + t10.status);

  // Cleanup
  console.log('\nCleanup: archiving test templates');
  var ids = [templateId1, templateId2, templateId3, templateId4, templateId5, templateId6, templateId7];
  for (var i = 0; i < ids.length; i++) {
    if (ids[i]) await request('DELETE', '/templates/' + ids[i]);
  }

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
