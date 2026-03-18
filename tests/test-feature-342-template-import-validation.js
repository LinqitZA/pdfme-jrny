/**
 * Feature #342: Template import validates against current system
 *
 * Tests that import checks compatibility with current version,
 * handles unknown fields gracefully, and provides clear errors.
 */

var http = require('http');
var crypto = require('crypto');

var BASE = process.env.API_BASE || 'http://localhost:3001';
var passed = 0;
var failed = 0;

function makeToken(sub, orgId) {
  var secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  var header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-342',
    orgId: orgId || 'org-import-342',
    roles: ['template_admin', 'template:edit', 'template:publish'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  var sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

var TOKEN = makeToken();

function request(method, urlPath, body, token) {
  return new Promise(function(resolve, reject) {
    var url = new URL(urlPath, BASE);
    var options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || TOKEN),
      },
      timeout: 15000,
    };
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

function validPackage(overrides) {
  var base = {
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      name: 'Import Test ' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          pageSize: 'A4',
          elements: [{ type: 'text', x: 10, y: 10, w: 200, h: 30, content: 'Test' }],
        }],
      },
      status: 'draft',
      version: 1,
    },
    assets: { images: [], fonts: [] },
  };
  if (overrides) {
    Object.keys(overrides).forEach(function(k) {
      base[k] = overrides[k];
    });
  }
  return base;
}

