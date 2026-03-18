/**
 * Test Feature #276: Render channel parameter validated
 * Channel must be email or print
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = 'pdfme-dev-secret';

function makeJwt(payload) {
  var h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  var p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  var sig = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}

var JWT = makeJwt({ sub: 'test-user-276', orgId: 'org-test-276', roles: ['admin'] });

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
  console.log('Feature #276: Render channel parameter validated\n');

  // Create a template
  var createRes = await request('POST', BASE + '/templates', {
    name: 'Channel Test 276',
    type: 'invoice',
    schema: { pages: [{ elements: [] }] },
    orgId: 'org-test-276',
  });
  var templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + ' status: ' + createRes.status);

  // Publish
  var pubRes = await request('POST', BASE + '/templates/' + templateId + '/publish');
  console.log('  Publish status: ' + pubRes.status + ' body: ' + JSON.stringify(pubRes.body).substring(0, 200));

  // --- CORE TESTS: channel validation on render/now ---
  console.log('\n--- render/now channel validation ---');

  // Test: channel=invalid -> 400
  var r1 = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-1', channel: 'invalid',
  });
  assert('channel=invalid returns 400', r1.status === 400);
  assert('Error mentions invalid', typeof r1.body.message === 'string' && r1.body.message.indexOf('invalid') >= 0);
  assert('Lists email and print', typeof r1.body.message === 'string' && r1.body.message.indexOf('email') >= 0 && r1.body.message.indexOf('print') >= 0);
  assert('Details has channel field', Array.isArray(r1.body.details) && r1.body.details.some(function(d) { return d.field === 'channel'; }));

  // Test: channel=fax -> 400
  var r2 = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-1', channel: 'fax',
  });
  assert('channel=fax returns 400', r2.status === 400);

  // Test: channel=both -> 400
  var r2b = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-1', channel: 'both',
  });
  assert('channel=both returns 400', r2b.status === 400);

  // Test: channel=EMAIL (case sensitive) -> 400
  var r3 = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-1', channel: 'EMAIL',
  });
  assert('channel=EMAIL returns 400 (case-sensitive)', r3.status === 400);

  // Test: channel=Print (mixed case) -> 400
  var r3b = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-1', channel: 'Print',
  });
  assert('channel=Print returns 400 (case-sensitive)', r3b.status === 400);

  // Test: channel=email succeeds (not 400)
  var r4 = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-email-276', channel: 'email',
  });
  assert('channel=email does NOT return 400', r4.status !== 400);

  // Test: channel=print succeeds (not 400)
  var r5 = await request('POST', BASE + '/render/now', {
    templateId: templateId, entityId: 'ent-print-276', channel: 'print',
  });
  assert('channel=print does NOT return 400', r5.status !== 400);

  // --- BULK RENDER channel validation ---
  console.log('\n--- render/bulk channel validation ---');

  var r6 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-bulk-1'], channel: 'invalid',
  });
  assert('bulk channel=invalid returns 400', r6.status === 400);
  assert('bulk error lists valid options', typeof r6.body.message === 'string' && r6.body.message.indexOf('email') >= 0);

  var r7 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-bulk-email'], channel: 'email',
  });
  assert('bulk channel=email does NOT return 400', r7.status !== 400);

  var r8 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-bulk-print'], channel: 'print',
  });
  assert('bulk channel=print does NOT return 400', r8.status !== 400);

  // --- ASYNC RENDER channel validation ---
  console.log('\n--- render/async channel validation ---');

  var r9 = await request('POST', BASE + '/render/async', {
    templateId: templateId, entityId: 'ent-1', channel: 'invalid',
  });
  assert('async channel=invalid returns 400', r9.status === 400);

  var r10 = await request('POST', BASE + '/render/async', {
    templateId: templateId, entityId: 'ent-async-email', channel: 'email',
  });
  assert('async channel=email does NOT return 400', r10.status !== 400);

  var r11 = await request('POST', BASE + '/render/async', {
    templateId: templateId, entityId: 'ent-async-print', channel: 'print',
  });
  assert('async channel=print does NOT return 400', r11.status !== 400);

  // Clean up
  await request('DELETE', BASE + '/templates/' + templateId);

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });
