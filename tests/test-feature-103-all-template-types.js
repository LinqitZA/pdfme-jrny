/**
 * Feature #103: All template types accepted
 * Every document type from spec is valid
 * Steps: Create invoice, statement, purchase_order, delivery_note, credit_note,
 *        report types and custom. All succeed.
 */

const crypto = require('crypto');
const BASE = 'http://localhost:3000';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('user-103', 'org-test-103', ['template:read', 'template:write', 'template:edit', 'template:delete', 'template:view', 'template:publish']);

var passed = 0;
var failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function api(path, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  var body = opts.body;
  var token = opts.token;
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(BASE + path, {
    method: method, headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(function(res) {
    var status = res.status;
    return res.text().then(function(text) {
      var json;
      try { json = JSON.parse(text); } catch(e) { json = text; }
      return { status: status, json: json };
    });
  });
}

var schema = {
  pages: [{
    elements: [
      { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'Test' }
    ]
  }]
};

// All template types from the spec
var TEMPLATE_TYPES = [
  'invoice',
  'statement',
  'purchase_order',
  'delivery_note',
  'credit_note',
  'report_aged_debtors',
  'report_stock_on_hand',
  'report_sales_summary',
  'report',
  'custom',
];

var createdIds = [];

async function run() {
  console.log('Feature #103: All template types accepted');
  console.log('==========================================');

  // Test each type
  for (var i = 0; i < TEMPLATE_TYPES.length; i++) {
    var type = TEMPLATE_TYPES[i];
    console.log('\n--- Type: ' + type + ' ---');

    var r = await api('/api/pdfme/templates', {
      method: 'POST', token: TOKEN,
      body: { type: type, name: 'Test ' + type + ' 103', schema: schema, createdBy: 'user-103' }
    });
    assert(r.status === 201, type + ': created successfully (201)');
    assert(r.json.id, type + ': has an ID');
    assert(r.json.type === type, type + ': correct type in response');
    assert(r.json.status === 'draft', type + ': initial status is draft');

    if (r.json.id) {
      createdIds.push(r.json.id);

      // Verify it can be retrieved
      var g = await api('/api/pdfme/templates/' + r.json.id, { token: TOKEN });
      assert(g.status === 200, type + ': GET returns 200');
      assert(g.json.type === type, type + ': type matches on GET');
    }
  }

  // Verify all 10 types created
  console.log('\n--- Summary ---');
  assert(createdIds.length === TEMPLATE_TYPES.length,
    'All ' + TEMPLATE_TYPES.length + ' template types created: ' + createdIds.length);

  // Test that invalid type is rejected
  console.log('\n--- Invalid type ---');
  var r = await api('/api/pdfme/templates', {
    method: 'POST', token: TOKEN,
    body: { type: 'invalid_type', name: 'Test invalid 103', schema: schema, createdBy: 'user-103' }
  });
  assert(r.status === 400, 'Invalid type rejected with 400');
  assert(r.json.message && r.json.message.includes('Invalid template type'), 'Error message mentions invalid type');

  // Cleanup
  console.log('\n--- Cleanup ---');
  for (var j = 0; j < createdIds.length; j++) {
    await api('/api/pdfme/templates/' + createdIds[j], { method: 'DELETE', token: TOKEN });
  }

  console.log('\n==========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
