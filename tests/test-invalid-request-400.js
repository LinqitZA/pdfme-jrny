/**
 * Tests for Feature #158: API returns 400 for invalid request body
 *
 * Verifies that malformed request bodies produce 400 errors with clear messages.
 */

const http = require('http');

const BASE_URL = process.env.API_BASE || 'http://localhost:3001';
let PASS = 0;
let FAIL = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-400-test', 'org-400-test', [
  'template:edit', 'template:publish', 'render:trigger', 'render:bulk'
]);

function assert(desc, condition) {
  if (condition) {
    PASS++;
    console.log('  PASS:', desc);
  } else {
    FAIL++;
    console.log('  FAIL:', desc);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const data = body !== undefined ? JSON.stringify(body) : '';
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Feature #158: API returns 400 for invalid request body ===\n');

  // --- Template endpoint validation ---
  console.log('--- Template Creation Validation ---\n');

  // Test 1: POST template with empty body
  console.log('Test 1: POST template with empty body');
  {
    const res = await request('POST', '/api/pdfme/templates', {});
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Has error field`, typeof res.body === 'object' && res.body.error === 'Bad Request');
    assert(`Has message field`, typeof res.body === 'object' && typeof res.body.message === 'string');
    assert(`Has details array`, typeof res.body === 'object' && Array.isArray(res.body.details));
    if (Array.isArray(res.body.details)) {
      assert(`Details lists missing fields (${res.body.details.length} fields)`, res.body.details.length >= 3);
    }
  }

  // Test 2: POST template with missing name
  console.log('\nTest 2: POST template with missing name');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      type: 'invoice',
      schema: { basePdf: {}, schemas: [[]] },
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Message mentions required fields`, res.body.message && res.body.message.includes('required'));
    assert(`Details includes name`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'name'));
  }

  // Test 3: POST template with missing type
  console.log('\nTest 3: POST template with missing type');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      name: 'Test',
      schema: { basePdf: {}, schemas: [[]] },
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Details includes type`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'type'));
  }

  // Test 4: POST template with missing schema
  console.log('\nTest 4: POST template with missing schema');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      name: 'Test',
      type: 'invoice',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Details includes schema`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'schema'));
  }

  // Test 5: POST template with schema as array (invalid)
  console.log('\nTest 5: POST template with schema as array (invalid type)');
  {
    const res = await request('POST', '/api/pdfme/templates', {
      name: 'Test',
      type: 'invoice',
      schema: [1, 2, 3],
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Message mentions JSON object`, res.body.message && res.body.message.includes('JSON object'));
  }

  // --- Render endpoint validation ---
  console.log('\n--- Render Endpoint Validation ---\n');

  // Test 6: POST render/now with empty body
  console.log('Test 6: POST render/now with empty body');
  {
    const res = await request('POST', '/api/pdfme/render/now', {});
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Has error envelope`, typeof res.body === 'object' && res.body.error === 'Bad Request');
    assert(`Has details array`, Array.isArray(res.body.details));
  }

  // Test 7: POST render/now with missing templateId
  console.log('\nTest 7: POST render/now with missing templateId');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      entityId: 'ent-1',
      channel: 'print',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Details includes templateId`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'templateId'));
  }

  // Test 8: POST render/now with missing entityId
  console.log('\nTest 8: POST render/now with missing entityId');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      templateId: 'tmpl-1',
      channel: 'print',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Details includes entityId`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'entityId'));
  }

  // Test 9: POST render/now with missing channel
  console.log('\nTest 9: POST render/now with missing channel');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      templateId: 'tmpl-1',
      entityId: 'ent-1',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Details includes channel`, Array.isArray(res.body.details) &&
           res.body.details.some(d => d.field === 'channel'));
  }

  // Test 10: POST render/now with invalid templateId format (empty string after trim)
  console.log('\nTest 10: POST render/now with empty string templateId');
  {
    const res = await request('POST', '/api/pdfme/render/now', {
      templateId: '   ',
      entityId: 'ent-1',
      channel: 'print',
    });
    // Could be 400 (caught by either missing check or format check)
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Message is clear`, res.body.message && (
      res.body.message.includes('required') || res.body.message.includes('non-empty')
    ));
  }

  // --- Bulk render validation ---
  console.log('\n--- Bulk Render Validation ---\n');

  // Test 11: POST render/bulk with empty body
  console.log('Test 11: POST render/bulk with empty body');
  {
    const res = await request('POST', '/api/pdfme/render/bulk', {});
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
    assert(`Has details`, Array.isArray(res.body.details));
  }

  // Test 12: POST render/bulk with empty entityIds array
  console.log('\nTest 12: POST render/bulk with empty entityIds array');
  {
    const res = await request('POST', '/api/pdfme/render/bulk', {
      templateId: 'tmpl-1',
      entityIds: [],
      channel: 'print',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
  }

  // Test 13: POST render/bulk with entityIds not an array
  console.log('\nTest 13: POST render/bulk with entityIds as string');
  {
    const res = await request('POST', '/api/pdfme/render/bulk', {
      templateId: 'tmpl-1',
      entityIds: 'not-an-array',
      channel: 'print',
    });
    assert(`Returns 400 (got ${res.status})`, res.status === 400);
  }

  // --- Verify error envelope format ---
  console.log('\n--- Error Envelope Format ---\n');

  // Test 14: Error envelope has correct structure
  console.log('Test 14: Error envelope has statusCode, error, message, details');
  {
    const res = await request('POST', '/api/pdfme/templates', {});
    assert(`statusCode is 400`, res.body.statusCode === 400);
    assert(`error is "Bad Request"`, res.body.error === 'Bad Request');
    assert(`message is a non-empty string`, typeof res.body.message === 'string' && res.body.message.length > 0);
    assert(`details is an array`, Array.isArray(res.body.details));
    if (Array.isArray(res.body.details) && res.body.details.length > 0) {
      const detail = res.body.details[0];
      assert(`Detail has field property`, typeof detail.field === 'string');
      assert(`Detail has reason property`, typeof detail.reason === 'string');
    }
  }

  // --- Summary ---
  console.log(`\n========================================`);
  console.log(`Results: ${PASS} passed, ${FAIL} failed out of ${PASS + FAIL} tests`);
  console.log(`========================================\n`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
