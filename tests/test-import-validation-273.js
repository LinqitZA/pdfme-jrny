const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const JWT_TOKEN = createJwt({ sub: 'test-user-273', orgId: 'test-org-273', roles: ['template:admin'] });

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
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function rawRequest(method, path, rawBody, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Length': Buffer.byteLength(rawBody),
      },
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.write(rawBody);
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

async function run() {
  console.log('=== Feature #273: Template import JSON structure validation ===\n');

  // ---- GROUP 1: Invalid JSON / non-object bodies → 400 ----
  console.log('--- Group 1: Invalid JSON → 400 ---');

  // Test 1: Send invalid JSON string
  {
    const res = await rawRequest('POST', '/api/pdfme/templates/import', 'this is not json');
    assert(res.status === 400, `Invalid JSON string returns 400 (got ${res.status})`);
  }

  // Test 2: Send empty string
  {
    const res = await rawRequest('POST', '/api/pdfme/templates/import', '');
    assert(res.status === 400, `Empty body returns 400 (got ${res.status})`);
  }

  // Test 3: Send a JSON string (not object)
  {
    const res = await rawRequest('POST', '/api/pdfme/templates/import', '"just a string"');
    assert(res.status === 400, `JSON string value returns 400 (got ${res.status})`);
  }

  // Test 4: Send a JSON array
  {
    const res = await request('POST', '/api/pdfme/templates/import', [1, 2, 3]);
    assert(res.status === 400, `JSON array returns 400 (got ${res.status})`);
  }

  // Test 5: Send a JSON number
  {
    const res = await rawRequest('POST', '/api/pdfme/templates/import', '42');
    assert(res.status === 400, `JSON number returns 400 (got ${res.status})`);
  }

  // Test 6: Send null
  {
    const res = await rawRequest('POST', '/api/pdfme/templates/import', 'null');
    assert(res.status === 400, `JSON null returns 400 (got ${res.status})`);
  }

  // Test 7: Empty object (missing version and template)
  {
    const res = await request('POST', '/api/pdfme/templates/import', {});
    assert(res.status === 400, `Empty object returns 400 (got ${res.status})`);
    assert(res.body.details && res.body.details.length >= 2, `Error has details for missing fields (got ${JSON.stringify(res.body.details)})`);
  }

  // Test 8: Missing template field
  {
    const res = await request('POST', '/api/pdfme/templates/import', { version: 1 });
    assert(res.status === 400, `Missing template field returns 400 (got ${res.status})`);
    const hasTemplateError = res.body.details && res.body.details.some(d => d.field === 'template');
    assert(hasTemplateError, 'Error details mention missing template field');
  }

  // Test 9: Missing version field
  {
    const res = await request('POST', '/api/pdfme/templates/import', { template: { name: 'test', type: 'invoice', schema: {} } });
    assert(res.status === 400, `Missing version field returns 400 (got ${res.status})`);
    const hasVersionError = res.body.details && res.body.details.some(d => d.field === 'version');
    assert(hasVersionError, 'Error details mention missing version field');
  }

  // ---- GROUP 2: Valid JSON but wrong structure → 422 ----
  console.log('\n--- Group 2: Valid JSON, wrong structure → 422 ---');

  // Test 10: Wrong version number
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 2,
      template: { name: 'test', type: 'invoice', schema: {} },
    });
    assert(res.status === 422, `Wrong version returns 422 (got ${res.status})`);
    const hasVersionError = res.body.details && res.body.details.some(d => d.field === 'version');
    assert(hasVersionError, 'Error details mention unsupported version');
  }

  // Test 11: Template is not an object (string)
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: 'not an object',
    });
    assert(res.status === 422, `Template as string returns 422 (got ${res.status})`);
  }

  // Test 12: Template is an array
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: [1, 2, 3],
    });
    assert(res.status === 422, `Template as array returns 422 (got ${res.status})`);
  }

  // Test 13: Template missing name
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { type: 'invoice', schema: {} },
    });
    assert(res.status === 422, `Template missing name returns 422 (got ${res.status})`);
    const hasNameError = res.body.details && res.body.details.some(d => d.field === 'template.name');
    assert(hasNameError, 'Error details mention template.name');
  }

  // Test 14: Template missing type
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', schema: {} },
    });
    assert(res.status === 422, `Template missing type returns 422 (got ${res.status})`);
    const hasTypeError = res.body.details && res.body.details.some(d => d.field === 'template.type');
    assert(hasTypeError, 'Error details mention template.type');
  }

  // Test 15: Template missing schema
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice' },
    });
    assert(res.status === 422, `Template missing schema returns 422 (got ${res.status})`);
    const hasSchemaError = res.body.details && res.body.details.some(d => d.field === 'template.schema');
    assert(hasSchemaError, 'Error details mention template.schema');
  }

  // Test 16: Template with empty name
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: '', type: 'invoice', schema: {} },
    });
    assert(res.status === 422, `Template with empty name returns 422 (got ${res.status})`);
  }

  // Test 17: Template with empty type
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: '', schema: {} },
    });
    assert(res.status === 422, `Template with empty type returns 422 (got ${res.status})`);
  }

  // Test 18: Template schema is a string instead of object
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: 'not-an-object' },
    });
    assert(res.status === 422, `Template schema as string returns 422 (got ${res.status})`);
  }

  // Test 19: Template schema is an array
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: [1, 2] },
    });
    assert(res.status === 422, `Template schema as array returns 422 (got ${res.status})`);
  }

  // Test 20: Assets images is not an array
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: {} },
      assets: { images: 'not-array', fonts: [] },
    });
    assert(res.status === 422, `Assets images as string returns 422 (got ${res.status})`);
    const hasImagesError = res.body.details && res.body.details.some(d => d.field === 'assets.images');
    assert(hasImagesError, 'Error details mention assets.images');
  }

  // Test 21: Assets fonts is not an array
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: {} },
      assets: { images: [], fonts: 'not-array' },
    });
    assert(res.status === 422, `Assets fonts as string returns 422 (got ${res.status})`);
    const hasFontsError = res.body.details && res.body.details.some(d => d.field === 'assets.fonts');
    assert(hasFontsError, 'Error details mention assets.fonts');
  }

  // Test 22: Assets is a string
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: {} },
      assets: 'not-an-object',
    });
    assert(res.status === 422, `Assets as string returns 422 (got ${res.status})`);
  }

  // Test 23: Multiple structural errors at once
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 2,
      template: { schema: 'bad' },
    });
    assert(res.status === 422, `Multiple structural errors returns 422 (got ${res.status})`);
    assert(res.body.details && res.body.details.length >= 3, `Multiple errors reported (got ${res.body.details ? res.body.details.length : 0})`);
  }

  // ---- GROUP 3: Valid package → succeeds (201) ----
  console.log('\n--- Group 3: Valid package → 201 ---');

  // Test 24: Minimal valid package
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      exportedAt: new Date().toISOString(),
      template: {
        name: 'IMPORT_TEST_273_minimal',
        type: 'invoice',
        schema: { basePdf: 'BLANK_PDF', pages: [] },
        status: 'published',
        version: 1,
      },
      assets: { images: [], fonts: [] },
    });
    assert(res.status === 201, `Valid minimal package returns 201 (got ${res.status})`);
    assert(res.body.id, `Response has template id (got ${res.body.id})`);
    assert(res.body.status === 'draft', `Imported template is draft status (got ${res.body.status})`);
    assert(res.body.name === 'IMPORT_TEST_273_minimal', `Name preserved (got ${res.body.name})`);
  }

  // Test 25: Valid package without assets field (should default)
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: {
        name: 'IMPORT_TEST_273_no_assets',
        type: 'custom',
        schema: { pages: [{}] },
        status: 'draft',
        version: 1,
      },
    });
    assert(res.status === 201, `Valid package without assets returns 201 (got ${res.status})`);
    assert(res.body.name === 'IMPORT_TEST_273_no_assets', `Name preserved without assets (got ${res.body.name})`);
  }

  // Test 26: Valid package with empty assets
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      template: {
        name: 'IMPORT_TEST_273_empty_assets',
        type: 'statement',
        schema: {},
        status: 'published',
        version: 3,
      },
      assets: { images: [], fonts: [] },
    });
    assert(res.status === 201, `Valid package with empty assets returns 201 (got ${res.status})`);
    assert(res.body.type === 'statement', `Type preserved (got ${res.body.type})`);
  }

  // Test 27: No auth header → 401
  console.log('\n--- Group 4: Auth checks ---');
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: 'invoice', schema: {} },
    }, { 'Authorization': '' });
    assert(res.status === 401, `No auth returns 401 (got ${res.status})`);
  }

  // Test 28: Error response format has standard envelope
  console.log('\n--- Group 5: Error format ---');
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { type: 'invoice', schema: {} },
    });
    assert(res.body.statusCode === 422, `Error envelope has statusCode (got ${res.body.statusCode})`);
    assert(res.body.error === 'Unprocessable Entity', `Error envelope has error field (got ${res.body.error})`);
    assert(res.body.message, `Error envelope has message (got ${res.body.message})`);
    assert(Array.isArray(res.body.details), `Error envelope has details array (got ${typeof res.body.details})`);
  }

  // Test 29: Whitespace-only name
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: '   ', type: 'invoice', schema: {} },
    });
    assert(res.status === 422, `Whitespace-only name returns 422 (got ${res.status})`);
  }

  // Test 30: Whitespace-only type
  {
    const res = await request('POST', '/api/pdfme/templates/import', {
      version: 1,
      template: { name: 'test', type: '   ', schema: {} },
    });
    assert(res.status === 422, `Whitespace-only type returns 422 (got ${res.status})`);
  }

  // Cleanup - delete imported test templates
  console.log('\n--- Cleanup ---');
  const listRes = await request('GET', '/api/pdfme/templates?search=IMPORT_TEST_273&limit=10');
  if (listRes.body.data) {
    for (const tpl of listRes.body.data) {
      await request('DELETE', `/api/pdfme/templates/${tpl.id}`);
      console.log(`  Deleted test template: ${tpl.name}`);
    }
  }

  console.log(`\n=== Results: ${passed}/${passed + failed} passed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
