/**
 * Feature #95: Schema JSON round-trips without loss
 * Complex schema stored and retrieved exactly
 * Steps: Create with nested objects, arrays, unicode; GET by ID; Compare byte-for-byte; No truncation or coercion
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

const TOKEN = makeToken('user-95', 'org-test-95', ['template:read', 'template:write', 'template:view']);

let passed = 0;
let failed = 0;

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
    var hdrs = res.headers;
    return res.text().then(function(text) {
      var json;
      try { json = JSON.parse(text); } catch(e) { json = text; }
      return { status: status, json: json, headers: hdrs };
    });
  });
}

// Deep equality that ignores key order (JSONB doesn't preserve key order)
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  var keysA = Object.keys(a).sort();
  var keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (var j = 0; j < keysA.length; j++) {
    if (keysA[j] !== keysB[j]) return false;
    if (!deepEqual(a[keysA[j]], b[keysB[j]])) return false;
  }
  return true;
}

function run() {
  console.log('Feature #95: Schema JSON round-trips without loss');
  console.log('='.repeat(50));

  var ids = [];

  // Test 1: Complex schema with nested objects, arrays, unicode
  var complexSchema = {
    pages: [
      {
        elements: [
          {
            name: 'header_text',
            type: 'text',
            position: { x: 10.5, y: 20.75 },
            width: 200,
            height: 30,
            content: 'Invoice #{{invoice.number}}',
            style: {
              fontSize: 24,
              fontWeight: 'bold',
              color: '#333333',
              fontFamily: 'Helvetica',
              alignment: 'center',
              lineHeight: 1.5,
              letterSpacing: 0.5,
            },
            conditions: {
              visible: true,
              scope: 'all',
            },
          },
          {
            name: 'unicode_field',
            type: 'text',
            position: { x: 10, y: 60 },
            width: 300,
            height: 20,
            content: '日本語テスト • Ñoño • Ürümqi • Łódź • Ελληνικά • العربية • 中文测试 • 한국어',
          },
          {
            name: 'emoji_field',
            type: 'text',
            position: { x: 10, y: 90 },
            width: 300,
            height: 20,
            content: '🏢 Company Ltd. — €1,234.56 • £999 • ¥10000 • ₹5000',
          },
          {
            name: 'line_items',
            type: 'line-items-table',
            position: { x: 10, y: 120 },
            width: 500,
            height: 300,
            columns: [
              { key: 'description', label: 'Description', width: 200, align: 'left' },
              { key: 'qty', label: 'Qty', width: 50, align: 'right', format: 'number' },
              { key: 'price', label: 'Unit Price', width: 100, align: 'right', format: 'currency' },
              { key: 'total', label: 'Total', width: 100, align: 'right', format: 'currency' },
            ],
            footers: [
              { label: 'Subtotal', expression: 'SUM(total)' },
              { label: 'VAT (15%)', expression: 'SUM(total) * 0.15' },
              { label: 'Grand Total', expression: 'SUM(total) * 1.15', style: { fontWeight: 'bold' } },
            ],
          },
        ],
      },
      {
        elements: [
          {
            name: 'terms',
            type: 'rich-text',
            position: { x: 10, y: 10 },
            width: 500,
            height: 400,
            content: '<h2>Terms &amp; Conditions</h2><p>Payment due within <strong>30 days</strong>.</p>',
          },
        ],
      },
    ],
    metadata: {
      version: '2.0',
      author: 'Test Agent',
      tags: ['invoice', 'multi-page', 'unicode'],
      created: '2026-01-01T00:00:00Z',
    },
  };

  console.log('\n--- Test 1: Complex nested schema ---');
  return api('/api/pdfme/templates', {
    method: 'POST', token: TOKEN,
    body: { name: 'RoundTrip_Complex_' + Date.now(), type: 'invoice', schema: complexSchema },
  }).then(function(createRes) {
    assert(createRes.status === 201 || createRes.status === 200, 'Complex template created');
    var id1 = createRes.json.id || (createRes.json.template && createRes.json.template.id);
    assert(!!id1, 'Template has ID');
    ids.push(id1);

    return api('/api/pdfme/templates/' + id1, { token: TOKEN }).then(function(getRes) {
      assert(getRes.status === 200, 'GET by ID returns 200');
      var retrieved = getRes.json.schema || (getRes.json.template && getRes.json.template.schema);
      assert(deepEqual(complexSchema, retrieved), 'Complex schema round-trips without data loss');

      // Unicode checks
      var unicodeElement = retrieved && retrieved.pages && retrieved.pages[0].elements.find(function(e) { return e.name === 'unicode_field'; });
      assert(unicodeElement && unicodeElement.content.includes('日本語テスト'), 'Japanese characters preserved');
      assert(unicodeElement && unicodeElement.content.includes('Łódź'), 'Polish characters preserved');
      assert(unicodeElement && unicodeElement.content.includes('العربية'), 'Arabic characters preserved');
      assert(unicodeElement && unicodeElement.content.includes('한국어'), 'Korean characters preserved');

      var emojiElement = retrieved && retrieved.pages && retrieved.pages[0].elements.find(function(e) { return e.name === 'emoji_field'; });
      assert(emojiElement && emojiElement.content.includes('🏢'), 'Emoji preserved');
      assert(emojiElement && emojiElement.content.includes('€'), 'Euro symbol preserved');
      assert(emojiElement && emojiElement.content.includes('£'), 'Pound symbol preserved');

      // Metadata preserved
      assert(deepEqual(retrieved.metadata, complexSchema.metadata), 'Metadata preserved');
      assert(retrieved.metadata && retrieved.metadata.tags.length === 3, 'Tags array length preserved');

      return retrieved;
    });
  })
  // Test 2: Deep nesting
  .then(function() {
    console.log('\n--- Test 2: Deep nesting ---');
    var deepSchema = {
      pages: [{ elements: [{ name: 'deep', type: 'text', position: {x:0,y:0}, width: 100, height: 20, content: 'test',
        meta: { level1: { level2: { level3: { level4: { level5: {
          value: 'deeply nested value', number: 42, bool: true, nil: null, arr: [1, 'two', 3.0, null, false]
        }}}}}}
      }] }],
    };
    return api('/api/pdfme/templates', {
      method: 'POST', token: TOKEN,
      body: { name: 'RoundTrip_Deep_' + Date.now(), type: 'report', schema: deepSchema },
    }).then(function(cr) {
      assert(cr.status === 201 || cr.status === 200, 'Deep nested template created');
      var id2 = cr.json.id || (cr.json.template && cr.json.template.id);
      ids.push(id2);
      return api('/api/pdfme/templates/' + id2, { token: TOKEN }).then(function(gr) {
        var r = gr.json.schema || (gr.json.template && gr.json.template.schema);
        assert(deepEqual(deepSchema, r), 'Deep nested schema round-trips without data loss');
        // Check specific deep values
        var deep = r.pages[0].elements[0].meta.level1.level2.level3.level4.level5;
        assert(deep.value === 'deeply nested value', 'Deep string value preserved');
        assert(deep.number === 42, 'Deep number preserved');
        assert(deep.bool === true, 'Deep boolean true preserved');
        assert(deep.nil === null, 'Deep null preserved');
        assert(Array.isArray(deep.arr) && deep.arr.length === 5, 'Deep array length preserved');
        assert(deep.arr[3] === null, 'Null in array preserved');
        assert(deep.arr[4] === false, 'False in array preserved');
      });
    });
  })
  // Test 3: Arrays with mixed types and numbers
  .then(function() {
    console.log('\n--- Test 3: Arrays with mixed types ---');
    var arraySchema = {
      pages: [{ elements: [
        { name: 'f1', type: 'text', position: {x:0,y:0}, width: 10, height: 10, content: 'a' },
        { name: 'f2', type: 'text', position: {x:20,y:0}, width: 10, height: 10, content: 'b' },
        { name: 'f3', type: 'text', position: {x:40,y:0}, width: 10, height: 10, content: 'c' },
      ] }],
      customData: {
        mixedArray: [1, 'string', true, false, null, { key: 'val' }, [1, 2, 3]],
        emptyArray: [],
        emptyObject: {},
        numberTypes: {
          integer: 42,
          negative: -17,
          float: 3.14159265358979,
          zero: 0,
          scientific: 1e10,
          maxSafe: 9007199254740991,
        },
      },
    };
    return api('/api/pdfme/templates', {
      method: 'POST', token: TOKEN,
      body: { name: 'RoundTrip_Arrays_' + Date.now(), type: 'report', schema: arraySchema },
    }).then(function(cr) {
      assert(cr.status === 201 || cr.status === 200, 'Array template created');
      var id3 = cr.json.id || (cr.json.template && cr.json.template.id);
      ids.push(id3);
      return api('/api/pdfme/templates/' + id3, { token: TOKEN }).then(function(gr) {
        var r = gr.json.schema || (gr.json.template && gr.json.template.schema);
        assert(deepEqual(arraySchema, r), 'Mixed array schema round-trips without data loss');
        // Number checks
        var nums = r.customData.numberTypes;
        assert(nums.integer === 42, 'Integer preserved');
        assert(nums.negative === -17, 'Negative preserved');
        assert(nums.float === 3.14159265358979, 'Float precision preserved');
        assert(nums.zero === 0, 'Zero preserved');
        assert(nums.maxSafe === 9007199254740991, 'Max safe integer preserved');
        // Mixed array checks
        assert(r.customData.mixedArray[0] === 1, 'Number in mixed array');
        assert(r.customData.mixedArray[1] === 'string', 'String in mixed array');
        assert(r.customData.mixedArray[2] === true, 'Boolean in mixed array');
        assert(r.customData.mixedArray[4] === null, 'Null in mixed array');
        assert(Array.isArray(r.customData.mixedArray[6]), 'Nested array in mixed array');
        assert(Array.isArray(r.customData.emptyArray) && r.customData.emptyArray.length === 0, 'Empty array preserved');
        assert(typeof r.customData.emptyObject === 'object' && Object.keys(r.customData.emptyObject).length === 0, 'Empty object preserved');
      });
    });
  })
  // Test 4: Special characters
  .then(function() {
    console.log('\n--- Test 4: Special characters ---');
    var specialSchema = {
      pages: [{ elements: [
        { name: 'special', type: 'text', position: {x:0,y:0}, width: 100, height: 20, content: 'Line1\nLine2\tTabbed\r\nCRLF' },
        { name: 'html_entities', type: 'rich-text', position: {x:0,y:30}, width: 100, height: 20, content: '<p>5 &gt; 3 &amp; 2 &lt; 4 &quot;quoted&quot;</p>' },
        { name: 'backslashes', type: 'text', position: {x:0,y:60}, width: 100, height: 20, content: 'path\\to\\file "with quotes" \'single\'' },
      ] }],
    };
    return api('/api/pdfme/templates', {
      method: 'POST', token: TOKEN,
      body: { name: 'RoundTrip_Special_' + Date.now(), type: 'invoice', schema: specialSchema },
    }).then(function(cr) {
      assert(cr.status === 201 || cr.status === 200, 'Special chars template created');
      var id5 = cr.json.id || (cr.json.template && cr.json.template.id);
      ids.push(id5);
      return api('/api/pdfme/templates/' + id5, { token: TOKEN }).then(function(gr) {
        var r = gr.json.schema || (gr.json.template && gr.json.template.schema);
        assert(deepEqual(specialSchema, r), 'Special characters round-trip without data loss');
        var special = r.pages[0].elements.find(function(e) { return e.name === 'special'; });
        assert(special && special.content.includes('\n'), 'Newline preserved');
        assert(special && special.content.includes('\t'), 'Tab preserved');
        var bs = r.pages[0].elements.find(function(e) { return e.name === 'backslashes'; });
        assert(bs && bs.content.includes('\\'), 'Backslash preserved');
        assert(bs && bs.content.includes('"with quotes"'), 'Double quotes preserved');
      });
    });
  })
  // Test 5: Large schema not truncated
  .then(function() {
    console.log('\n--- Test 5: Large schema not truncated ---');
    var elements = [];
    for (var i = 0; i < 100; i++) {
      elements.push({
        name: 'field_' + i,
        type: 'text',
        position: { x: (i % 10) * 50, y: Math.floor(i / 10) * 80 },
        width: 45,
        height: 20,
        content: 'Content for field ' + i + ' with some extra text to increase size',
      });
    }
    var largeSchema = { pages: [{ elements: elements }] };
    return api('/api/pdfme/templates', {
      method: 'POST', token: TOKEN,
      body: { name: 'RoundTrip_Large_' + Date.now(), type: 'report', schema: largeSchema },
    }).then(function(cr) {
      assert(cr.status === 201 || cr.status === 200, 'Large template created');
      var id6 = cr.json.id || (cr.json.template && cr.json.template.id);
      ids.push(id6);
      return api('/api/pdfme/templates/' + id6, { token: TOKEN }).then(function(gr) {
        var r = gr.json.schema || (gr.json.template && gr.json.template.schema);
        assert(r.pages[0].elements.length === 100, 'All 100 elements preserved (no truncation)');
        assert(deepEqual(largeSchema, r), 'Large schema round-trips without data loss');
        // Check first and last element content
        assert(r.pages[0].elements[0].name === 'field_0', 'First element name correct');
        assert(r.pages[0].elements[99].name === 'field_99', 'Last element name correct');
      });
    });
  })
  // Cleanup
  .then(function() {
    console.log('\n--- Cleanup ---');
    var cleanups = ids.map(function(id) {
      return api('/api/pdfme/templates/' + id, { method: 'DELETE', token: TOKEN });
    });
    return Promise.all(cleanups);
  })
  .then(function() {
    console.log('\n' + '='.repeat(50));
    console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(function(err) {
    console.error('Test error:', err);
    process.exit(1);
  });
}

run();
