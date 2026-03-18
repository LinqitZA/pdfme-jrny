/**
 * Test Feature #278: Batch onFailure parameter validated
 * onFailure must be continue or abort
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

var JWT = makeJwt({ sub: 'test-user-278', orgId: 'org-test-278', roles: ['admin'] });

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
  console.log('Feature #278: Batch onFailure parameter validated\n');

  // Create a published template
  var createRes = await request('POST', BASE + '/templates', {
    name: 'OnFailure Test 278',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', name: 'test', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] },
    orgId: 'org-test-278',
  });
  var templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + ' status: ' + createRes.status);

  var pubRes = await request('POST', BASE + '/templates/' + templateId + '/publish');
  console.log('  Publish status: ' + pubRes.status);

  // --- Test: onFailure=invalid -> 400 ---
  console.log('\n--- onFailure validation on POST bulk ---');
  var r1 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-1'], channel: 'email', onFailure: 'invalid',
  });
  assert('onFailure=invalid returns 400', r1.status === 400);
  assert('Error mentions invalid', typeof r1.body.message === 'string' && r1.body.message.indexOf('invalid') >= 0);
  assert('Lists continue and abort', typeof r1.body.message === 'string' && r1.body.message.indexOf('continue') >= 0 && r1.body.message.indexOf('abort') >= 0);
  assert('Details has onFailure field', Array.isArray(r1.body.details) && r1.body.details.some(function(d) { return d.field === 'onFailure'; }));

  // --- Test: onFailure=skip -> 400 ---
  var r2 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-1'], channel: 'email', onFailure: 'skip',
  });
  assert('onFailure=skip returns 400', r2.status === 400);

  // --- Test: onFailure=retry -> 400 ---
  var r2b = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-1'], channel: 'email', onFailure: 'retry',
  });
  assert('onFailure=retry returns 400', r2b.status === 400);

  // --- Test: onFailure=CONTINUE (case sensitive) -> 400 ---
  var r3 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-1'], channel: 'email', onFailure: 'CONTINUE',
  });
  assert('onFailure=CONTINUE returns 400 (case-sensitive)', r3.status === 400);

  // --- Test: onFailure=Abort (mixed case) -> 400 ---
  var r3b = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-1'], channel: 'email', onFailure: 'Abort',
  });
  assert('onFailure=Abort returns 400 (case-sensitive)', r3b.status === 400);

  // --- Test: onFailure=continue succeeds ---
  var r4 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-continue-278'], channel: 'email', onFailure: 'continue',
  });
  assert('onFailure=continue does NOT return 400', r4.status !== 400);

  // --- Test: onFailure=abort succeeds ---
  var r5 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-abort-278'], channel: 'email', onFailure: 'abort',
  });
  assert('onFailure=abort does NOT return 400', r5.status !== 400);

  // --- Test: no onFailure (omitted) succeeds ---
  var r6 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-nomode-278'], channel: 'email',
  });
  assert('No onFailure (omitted) does NOT return 400', r6.status !== 400);

  // --- Test: onFailure=null succeeds (treated as omitted) ---
  var r7 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-null-278'], channel: 'email', onFailure: null,
  });
  assert('onFailure=null does NOT return 400', r7.status !== 400);

  // --- Test: onFailure="" succeeds (treated as omitted) ---
  var r8 = await request('POST', BASE + '/render/bulk', {
    templateId: templateId, entityIds: ['ent-empty-278'], channel: 'email', onFailure: '',
  });
  assert('onFailure="" does NOT return 400', r8.status !== 400);

  // Clean up
  await request('DELETE', BASE + '/templates/' + templateId);

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + '/' + (passed + failed) + ' passed');
  if (failed > 0) process.exit(1);
}

run().catch(function(e) { console.error(e); process.exit(1); });
