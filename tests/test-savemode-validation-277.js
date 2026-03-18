/**
 * Test Feature #277: SaveMode parameter validated
 * SaveMode must be inPlace or newVersion
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = 'pdfme-dev-secret';

function makeJwt(payload) {
  var h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  var sig = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}

var JWT = makeJwt({ sub: 'test-user-277', orgId: 'org-test-277', roles: ['admin'] });

function request(method, path, body) {
  return new Promise(function(resolve, reject) {
    var url = new URL(path, BASE);
    var postData = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + JWT,
      },
    };
    if (postData) opts.headers['Content-Length'] = Buffer.byteLength(postData);
    var req = http.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        var parsed;
        try { parsed = JSON.parse(data); } catch(e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

var passed = 0;
var failed = 0;

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + name);
  } else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}

async function run() {
  console.log('Feature #277: SaveMode parameter validated\n');

  // Create a template (draft status initially)
  var createRes = await request('POST', BASE + '/templates', {
    name: 'SaveMode Test 277',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    orgId: 'org-test-277',
  });
  var templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + ' status: ' + createRes.status);

  // Publish it so we can test saveMode on a published template
  var pubRes = await request('POST', BASE + '/templates/' + templateId + '/publish');
  console.log('  Publish status: ' + pubRes.status);

  // --- Test: saveMode=invalid -> 400 ---
  console.log('\n--- saveMode validation on PUT draft ---');
  var r1 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'invalid',
  });
  assert('saveMode=invalid returns 400', r1.status === 400);
  assert('Error mentions invalid', typeof r1.body.message === 'string' && r1.body.message.indexOf('invalid') >= 0);
  assert('Lists inPlace and newVersion', typeof r1.body.message === 'string' && r1.body.message.indexOf('inPlace') >= 0 && r1.body.message.indexOf('newVersion') >= 0);
  assert('Details has saveMode field', Array.isArray(r1.body.details) && r1.body.details.some(function(d) { return d.field === 'saveMode'; }));

  // --- Test: saveMode=overwrite -> 400 ---
  var r2 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'overwrite',
  });
  assert('saveMode=overwrite returns 400', r2.status === 400);

  // --- Test: saveMode=INPLACE (case sensitive) -> 400 ---
  var r3 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'INPLACE',
  });
  assert('saveMode=INPLACE returns 400 (case-sensitive)', r3.status === 400);

  // --- Test: saveMode=InPlace (mixed case) -> 400 ---
  var r3b = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'InPlace',
  });
  assert('saveMode=InPlace returns 400 (case-sensitive)', r3b.status === 400);

  // --- Test: saveMode=inPlace succeeds ---
  var r4 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'inPlace',
  });
  assert('saveMode=inPlace does NOT return 400', r4.status !== 400);
  assert('saveMode=inPlace returns 200', r4.status === 200);

  // --- Test: saveMode=newVersion succeeds ---
  var r5 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: 'newVersion',
  });
  assert('saveMode=newVersion does NOT return 400', r5.status !== 400);
  assert('saveMode=newVersion returns 200', r5.status === 200);

  // --- Test: no saveMode (omitted) succeeds ---
  var r6 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'updated', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
  });
  assert('No saveMode (omitted) does NOT return 400', r6.status !== 400);
  assert('No saveMode returns 200', r6.status === 200);

  // --- Test: saveMode=null succeeds (treated as omitted) ---
  var r7 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: null,
  });
  assert('saveMode=null does NOT return 400', r7.status !== 400);

  // --- Test: saveMode empty string succeeds (treated as omitted) ---
  var r8 = await request('PUT', BASE + '/templates/' + templateId + '/draft', {
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    saveMode: '',
  });
  assert('saveMode="" does NOT return 400', r8.status !== 400);

  // Clean up
  await request('DELETE', BASE + '/templates/' + templateId);

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });
