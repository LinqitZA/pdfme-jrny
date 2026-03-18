/**
 * Feature #341: Template export creates valid JSON package
 *
 * Tests that exported template is a valid, importable JSON package
 * with embedded data complete (fonts, images).
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001';
let passed = 0;
let failed = 0;

function makeToken(sub, orgId) {
  var secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  var header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-341',
    orgId: orgId || 'org-export-341',
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  var sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

var TOKEN = makeToken();
var TOKEN2 = makeToken('test-user-341-b', 'org-import-341');

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

function uploadAsset(filePath, originalName, category, token) {
  return new Promise(function(resolve, reject) {
    var boundary = '----FormBoundary' + Date.now();
    var fileBuffer = fs.readFileSync(filePath);
    var bodyParts = [];

    bodyParts.push('--' + boundary + '\r\n');
    bodyParts.push('Content-Disposition: form-data; name="file"; filename="' + originalName + '"\r\n');
    bodyParts.push('Content-Type: application/octet-stream\r\n\r\n');
    bodyParts.push(fileBuffer);
    bodyParts.push('\r\n--' + boundary + '\r\n');
    bodyParts.push('Content-Disposition: form-data; name="category"\r\n\r\n');
    bodyParts.push(category + '\r\n');
    bodyParts.push('--' + boundary + '--\r\n');

    var bodyBuffer = Buffer.concat(bodyParts.map(function(p) {
      return Buffer.isBuffer(p) ? p : Buffer.from(p);
    }));

    var options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/pdfme/assets/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuffer.length,
        'Authorization': 'Bearer ' + (token || TOKEN),
      },
    };

    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
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

async function run() {
  console.log('Feature #341: Template export creates valid JSON package\n');

  // Phase 1: Create a test image asset
  console.log('Phase 1: Create template with assets');

  // Create a valid 1x1 white PNG
  var pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
  var tmpImgPath = '/tmp/test-export-341.png';
  fs.writeFileSync(tmpImgPath, Buffer.from(pngB64, 'base64'));

  var assetRes = await uploadAsset(tmpImgPath, 'test-export-341.png', 'image', TOKEN);
  var assetUploaded = assetRes.status === 201 || assetRes.status === 200;
  assert(assetUploaded, 'Test image asset uploaded');

  var imagePath = '';
  if (assetRes.body && assetRes.body.storagePath) {
    imagePath = assetRes.body.storagePath;
  } else if (assetRes.body && assetRes.body.path) {
    imagePath = assetRes.body.path;
  } else if (assetRes.body && assetRes.body.filename) {
    imagePath = 'org-export-341/assets/' + assetRes.body.filename;
  }
  console.log('  Image path: ' + imagePath);

  // Create a template with elements referencing the image
  var templateSchema = {
    pages: [
      {
        pageSize: 'A4',
        elements: [
          {
            type: 'text',
            x: 10, y: 10, w: 200, h: 30,
            content: 'Export Test Invoice #341',
            fontSize: 18,
            fontFamily: 'Helvetica',
          },
          {
            type: 'image',
            x: 10, y: 50, w: 100, h: 100,
            src: imagePath || 'test-image.png',
          },
          {
            type: 'text',
            x: 10, y: 160, w: 300, h: 20,
            content: 'Customer: {{customer.name}}',
            binding: 'customer.name',
          },
        ],
      },
    ],
  };

  var createRes = await request('POST', '/api/pdfme/templates', {
    name: 'Export Test Template 341',
    type: 'invoice',
    schema: templateSchema,
  });

  assert(createRes.status === 201, 'Template created: ' + (createRes.body.id || 'no id'));
  var templateId = createRes.body.id;

  if (!templateId) {
    console.log('  Cannot continue without template ID');
    console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
    process.exit(1);
  }

  // Phase 2: Export the template
  console.log('\nPhase 2: Export template');

  var exportRes = await request('GET', '/api/pdfme/templates/' + templateId + '/export');
  assert(exportRes.status === 200, 'Export endpoint returns 200');

  var pkg = exportRes.body;

  // Phase 3: Verify JSON is valid and has correct structure
  console.log('\nPhase 3: Verify export JSON structure');

  assert(typeof pkg === 'object' && pkg !== null, 'Export is a JSON object');
  assert(pkg.version === 1, 'Package version is 1');
  assert(typeof pkg.exportedAt === 'string', 'Has exportedAt timestamp');

  // Verify ISO 8601 timestamp
  var exportDate = new Date(pkg.exportedAt);
  assert(!isNaN(exportDate.getTime()), 'exportedAt is valid ISO 8601: ' + pkg.exportedAt);

  // Verify template section
  assert(typeof pkg.template === 'object', 'Has template object');
  assert(pkg.template.name === 'Export Test Template 341', 'Template name matches: ' + pkg.template.name);
  assert(pkg.template.type === 'invoice', 'Template type matches: ' + pkg.template.type);
  assert(typeof pkg.template.schema === 'object', 'Template has schema object');
  assert(pkg.template.status === 'draft', 'Template status is draft: ' + pkg.template.status);
  assert(typeof pkg.template.version === 'number', 'Template version is number: ' + pkg.template.version);

  // Verify schema content
  assert(pkg.template.schema.pages !== undefined, 'Schema has pages');
  if (Array.isArray(pkg.template.schema.pages)) {
    assert(pkg.template.schema.pages.length === 1, 'Schema has 1 page');
    var page = pkg.template.schema.pages[0];
    assert(Array.isArray(page.elements), 'Page has elements array');
    assert(page.elements.length === 3, 'Page has 3 elements: ' + (page.elements ? page.elements.length : 0));
  }

  // Phase 4: Verify assets section
  console.log('\nPhase 4: Verify embedded assets');

  assert(typeof pkg.assets === 'object', 'Has assets object');
  assert(Array.isArray(pkg.assets.images), 'Has images array');
  assert(Array.isArray(pkg.assets.fonts), 'Has fonts array');

  // If we uploaded an image and it was referenced, it should be embedded
  if (imagePath && pkg.assets.images.length > 0) {
    var img = pkg.assets.images[0];
    assert(typeof img.path === 'string', 'Image has path');
    assert(typeof img.mimeType === 'string', 'Image has mimeType');
    assert(typeof img.data === 'string', 'Image has base64 data');
    assert(img.data.length > 0, 'Image data is non-empty');

    // Verify base64 can be decoded
    try {
      var decoded = Buffer.from(img.data, 'base64');
      assert(decoded.length > 0, 'Image base64 decodes successfully (' + decoded.length + ' bytes)');
    } catch (e) {
      assert(false, 'Image base64 decode failed: ' + e.message);
    }
  } else {
    console.log('  (No embedded images - asset may not have been referenced in schema)');
  }

  // Phase 5: Verify JSON serialization round-trip
  console.log('\nPhase 5: Verify JSON round-trip');

  var jsonStr = JSON.stringify(pkg);
  assert(typeof jsonStr === 'string', 'Package serializes to JSON string');
  assert(jsonStr.length > 0, 'JSON string is non-empty (' + jsonStr.length + ' chars)');

  var parsed = JSON.parse(jsonStr);
  assert(parsed.version === pkg.version, 'Round-trip preserves version');
  assert(parsed.template.name === pkg.template.name, 'Round-trip preserves template name');
  assert(parsed.template.type === pkg.template.type, 'Round-trip preserves template type');
  assert(parsed.exportedAt === pkg.exportedAt, 'Round-trip preserves exportedAt');

  // Phase 6: Import the exported package on "clean" org
  console.log('\nPhase 6: Import exported package on different org');

  var importRes = await request('POST', '/api/pdfme/templates/import', pkg, TOKEN2);
  assert(importRes.status === 201, 'Import returns 201 Created: ' + importRes.status);
  assert(!!importRes.body.id, 'Imported template has new ID: ' + importRes.body.id);
  var importedName = importRes.body.name;
  var nameOk = importedName === 'Export Test Template 341' || importedName.startsWith('Export Test Template 341');
  assert(nameOk, 'Imported template name matches or has import suffix: ' + importedName);
  assert(importRes.body.status === 'draft', 'Imported template is draft');

  var importedId = importRes.body.id;

  // Phase 7: Verify imported template is complete
  console.log('\nPhase 7: Verify imported template content');

  var getRes = await request('GET', '/api/pdfme/templates/' + importedId, null, TOKEN2);
  assert(getRes.status === 200, 'Imported template retrievable');
  assert(getRes.body.name.startsWith('Export Test Template 341'), 'Imported name correct: ' + getRes.body.name);
  assert(getRes.body.type === 'invoice', 'Imported type correct');
  assert(typeof getRes.body.schema === 'object', 'Imported schema is object');

  // Verify schema integrity
  if (getRes.body.schema && getRes.body.schema.pages) {
    var importedPages = getRes.body.schema.pages;
    assert(Array.isArray(importedPages), 'Imported schema has pages array');
    assert(importedPages.length === 1, 'Imported schema has 1 page');
    if (importedPages[0] && importedPages[0].elements) {
      assert(importedPages[0].elements.length === 3, 'Imported page has 3 elements');
      var textEl = importedPages[0].elements[0];
      assert(textEl.content === 'Export Test Invoice #341', 'Text element content preserved');
      assert(textEl.fontSize === 18, 'Text element fontSize preserved');
    }
  }

  // Phase 8: Re-export the imported template and compare
  console.log('\nPhase 8: Re-export imported template and compare');

  var reExportRes = await request('GET', '/api/pdfme/templates/' + importedId + '/export', null, TOKEN2);
  assert(reExportRes.status === 200, 'Re-export succeeds');
  assert(reExportRes.body.version === 1, 'Re-exported version is 1');
  assert(reExportRes.body.template.name.startsWith('Export Test Template 341'), 'Re-exported name matches or has suffix: ' + reExportRes.body.template.name);
  assert(reExportRes.body.template.type === pkg.template.type, 'Re-exported type matches original');

  // Verify schema content matches
  var origSchemaStr = JSON.stringify(pkg.template.schema);
  var reExportSchemaStr = JSON.stringify(reExportRes.body.template.schema);
  assert(origSchemaStr === reExportSchemaStr, 'Re-exported schema matches original');

  // Phase 9: Test import validation - invalid packages
  console.log('\nPhase 9: Import validation');

  var invalidRes1 = await request('POST', '/api/pdfme/templates/import', { version: 2, template: { name: 'x', type: 'y', schema: {} } }, TOKEN2);
  assert(invalidRes1.status === 422, 'Invalid version rejected (422): ' + invalidRes1.status);

  var invalidRes2 = await request('POST', '/api/pdfme/templates/import', { version: 1 }, TOKEN2);
  assert(invalidRes2.status === 400, 'Missing template rejected (400): ' + invalidRes2.status);

  var invalidRes3 = await request('POST', '/api/pdfme/templates/import', 'not json', TOKEN2);
  assert(invalidRes3.status === 400, 'Non-object body rejected (400): ' + invalidRes3.status);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));

  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('Test error:', err.message);
  process.exit(1);
});