async function run() {
  console.log('Feature #342: Template import validates against current system\n');

  // === Test 1: Import valid package - succeeds ===
  console.log('Test 1: Import valid package - succeeds');

  var validPkg = validPackage();
  var res1 = await request('POST', '/api/pdfme/templates/import', validPkg);
  assert(res1.status === 201, 'Valid package import returns 201: ' + res1.status);
  assert(!!res1.body.id, 'Returns new template ID');
  assert(res1.body.status === 'draft', 'Imported as draft');
  assert(res1.body.type === 'invoice', 'Type preserved');
  assert(typeof res1.body.createdAt !== 'undefined', 'Has createdAt');
  assert(typeof res1.body.version === 'number', 'Has version number');

  // Verify the template is retrievable
  var getRes = await request('GET', '/api/pdfme/templates/' + res1.body.id);
  assert(getRes.status === 200, 'Imported template retrievable by ID');
  assert(getRes.body.type === 'invoice', 'Retrieved template type correct');

  // === Test 2: Import with unknown schema fields - handled gracefully ===
  console.log('\nTest 2: Import with unknown schema fields - handled gracefully');

  var unknownFieldsPkg = validPackage({
    template: {
      name: 'Unknown Fields Test ' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          pageSize: 'A4',
          elements: [
            {
              type: 'text', x: 10, y: 10, w: 200, h: 30, content: 'Test',
              unknownField1: 'should not break import',
              futureFeature: { nested: true, data: [1, 2, 3] },
              customProperty: 42,
            }
          ],
          unknownPageProp: 'future page setting',
        }],
        globalSettings: { unknownSetting: true },
        futureConfig: 'new feature data',
      },
      status: 'published',
      version: 2,
    },
  });

  var res2 = await request('POST', '/api/pdfme/templates/import', unknownFieldsPkg);
  assert(res2.status === 201, 'Package with unknown fields imports OK: ' + res2.status);
  assert(!!res2.body.id, 'Returns ID for unknown-fields package');

  // Verify the unknown fields are preserved in schema
  var getRes2 = await request('GET', '/api/pdfme/templates/' + res2.body.id);
  assert(getRes2.status === 200, 'Template with unknown fields retrievable');
  var schema2 = getRes2.body.schema;
  assert(schema2.futureConfig === 'new feature data', 'Unknown top-level schema field preserved');
  if (schema2.pages && schema2.pages[0]) {
    assert(schema2.pages[0].unknownPageProp === 'future page setting', 'Unknown page prop preserved');
    if (schema2.pages[0].elements && schema2.pages[0].elements[0]) {
      assert(schema2.pages[0].elements[0].unknownField1 === 'should not break import', 'Unknown element field preserved');
      assert(schema2.pages[0].elements[0].customProperty === 42, 'Unknown element numeric field preserved');
    }
  }

  // === Test 3: Import with extra top-level fields ===
  console.log('\nTest 3: Import with extra top-level fields - graceful');

  var extraTopLevelPkg = validPackage();
  extraTopLevelPkg.metadata = { exportedFrom: 'v2.0', platform: 'desktop' };
  extraTopLevelPkg.checksum = 'abc123';
  var res3 = await request('POST', '/api/pdfme/templates/import', extraTopLevelPkg);
  assert(res3.status === 201, 'Package with extra top-level fields imports OK: ' + res3.status);

  // === Test 4: Missing required data - clear errors ===
  console.log('\nTest 4: Missing required data - clear errors');

  // 4a: Missing template entirely
  var res4a = await request('POST', '/api/pdfme/templates/import', { version: 1 });
  assert(res4a.status === 400, 'Missing template returns 400: ' + res4a.status);
  assert(res4a.body.details && res4a.body.details.length > 0, 'Error has details array');
  var hasTemplateError = res4a.body.details.some(function(d) { return d.field === 'template'; });
  assert(hasTemplateError, 'Error details mention template field');

  // 4b: Missing version
  var res4b = await request('POST', '/api/pdfme/templates/import', {
    template: { name: 'x', type: 'y', schema: {} },
  });
  assert(res4b.status === 400, 'Missing version returns 400: ' + res4b.status);
  var hasVersionError = res4b.body.details && res4b.body.details.some(function(d) { return d.field === 'version'; });
  assert(hasVersionError, 'Error details mention version field');

  // 4c: Missing template.name
  var res4c = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { type: 'invoice', schema: {} },
  });
  assert(res4c.status === 422, 'Missing template.name returns 422: ' + res4c.status);
  var hasNameError = res4c.body.details && res4c.body.details.some(function(d) { return d.field === 'template.name'; });
  assert(hasNameError, 'Error details mention template.name');

  // 4d: Missing template.type
  var res4d = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', schema: {} },
  });
  assert(res4d.status === 422, 'Missing template.type returns 422: ' + res4d.status);
  var hasTypeError = res4d.body.details && res4d.body.details.some(function(d) { return d.field === 'template.type'; });
  assert(hasTypeError, 'Error details mention template.type');

  // 4e: Missing template.schema
  var res4e = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', type: 'invoice' },
  });
  assert(res4e.status === 422, 'Missing template.schema returns 422: ' + res4e.status);
  var hasSchemaError = res4e.body.details && res4e.body.details.some(function(d) { return d.field === 'template.schema'; });
  assert(hasSchemaError, 'Error details mention template.schema');

  // === Test 5: Wrong version number ===
  console.log('\nTest 5: Unsupported version number');

  var res5a = await request('POST', '/api/pdfme/templates/import', {
    version: 2,
    template: { name: 'Test', type: 'invoice', schema: {} },
  });
  assert(res5a.status === 422, 'Version 2 rejected with 422: ' + res5a.status);
  var hasVersionDetailError = res5a.body.details && res5a.body.details.some(function(d) {
    return d.field === 'version' && d.reason.includes('Unsupported');
  });
  assert(hasVersionDetailError, 'Error mentions unsupported version');

  var res5b = await request('POST', '/api/pdfme/templates/import', {
    version: 0,
    template: { name: 'Test', type: 'invoice', schema: {} },
  });
  assert(res5b.status === 422, 'Version 0 rejected with 422: ' + res5b.status);

  // === Test 6: Invalid data types ===
  console.log('\nTest 6: Invalid data types');

  // 6a: template is a string
  var res6a = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: 'not an object',
  });
  assert(res6a.status === 422, 'String template rejected: ' + res6a.status);

  // 6b: template is an array
  var res6b = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: [{ name: 'x', type: 'y', schema: {} }],
  });
  assert(res6b.status === 422, 'Array template rejected: ' + res6b.status);

  // 6c: schema is a string
  var res6c = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', type: 'invoice', schema: 'not an object' },
  });
  assert(res6c.status === 422, 'String schema rejected: ' + res6c.status);

  // 6d: assets.images is not an array
  var res6d = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', type: 'invoice', schema: {} },
    assets: { images: 'not an array' },
  });
  assert(res6d.status === 422, 'Non-array images rejected: ' + res6d.status);

  // 6e: assets.fonts is not an array
  var res6e = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', type: 'invoice', schema: {} },
    assets: { fonts: 123 },
  });
  assert(res6e.status === 422, 'Non-array fonts rejected: ' + res6e.status);

  // === Test 7: Non-JSON body ===
  console.log('\nTest 7: Non-JSON body');

  var res7 = await request('POST', '/api/pdfme/templates/import', 'just a string');
  assert(res7.status === 400, 'String body rejected: ' + res7.status);

  // === Test 8: Empty body ===
  console.log('\nTest 8: Edge cases');

  var res8a = await request('POST', '/api/pdfme/templates/import', null);
  assert(res8a.status === 400 || res8a.status === 422, 'Null body handled: ' + res8a.status);

  // Empty object
  var res8b = await request('POST', '/api/pdfme/templates/import', {});
  assert(res8b.status === 400, 'Empty object returns 400: ' + res8b.status);

  // Empty template name
  var res8c = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: '', type: 'invoice', schema: {} },
  });
  assert(res8c.status === 422, 'Empty template name rejected: ' + res8c.status);

  // Empty template type
  var res8d = await request('POST', '/api/pdfme/templates/import', {
    version: 1,
    template: { name: 'Test', type: '', schema: {} },
  });
  assert(res8d.status === 422, 'Empty template type rejected: ' + res8d.status);

  // === Test 9: Auth required ===
  console.log('\nTest 9: Auth required');

  var res9 = await request('POST', '/api/pdfme/templates/import', validPackage(), 'invalid-token');
  assert(res9.status === 401, 'Invalid token returns 401: ' + res9.status);

  // === Test 10: Valid package with assets ===
  console.log('\nTest 10: Valid package with assets (base64 data)');

  var assetPkg = validPackage({
    template: {
      name: 'Asset Import Test ' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          pageSize: 'A4',
          elements: [
            { type: 'image', x: 10, y: 10, w: 100, h: 100, src: 'org-source/assets/logo.png' },
          ],
        }],
      },
      status: 'draft',
      version: 1,
    },
    assets: {
      images: [{
        path: 'org-source/assets/logo.png',
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
      }],
      fonts: [],
    },
  });

  var res10 = await request('POST', '/api/pdfme/templates/import', assetPkg);
  assert(res10.status === 201, 'Package with assets imports: ' + res10.status);
  assert(!!res10.body.id, 'Returns ID');

  // Check assets extraction info if available
  if (res10.body.assetsExtracted) {
    assert(res10.body.assetsExtracted.images >= 0, 'Reports extracted images count');
  }

  // Verify template schema preserved
  var getRes10 = await request('GET', '/api/pdfme/templates/' + res10.body.id);
  assert(getRes10.status === 200, 'Template with assets retrievable');
  assert(getRes10.body.schema.pages[0].elements[0].type === 'image', 'Image element preserved');

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));

  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('Test error:', err.message);
  process.exit(1);
});
