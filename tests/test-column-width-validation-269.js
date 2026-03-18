const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t269', orgId: 'org-t269', roles: ['template:edit', 'template:publish'] });

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
  process.stdout.write('=== Feature #269: Column sum validation on line items table ===\n\n');

  var BASE = 'http://localhost:3000/api/pdfme/templates';

  // 1. Create template with column widths that DON'T sum to element width
  var wrongSumSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 200,
        height: 100,
        columns: [
          { key: 'description', header: 'Description', width: 80 },
          { key: 'quantity', header: 'Qty', width: 30 },
          { key: 'price', header: 'Price', width: 50 },
          { key: 'total', header: 'Total', width: 50 }
        ]
      }]
    }]
  };
  // Column widths: 80 + 30 + 50 + 50 = 210, but element width = 200

  var c1 = await req('POST', BASE, { name: 'ColWidth Wrong 269', type: 'custom', schema: wrongSumSchema });
  assert(c1.s === 201, 'Created template with wrong column widths');
  var t1Id = c1.b.id;

  // 2. Try to publish - should get 422
  var pub1 = await req('POST', BASE + '/' + t1Id + '/publish');
  assert(pub1.s === 422, 'Publish rejected with 422: ' + pub1.s);

  // 3. Check the error mentions column widths
  var colErrors = (pub1.b.details || []).filter(function(d) { return d.message && d.message.includes('Column widths'); });
  assert(colErrors.length > 0, 'Has column width validation error');

  // 4. Error should mention the sum and expected width
  if (colErrors.length > 0) {
    assert(colErrors[0].message.includes('210'), 'Error mentions actual sum (210)');
    assert(colErrors[0].message.includes('200'), 'Error mentions expected width (200)');
  }

  // 5. Fix widths to sum correctly - publish succeeds
  var correctSumSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 200,
        height: 100,
        columns: [
          { key: 'description', header: 'Description', width: 80 },
          { key: 'quantity', header: 'Qty', width: 30 },
          { key: 'price', header: 'Price', width: 50 },
          { key: 'total', header: 'Total', width: 40 }
        ]
      }]
    }]
  };
  // Column widths: 80 + 30 + 50 + 40 = 200 = element width

  var fix = await req('PUT', BASE + '/' + t1Id + '/draft', { schema: correctSumSchema });
  assert(fix.s === 200, 'Updated template with correct column widths');

  var pub2 = await req('POST', BASE + '/' + t1Id + '/publish');
  assert(pub2.s < 300, 'Publish succeeds with correct column widths: ' + pub2.s);
  assert(pub2.b.status === 'published', 'Template is now published');

  // 6. Test with lineItemsTable type name variant
  var lineItemsTableSchema = {
    pages: [{
      elements: [{
        type: 'lineItemsTable',
        position: { x: 10, y: 10 },
        width: 150,
        height: 100,
        columns: [
          { key: 'desc', header: 'Description', width: 80 },
          { key: 'amt', header: 'Amount', width: 80 }
        ]
      }]
    }]
  };
  // 80 + 80 = 160, but width = 150

  var c2 = await req('POST', BASE, { name: 'LineItemsTable 269', type: 'custom', schema: lineItemsTableSchema });
  var pub3 = await req('POST', BASE + '/' + c2.b.id + '/publish');
  assert(pub3.s === 422, 'lineItemsTable type also validates: ' + pub3.s);

  // 7. Test with grouped-table type
  var groupedTableSchema = {
    pages: [{
      elements: [{
        type: 'grouped-table',
        position: { x: 10, y: 10 },
        width: 180,
        height: 100,
        columns: [
          { key: 'group', header: 'Group', width: 60 },
          { key: 'item', header: 'Item', width: 60 },
          { key: 'value', header: 'Value', width: 70 }
        ]
      }]
    }]
  };
  // 60 + 60 + 70 = 190, but width = 180

  var c3 = await req('POST', BASE, { name: 'GroupedTable 269', type: 'custom', schema: groupedTableSchema });
  var pub4 = await req('POST', BASE + '/' + c3.b.id + '/publish');
  assert(pub4.s === 422, 'grouped-table type also validates: ' + pub4.s);

  // 8. Exactly matching widths pass
  var exactSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 495,
        height: 200,
        columns: [
          { key: 'description', header: 'Description', width: 200 },
          { key: 'qty', header: 'Qty', width: 45 },
          { key: 'unit_price', header: 'Unit Price', width: 125 },
          { key: 'amount', header: 'Amount', width: 125 }
        ]
      }]
    }]
  };
  // 200 + 45 + 125 + 125 = 495 = width

  var c4 = await req('POST', BASE, { name: 'Exact Width 269', type: 'custom', schema: exactSchema });
  var pub5 = await req('POST', BASE + '/' + c4.b.id + '/publish');
  var hasColError = (pub5.b.details || []).some(function(d) { return d.message && d.message.includes('Column widths'); });
  assert(!hasColError, 'Exactly matching column widths pass validation');

  // 9. Non-table elements don't trigger column width validation
  var textSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: 'Hello World'
      }]
    }]
  };
  var c5 = await req('POST', BASE, { name: 'Text Element 269', type: 'custom', schema: textSchema });
  var pub6 = await req('POST', BASE + '/' + c5.b.id + '/publish');
  var hasTextColError = (pub6.b.details || []).some(function(d) { return d.message && d.message.includes('Column widths'); });
  assert(!hasTextColError, 'Non-table elements not checked for column widths');

  // 10. Small floating point differences within tolerance (0.5mm) pass
  var fpSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 200,
        height: 100,
        columns: [
          { key: 'a', header: 'A', width: 66.7 },
          { key: 'b', header: 'B', width: 66.7 },
          { key: 'c', header: 'C', width: 66.7 }
        ]
      }]
    }]
  };
  // 66.7 * 3 = 200.1, diff = 0.1 which is within 0.5 tolerance

  var c6 = await req('POST', BASE, { name: 'FP Tolerance 269', type: 'custom', schema: fpSchema });
  var pub7 = await req('POST', BASE + '/' + c6.b.id + '/publish');
  var hasFPError = (pub7.b.details || []).some(function(d) { return d.message && d.message.includes('Column widths'); });
  assert(!hasFPError, 'Floating point differences within tolerance pass');

  // 11. Large difference fails
  var largeDiffSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 200,
        height: 100,
        columns: [
          { key: 'a', header: 'A', width: 50 },
          { key: 'b', header: 'B', width: 50 }
        ]
      }]
    }]
  };
  // 50 + 50 = 100, but width = 200

  var c7 = await req('POST', BASE, { name: 'Large Diff 269', type: 'custom', schema: largeDiffSchema });
  var pub8 = await req('POST', BASE + '/' + c7.b.id + '/publish');
  assert(pub8.s === 422, 'Large difference in column widths rejected: ' + pub8.s);

  // 12. Table with 'w' property instead of 'width'
  var wPropSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        w: 200,
        height: 100,
        columns: [
          { key: 'a', header: 'A', width: 80 },
          { key: 'b', header: 'B', width: 130 }
        ]
      }]
    }]
  };
  // 80 + 130 = 210, but w = 200

  var c8 = await req('POST', BASE, { name: 'W Prop 269', type: 'custom', schema: wPropSchema });
  var pub9 = await req('POST', BASE + '/' + c8.b.id + '/publish');
  assert(pub9.s === 422, 'Element with "w" property also validated: ' + pub9.s);

  // 13. Table without columns array is fine (no validation needed)
  var noColsSchema = {
    pages: [{
      elements: [{
        type: 'line-items-table',
        position: { x: 10, y: 10 },
        width: 200,
        height: 100
      }]
    }]
  };
  var c9 = await req('POST', BASE, { name: 'No Cols 269', type: 'custom', schema: noColsSchema });
  var pub10 = await req('POST', BASE + '/' + c9.b.id + '/publish');
  var hasNoColError = (pub10.b.details || []).some(function(d) { return d.message && d.message.includes('Column widths'); });
  assert(!hasNoColError, 'Table without columns not checked');

  // Cleanup
  var templates = await req('GET', BASE + '?orgId=org-t269&limit=100');
  if (templates.b.data) {
    for (var j = 0; j < templates.b.data.length; j++) {
      var t = templates.b.data[j];
      if (t.name && t.name.includes('269')) {
        await req('DELETE', BASE + '/' + t.id);
      }
    }
  }

  process.stdout.write('\n=== Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total ===\n');
  process.exit(fail > 0 ? 1 : 0);
}

go().catch(function(e) { process.stderr.write(e.stack + '\n'); process.exit(1); });
