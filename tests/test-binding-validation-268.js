const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t268', orgId: 'org-t268', roles: ['template:edit', 'template:publish'] });

function req(m, p, b) {
  return new Promise(function(ok, no) {
    var u = new URL(p);
    var o = { method: m, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    var r = http.request(o, function(res) { var d = ''; res.on('data', function(c) { d += c; }); res.on('end', function() { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch(e) { ok({ s: res.statusCode, b: d }); } }); });
    r.on('error', no);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}

var pass = 0;
var fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; process.stdout.write('  PASS: ' + msg + '\n'); }
  else { fail++; process.stdout.write('  FAIL: ' + msg + '\n'); }
}

async function go() {
  process.stdout.write('=== Feature #268: Binding validation on publish ===\n\n');

  var BASE = 'http://localhost:3000/api/pdfme/templates';

  // 1. Create template with nonexistent field binding
  var invalidBindingSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{nonexistent.field}}'
      }]
    }]
  };

  var c1 = await req('POST', BASE, { name: 'Binding Validation 268', type: 'invoice', schema: invalidBindingSchema });
  assert(c1.s === 201, 'Created template with nonexistent binding');
  var templateId = c1.b.id;

  // 2. Try to publish - should get 422
  var pub1 = await req('POST', BASE + '/' + templateId + '/publish');
  assert(pub1.s === 422, 'Publish rejected with 422: ' + pub1.s);
  assert(pub1.b.details && pub1.b.details.length > 0, 'Has validation error details');

  // 3. Check the error mentions the specific field name
  var bindingErrors = (pub1.b.details || []).filter(function(d) { return d.message && d.message.includes('nonexistent.field'); });
  assert(bindingErrors.length > 0, 'Error mentions specific field name "nonexistent.field"');

  // 4. Check the error says "Unresolvable binding"
  var unresolvableErrors = (pub1.b.details || []).filter(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(unresolvableErrors.length > 0, 'Error message contains "Unresolvable"');

  // 5. Verify the error references the 'invoice' field schema
  var invoiceRefErrors = (pub1.b.details || []).filter(function(d) { return d.message && d.message.includes("'invoice'"); });
  assert(invoiceRefErrors.length > 0, 'Error references the invoice field schema');

  // 6. Valid binding should pass - document.number is a known invoice field
  var validBindingSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{document.number}}'
      }]
    }]
  };
  var c2 = await req('POST', BASE, { name: 'Valid Binding 268', type: 'invoice', schema: validBindingSchema });
  var pub2 = await req('POST', BASE + '/' + c2.b.id + '/publish');
  var hasBindingError = (pub2.b.details || []).some(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(!hasBindingError, 'Valid binding {{document.number}} passes');

  // 7. Multiple valid bindings
  var multiBindingSchema = {
    pages: [{
      elements: [
        { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{customer.name}}' },
        { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 20, content: '{{document.date}}' },
        { type: 'text', position: { x: 10, y: 50 }, width: 100, height: 20, content: '{{company.name}}' },
        { type: 'text', position: { x: 10, y: 70 }, width: 100, height: 20, content: '{{totals.total}}' },
      ]
    }]
  };
  var c3 = await req('POST', BASE, { name: 'Multi Binding 268', type: 'invoice', schema: multiBindingSchema });
  var pub3 = await req('POST', BASE + '/' + c3.b.id + '/publish');
  var hasMultiError = (pub3.b.details || []).some(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(!hasMultiError, 'Multiple valid bindings all pass');

  // 8. Mix of valid and invalid bindings
  var mixedSchema = {
    pages: [{
      elements: [
        { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{document.number}}' },
        { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 20, content: '{{totally.fake.binding}}' },
      ]
    }]
  };
  var c4 = await req('POST', BASE, { name: 'Mixed Binding 268', type: 'invoice', schema: mixedSchema });
  var pub4 = await req('POST', BASE + '/' + c4.b.id + '/publish');
  assert(pub4.s === 422, 'Mixed bindings: publish rejected: ' + pub4.s);
  var fakeErrors = (pub4.b.details || []).filter(function(d) { return d.message && d.message.includes('totally.fake.binding'); });
  assert(fakeErrors.length > 0, 'Error identifies the fake binding specifically');

  // 9. Template type without field schema (e.g. "custom") should NOT reject bindings
  var customSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{anything.goes}}'
      }]
    }]
  };
  var c5 = await req('POST', BASE, { name: 'Custom Type 268', type: 'custom', schema: customSchema });
  var pub5 = await req('POST', BASE + '/' + c5.b.id + '/publish');
  var hasCustomBindingError = (pub5.b.details || []).some(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(!hasCustomBindingError, 'Custom type (no field schema) allows any bindings');

  // 10. Statement type also validates against its own field schema
  var stmtSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{bogus.statement.field}}'
      }]
    }]
  };
  var c6 = await req('POST', BASE, { name: 'Statement Binding 268', type: 'statement', schema: stmtSchema });
  var pub6 = await req('POST', BASE + '/' + c6.b.id + '/publish');
  assert(pub6.s === 422, 'Statement type also rejects unresolvable bindings: ' + pub6.s);
  var stmtErrors = (pub6.b.details || []).filter(function(d) { return d.message && d.message.includes('bogus.statement.field'); });
  assert(stmtErrors.length > 0, 'Statement binding error identifies specific field');

  // 11. Valid statement binding passes
  var stmtValidSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{customer.name}}'
      }]
    }]
  };
  var c7 = await req('POST', BASE, { name: 'Statement Valid 268', type: 'statement', schema: stmtValidSchema });
  var pub7 = await req('POST', BASE + '/' + c7.b.id + '/publish');
  var hasStmtBindingError = (pub7.b.details || []).some(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(!hasStmtBindingError, 'Valid statement binding passes');

  // 12. Multiple bad fields in same template
  var multiBadSchema = {
    pages: [{
      elements: [
        { type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: '{{bad.field1}}' },
        { type: 'text', position: { x: 10, y: 30 }, width: 100, height: 20, content: '{{bad.field2}}' },
        { type: 'text', position: { x: 10, y: 50 }, width: 100, height: 20, content: '{{bad.field3}}' },
      ]
    }]
  };
  var c8 = await req('POST', BASE, { name: 'Multi Bad Binding 268', type: 'invoice', schema: multiBadSchema });
  var pub8 = await req('POST', BASE + '/' + c8.b.id + '/publish');
  assert(pub8.s === 422, 'Multiple bad bindings rejected');
  var allBadErrors = (pub8.b.details || []).filter(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(allBadErrors.length >= 3, 'All 3 bad bindings reported: found ' + allBadErrors.length);

  // 13. Line items array field binding should pass
  var lineItemSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{lineItems[].description}}'
      }]
    }]
  };
  var c9 = await req('POST', BASE, { name: 'LineItem Binding 268', type: 'invoice', schema: lineItemSchema });
  var pub9 = await req('POST', BASE + '/' + c9.b.id + '/publish');
  var hasLineItemError = (pub9.b.details || []).some(function(d) { return d.message && d.message.includes('Unresolvable'); });
  assert(!hasLineItemError, 'Line items array binding passes');

  // Cleanup
  var templates = await req('GET', BASE + '?orgId=org-t268&limit=100');
  if (templates.b.data) {
    for (var j = 0; j < templates.b.data.length; j++) {
      var t = templates.b.data[j];
      if (t.name && t.name.includes('268')) {
        await req('DELETE', BASE + '/' + t.id);
      }
    }
  }

  process.stdout.write('\n=== Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total ===\n');
  process.exit(fail > 0 ? 1 : 0);
}

go().catch(function(e) { process.stderr.write(e.stack + '\n'); process.exit(1); });
