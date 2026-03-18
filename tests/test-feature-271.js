const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-271', 'test-org-271', ['admin']);

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
const cleanupIds = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function createTemplate(name, schema) {
  const res = await request('POST', '/templates', {
    name: name,
    type: 'invoice',
    schema: schema,
  });
  if (res.body.id) cleanupIds.push(res.body.id);
  return res;
}

async function run() {
  console.log('=== Feature #271: Page scope sanity validation ===\n');

  // Test 1: Element scoped to 'last' on single-page template
  console.log('Test 1: Element with pageScope "last" on single-page template');
  const t1 = await createTemplate('PageScope Last 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Footer',
        position: { x: 10, y: 280 },
        width: 100,
        height: 10,
        pageScope: 'last',
      }],
    }],
  });
  assert(t1.status === 201, 'Template created');

  const v1 = await request('POST', '/templates/' + t1.body.id + '/validate', {});
  console.log('  Validate response: ' + JSON.stringify(v1.body).substring(0, 300));
  assert(v1.status === 200, 'Validate returns 200: status=' + v1.status);
  assert(v1.body.valid === false, 'Template is not valid: valid=' + v1.body.valid);
  assert(Array.isArray(v1.body.errors) && v1.body.errors.length > 0, 'Has validation errors');
  if (v1.body.errors && v1.body.errors.length > 0) {
    const scopeError = v1.body.errors.find(function(e) { return e.message && e.message.toLowerCase().includes('scope'); });
    assert(scopeError !== undefined, 'Error mentions scope');
    if (scopeError) {
      assert(scopeError.message.includes('last'), 'Error mentions "last" scope: ' + scopeError.message);
      assert(scopeError.message.toLowerCase().includes('single-page') || scopeError.message.toLowerCase().includes('single page'), 'Error mentions single-page template');
    }
  }

  // Test 2: Publish also catches page scope issues
  console.log('\nTest 2: Publish also rejects invalid page scope');
  const p1 = await request('POST', '/templates/' + t1.body.id + '/publish', {});
  assert(p1.status === 422, 'Publish rejected: status=' + p1.status);

  // Test 3: Element scoped to 'notFirst' on single-page template (unreachable)
  console.log('\nTest 3: Element with pageScope "notFirst" on single-page template');
  const t2 = await createTemplate('PageScope NotFirst 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Continued...',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        pageScope: 'notFirst',
      }],
    }],
  });
  assert(t2.status === 201, 'Template created');

  const v2 = await request('POST', '/templates/' + t2.body.id + '/validate', {});
  console.log('  Validate response: ' + JSON.stringify(v2.body).substring(0, 300));
  assert(v2.body.valid === false, 'Template is not valid');
  if (v2.body.errors && v2.body.errors.length > 0) {
    const scopeError = v2.body.errors.find(function(e) { return e.message && e.message.toLowerCase().includes('unreachable'); });
    assert(scopeError !== undefined, 'Error mentions unreachable scope');
  }

  // Test 4: Element scoped to 'first' on single-page template (redundant)
  console.log('\nTest 4: Element with pageScope "first" on single-page template');
  const t3 = await createTemplate('PageScope First 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Header',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        pageScope: 'first',
      }],
    }],
  });
  assert(t3.status === 201, 'Template created');

  const v3 = await request('POST', '/templates/' + t3.body.id + '/validate', {});
  assert(v3.body.valid === false, 'Template is not valid (redundant scope)');
  if (v3.body.errors && v3.body.errors.length > 0) {
    const scopeError = v3.body.errors.find(function(e) { return e.message && e.message.toLowerCase().includes('redundant'); });
    assert(scopeError !== undefined, 'Error mentions redundant scope');
  }

  // Test 5: Invalid page scope value
  console.log('\nTest 5: Invalid page scope value');
  const t4 = await createTemplate('PageScope Invalid 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Test',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        pageScope: 'middle',
      }],
    }],
  });
  assert(t4.status === 201, 'Template created');

  const v4 = await request('POST', '/templates/' + t4.body.id + '/validate', {});
  assert(v4.body.valid === false, 'Template is not valid (invalid scope)');
  if (v4.body.errors && v4.body.errors.length > 0) {
    const scopeError = v4.body.errors.find(function(e) { return e.message && e.message.includes('middle'); });
    assert(scopeError !== undefined, 'Error mentions the invalid scope value "middle"');
  }

  // Test 6: pageScope 'all' on single-page template is fine
  console.log('\nTest 6: Element with pageScope "all" on single-page template (valid)');
  const t5 = await createTemplate('PageScope All 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Normal content',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        pageScope: 'all',
      }],
    }],
  });
  assert(t5.status === 201, 'Template created');

  const v5 = await request('POST', '/templates/' + t5.body.id + '/validate', {});
  assert(v5.body.valid === true, 'Template is valid with pageScope "all": valid=' + v5.body.valid);

  // Test 7: No pageScope (default) is fine
  console.log('\nTest 7: No pageScope specified (default) is valid');
  const t6 = await createTemplate('No PageScope 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Normal content',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
      }],
    }],
  });
  assert(t6.status === 201, 'Template created');

  const v6 = await request('POST', '/templates/' + t6.body.id + '/validate', {});
  assert(v6.body.valid === true, 'Template is valid without pageScope: valid=' + v6.body.valid);

  // Test 8: Multi-page template with 'last' scope is OK
  console.log('\nTest 8: Multi-page template with "last" scope is valid');
  const t7 = await createTemplate('MultiPage Last 271', {
    pages: [
      { elements: [{ type: 'text', content: 'Page 1', position: { x: 10, y: 10 }, width: 100, height: 10 }] },
      { elements: [{ type: 'text', content: 'Footer', position: { x: 10, y: 280 }, width: 100, height: 10, pageScope: 'last' }] },
    ],
  });
  assert(t7.status === 201, 'Template created');

  const v7 = await request('POST', '/templates/' + t7.body.id + '/validate', {});
  assert(v7.body.valid === true, 'Multi-page with "last" is valid: valid=' + v7.body.valid);

  // Test 9: Multi-page template with 'notFirst' scope is OK
  console.log('\nTest 9: Multi-page template with "notFirst" scope is valid');
  const t8 = await createTemplate('MultiPage NotFirst 271', {
    pages: [
      { elements: [{ type: 'text', content: 'Page 1', position: { x: 10, y: 10 }, width: 100, height: 10 }] },
      { elements: [{ type: 'text', content: 'Continued...', position: { x: 10, y: 10 }, width: 100, height: 10, pageScope: 'notFirst' }] },
    ],
  });
  assert(t8.status === 201, 'Template created');

  const v8 = await request('POST', '/templates/' + t8.body.id + '/validate', {});
  assert(v8.body.valid === true, 'Multi-page with "notFirst" is valid: valid=' + v8.body.valid);

  // Test 10: Validate endpoint returns useful message structure
  console.log('\nTest 10: Validate response structure');
  assert(typeof v1.body.templateId === 'string', 'Response has templateId');
  assert(typeof v1.body.templateName === 'string', 'Response has templateName');
  assert(typeof v1.body.valid === 'boolean', 'Response has boolean valid field');
  assert(Array.isArray(v1.body.errors), 'Response has errors array');
  if (v1.body.errors && v1.body.errors.length > 0) {
    assert(typeof v1.body.errors[0].field === 'string', 'Error has field property');
    assert(typeof v1.body.errors[0].message === 'string', 'Error has message property');
  }

  // Test 11: Validate on nonexistent template returns 404
  console.log('\nTest 11: Validate nonexistent template');
  const v9 = await request('POST', '/templates/nonexistent-id/validate', {});
  assert(v9.status === 404, 'Returns 404 for nonexistent template: status=' + v9.status);

  // Test 12: page_scope variant (underscore)
  console.log('\nTest 12: page_scope (underscore variant) also validated');
  const t9 = await createTemplate('PageScope Underscore 271', {
    pages: [{
      elements: [{
        type: 'text',
        content: 'Test',
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        page_scope: 'not_first',
      }],
    }],
  });
  assert(t9.status === 201, 'Template created');

  const v10 = await request('POST', '/templates/' + t9.body.id + '/validate', {});
  assert(v10.body.valid === false, 'Underscore variant also caught: valid=' + v10.body.valid);

  // Cleanup
  console.log('\nCleanup: archiving test templates');
  for (var i = 0; i < cleanupIds.length; i++) {
    await request('DELETE', '/templates/' + cleanupIds[i]);
  }

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
