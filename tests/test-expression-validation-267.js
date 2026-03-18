const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t267', orgId: 'org-t267', roles: ['template:edit', 'template:publish'] });

function req(m, p, b) {
  return new Promise((ok, no) => {
    const u = new URL(p);
    const o = { method: m, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    const r = http.request(o, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch(e) { ok({ s: res.statusCode, b: d }); } }); });
    r.on('error', no);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}

let pass = 0;
let fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; process.stdout.write('  PASS: ' + msg + '\n'); }
  else { fail++; process.stdout.write('  FAIL: ' + msg + '\n'); }
}

async function go() {
  process.stdout.write('=== Feature #267: Expression validation on publish ===\n\n');

  const BASE = 'http://localhost:3001/api/pdfme/templates';

  // 1. Create template with INVALID() expression (unknown function)
  const invalidExprSchema = {
    pages: [{
      elements: [{
        type: 'calculated',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: 'INVALID()',
        content: 'INVALID()'
      }]
    }]
  };

  const c1 = await req('POST', BASE, { name: 'Expr Validation Test 267', type: 'invoice', schema: invalidExprSchema });
  assert(c1.s === 201, 'Created template with invalid expression');
  const templateId = c1.b.id;

  // 2. Try to publish - should get 422
  const pub1 = await req('POST', BASE + '/' + templateId + '/publish');
  assert(pub1.s === 422, 'Publish rejected with 422 for INVALID(): ' + pub1.s);
  assert(pub1.b.details && pub1.b.details.length > 0, 'Has validation error details');

  const exprErrors = (pub1.b.details || []).filter(function(d) { return d.field && d.field.includes('expression'); });
  assert(exprErrors.length > 0, 'Has expression validation error');
  if (exprErrors.length > 0) {
    assert(exprErrors[0].message.includes('Invalid expression'), 'Error message contains "Invalid expression"');
  }

  // 3. Create template with syntax error: (((
  const syntaxErrSchema = {
    pages: [{
      elements: [{
        type: 'calculated',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: '(((',
        content: '((('
      }]
    }]
  };

  const c2 = await req('POST', BASE, { name: 'Expr Syntax Error 267', type: 'invoice', schema: syntaxErrSchema });
  assert(c2.s === 201, 'Created template with syntax error expression');

  const pub2 = await req('POST', BASE + '/' + c2.b.id + '/publish');
  assert(pub2.s === 422, 'Syntax error expression rejected on publish: ' + pub2.s);

  // 4. Create template with IF(,,,) - parse error
  const ifErrSchema = {
    pages: [{
      elements: [{
        type: 'calculated',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: 'IF(,,,)',
        content: 'IF(,,,)'
      }]
    }]
  };
  const c3 = await req('POST', BASE, { name: 'Expr IF Error 267', type: 'invoice', schema: ifErrSchema });
  const pub3 = await req('POST', BASE + '/' + c3.b.id + '/publish');
  assert(pub3.s === 422, 'IF(,,,) expression rejected on publish: ' + pub3.s);

  // 5. Fix the first template expression to valid IF(1,1,0)
  const validExprSchema = {
    pages: [{
      elements: [{
        type: 'calculated',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: 'IF(1, 1, 0)',
        content: 'IF(1, 1, 0)'
      }]
    }]
  };

  const fix = await req('PUT', BASE + '/' + templateId + '/draft', { schema: validExprSchema });
  assert(fix.s === 200, 'Updated template with valid expression');

  const pub4 = await req('POST', BASE + '/' + templateId + '/publish');
  assert(pub4.s < 300, 'Publish succeeds with valid expression: ' + pub4.s);
  assert(pub4.b.status === 'published', 'Template is now published');

  // 6. Test various valid expressions don't cause false positives
  var validExprs = [
    'price * quantity',
    'ROUND(total, 2)',
    'IF(amount > 0, amount, 0)',
    'CONCAT(LEFT(name, 5), "...")',
    'FORMAT_CURRENCY(total)',
    'ABS(balance)',
    'TODAY()',
    'price + tax',
    '5 + 3',
  ];

  for (var i = 0; i < validExprs.length; i++) {
    var expr = validExprs[i];
    var vSchema = {
      pages: [{
        elements: [{
          type: 'calculated',
          position: { x: 10, y: 10 },
          width: 100,
          height: 20,
          expression: expr,
          content: expr
        }]
      }]
    };
    var vc = await req('POST', BASE, { name: 'Valid Expr ' + i, type: 'invoice', schema: vSchema });
    var vp = await req('POST', BASE + '/' + vc.b.id + '/publish');
    var hasExprError = vp.b.details && vp.b.details.some(function(d) { return d.message && d.message.includes('Invalid expression'); });
    assert(!hasExprError, 'Valid expression passes: ' + expr);
  }

  // 7. Test conditional visibility expression validation - invalid
  var condVisSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{document.number}}',
        conditionalVisibility: {
          type: 'expression',
          expression: 'BOGUS_SYNTAX((('
        }
      }]
    }]
  };
  var cc = await req('POST', BASE, { name: 'Cond Vis Invalid 267', type: 'invoice', schema: condVisSchema });
  var cp = await req('POST', BASE + '/' + cc.b.id + '/publish');
  assert(cp.s === 422, 'Invalid conditional visibility expression rejected: ' + cp.s);
  var condErrors = (cp.b.details || []).filter(function(d) { return d.message && d.message.includes('conditional visibility'); });
  assert(condErrors.length > 0, 'Has conditional visibility expression error');

  // 8. Valid conditional visibility expression passes
  var condVisValidSchema = {
    pages: [{
      elements: [{
        type: 'text',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        content: '{{document.number}}',
        conditionalVisibility: {
          type: 'expression',
          expression: 'amount > 0'
        }
      }]
    }]
  };
  var ccv = await req('POST', BASE, { name: 'Cond Vis Valid 267', type: 'invoice', schema: condVisValidSchema });
  var cpv = await req('POST', BASE + '/' + ccv.b.id + '/publish');
  var hasCondExprError = (cpv.b.details || []).some(function(d) { return d.message && d.message.includes('conditional visibility'); });
  assert(!hasCondExprError, 'Valid conditional visibility expression passes');

  // 9. Pure binding in calculated field is NOT expression-validated
  var bindingOnlySchema = {
    pages: [{
      elements: [{
        type: 'calculated',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: '{{document.number}}',
        content: '{{document.number}}'
      }]
    }]
  };
  var bc = await req('POST', BASE, { name: 'Binding Only 267', type: 'invoice', schema: bindingOnlySchema });
  var bp = await req('POST', BASE + '/' + bc.b.id + '/publish');
  var hasExprErrorBinding = (bp.b.details || []).some(function(d) { return d.message && d.message.includes('Invalid expression'); });
  assert(!hasExprErrorBinding, 'Pure binding in calculated field not treated as expression error');

  // 10. calculated-field type also validated
  var calcFieldSchema = {
    pages: [{
      elements: [{
        type: 'calculated-field',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
        expression: 'NOTREAL(((',
        content: 'NOTREAL((('
      }]
    }]
  };
  var cfc = await req('POST', BASE, { name: 'CalcField Invalid 267', type: 'invoice', schema: calcFieldSchema });
  var cfp = await req('POST', BASE + '/' + cfc.b.id + '/publish');
  assert(cfp.s === 422, 'calculated-field type also validates expressions: ' + cfp.s);

  // Cleanup
  var templates = await req('GET', BASE + '?orgId=org-t267&limit=100');
  if (templates.b.data) {
    for (var j = 0; j < templates.b.data.length; j++) {
      var t = templates.b.data[j];
      if (t.name && (t.name.includes('267') || t.name.includes('Valid Expr') || t.name.includes('Cond Vis') || t.name.includes('Binding') || t.name.includes('CalcField'))) {
        await req('DELETE', BASE + '/' + t.id);
      }
    }
  }

  process.stdout.write('\n=== Results: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total ===\n');
  process.exit(fail > 0 ? 1 : 0);
}

go().catch(function(e) { process.stderr.write(e.stack + '\n'); process.exit(1); });
