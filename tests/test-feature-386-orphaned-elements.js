/**
 * Feature #386: Orphaned elements detected at validation
 *
 * Tests:
 * 1. Create template with field binding
 * 2. Remove field from schema (use unknown field)
 * 3. Run validation
 * 4. Verify orphaned element warning
 * 5. Verify specific element identified
 */

const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const ORG_ID = 'org-orphaned-386';
const TOKEN = makeToken('test-user-386', ORG_ID);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0, failed = 0, total = 0;
function assert(name, condition, detail) {
  total++;
  if (condition) { passed++; console.log('PASS: ' + name); }
  else { failed++; console.log('FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

async function run() {
  console.log('=== Feature #386: Orphaned elements detected at validation ===\n');

  // --- Phase 1: Create template with valid field bindings ---
  console.log('--- Phase 1: Template with valid bindings ---');
  const validTemplate = {
    name: 'Valid Invoice 386',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'invoiceNumber',
              type: 'text',
              content: '{document.number}',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
            {
              name: 'customerName',
              type: 'text',
              content: '{customer.name}',
              position: { x: 20, y: 35 },
              width: 100,
              height: 10,
            },
            {
              name: 'totalAmount',
              type: 'text',
              content: '{totals.total}',
              position: { x: 20, y: 50 },
              width: 80,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createValid = await request('POST', '/templates', validTemplate);
  assert('Valid template created', createValid.status === 201 || createValid.status === 200, 'got ' + createValid.status);
  const validId = createValid.body && createValid.body.id;

  // Validate - should have no errors (all fields exist in invoice schema)
  const validateValid = await request('POST', '/templates/' + validId + '/validate');
  assert('Valid template validates', validateValid.status === 200, 'got ' + validateValid.status);
  assert('Valid template is valid', validateValid.body.valid === true, 'errors: ' + JSON.stringify(validateValid.body.errors));
  assert('No orphaned elements on valid template', !validateValid.body.orphanedElements || validateValid.body.orphanedElements.length === 0);

  // --- Phase 2: Create template with orphaned field bindings (single curly) ---
  console.log('\n--- Phase 2: Template with orphaned single-curly bindings ---');
  const orphanedTemplate = {
    name: 'Orphaned Invoice 386',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'invoiceNumber',
              type: 'text',
              content: '{document.number}',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
            {
              name: 'deletedField',
              type: 'text',
              content: '{customer.faxNumber}',
              position: { x: 20, y: 35 },
              width: 100,
              height: 10,
            },
            {
              name: 'anotherDeleted',
              type: 'text',
              content: '{vendor.taxId}',
              position: { x: 20, y: 50 },
              width: 80,
              height: 10,
            },
            {
              name: 'validField',
              type: 'text',
              content: '{totals.total}',
              position: { x: 20, y: 65 },
              width: 80,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createOrphaned = await request('POST', '/templates', orphanedTemplate);
  assert('Orphaned template created', createOrphaned.status === 201 || createOrphaned.status === 200, 'got ' + createOrphaned.status);
  const orphanedId = createOrphaned.body && createOrphaned.body.id;

  // Validate - should detect orphaned elements
  const validateOrphaned = await request('POST', '/templates/' + orphanedId + '/validate');
  assert('Validation returns 200', validateOrphaned.status === 200, 'got ' + validateOrphaned.status);
  assert('Template is not valid', validateOrphaned.body.valid === false, 'valid=' + validateOrphaned.body.valid);

  // Check errors include orphaned element warnings
  const errors = validateOrphaned.body.errors || [];
  console.log('  Errors:', JSON.stringify(errors, null, 2));
  const orphanErrors = errors.filter(function(e) { return e.message && e.message.includes('Orphaned element'); });
  assert('At least 2 orphaned element errors', orphanErrors.length >= 2, 'got ' + orphanErrors.length);

  // Check that specific orphaned fields are identified
  const hasFaxNumber = orphanErrors.some(function(e) { return e.message.includes('customer.faxNumber'); });
  const hasTaxId = orphanErrors.some(function(e) { return e.message.includes('vendor.taxId'); });
  assert('customer.faxNumber identified as orphaned', hasFaxNumber, 'not found in errors');
  assert('vendor.taxId identified as orphaned', hasTaxId, 'not found in errors');

  // Check that valid fields are NOT in the orphaned errors
  const hasTotal = orphanErrors.some(function(e) { return e.message.includes('totals.total'); });
  const hasDocNumber = orphanErrors.some(function(e) { return e.message.includes('document.number'); });
  assert('totals.total NOT orphaned', !hasTotal, 'should not be in errors');
  assert('document.number NOT orphaned', !hasDocNumber, 'should not be in errors');

  // Check orphanedElements array in response
  const orphanedList = validateOrphaned.body.orphanedElements || [];
  assert('orphanedElements array present', orphanedList.length >= 2, 'got ' + orphanedList.length);
  if (orphanedList.length > 0) {
    assert('Orphaned element has element name', !!orphanedList[0].element, 'no element name');
    assert('Orphaned element has field path', !!orphanedList[0].field, 'no field path');
    assert('Orphaned element has binding', !!orphanedList[0].binding, 'no binding');
  }

  // --- Phase 3: Template with orphaned double-curly bindings ---
  console.log('\n--- Phase 3: Template with orphaned double-curly bindings ---');
  const doubleCurlyTemplate = {
    name: 'Double Curly Orphaned 386',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'validElement',
              type: 'text',
              content: '{{document.number}}',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            },
            {
              name: 'orphanedElement',
              type: 'text',
              content: '{{deleted.field}}',
              position: { x: 20, y: 35 },
              width: 100,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createDC = await request('POST', '/templates', doubleCurlyTemplate);
  assert('Double-curly template created', createDC.status === 201 || createDC.status === 200);
  const dcId = createDC.body && createDC.body.id;

  const validateDC = await request('POST', '/templates/' + dcId + '/validate');
  assert('DC validation returns 200', validateDC.status === 200);
  assert('DC template not valid', validateDC.body.valid === false);

  const dcErrors = (validateDC.body.errors || []).filter(function(e) { return e.message && (e.message.includes('Unresolvable') || e.message.includes('Orphaned')); });
  assert('Double-curly orphaned binding detected', dcErrors.length >= 1, 'got ' + dcErrors.length);
  const hasDCBinding = dcErrors.some(function(e) { return e.message.includes('deleted.field'); });
  assert('deleted.field identified in DC errors', hasDCBinding);

  // orphanedElements should include double-curly orphans too
  const dcOrphans = validateDC.body.orphanedElements || [];
  assert('DC orphanedElements array present', dcOrphans.length >= 1, 'got ' + dcOrphans.length);

  // --- Phase 4: Template with mixed valid and orphaned ---
  console.log('\n--- Phase 4: Mixed template - specific elements identified ---');
  const mixedTemplate = {
    name: 'Mixed Bindings 386',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'header',
              type: 'text',
              content: 'INVOICE',
              position: { x: 20, y: 10 },
              width: 100,
              height: 15,
            },
            {
              name: 'invNumber',
              type: 'text',
              content: '{document.number}',
              position: { x: 20, y: 30 },
              width: 100,
              height: 10,
            },
            {
              name: 'orphanedTaxCode',
              type: 'text',
              content: '{invoice.taxCode}',
              position: { x: 20, y: 45 },
              width: 80,
              height: 10,
            }
          ]
        },
        {
          elements: [
            {
              name: 'page2Orphan',
              type: 'text',
              content: '{customer.website}',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createMixed = await request('POST', '/templates', mixedTemplate);
  assert('Mixed template created', createMixed.status === 201 || createMixed.status === 200);
  const mixedId = createMixed.body && createMixed.body.id;

  const validateMixed = await request('POST', '/templates/' + mixedId + '/validate');
  assert('Mixed validation returns 200', validateMixed.status === 200);

  const mixedOrphans = validateMixed.body.orphanedElements || [];
  console.log('  Orphaned elements:', JSON.stringify(mixedOrphans));

  // Verify that specific elements are identified (not just generic positions)
  assert('Mixed: orphaned elements found', mixedOrphans.length >= 2, 'got ' + mixedOrphans.length);

  // Check that orphaned elements reference the correct element names
  const orphanNames = mixedOrphans.map(function(o) { return o.element; });
  const orphanBindings = mixedOrphans.map(function(o) { return o.binding; });
  assert('invoice.taxCode binding identified', orphanBindings.includes('invoice.taxCode'), 'bindings: ' + orphanBindings.join(', '));
  assert('customer.website binding identified', orphanBindings.includes('customer.website'), 'bindings: ' + orphanBindings.join(', '));

  // Verify valid elements are NOT in orphaned list
  const nonOrphanBindings = ['document.number'];
  for (var i = 0; i < nonOrphanBindings.length; i++) {
    assert(nonOrphanBindings[i] + ' not orphaned', !orphanBindings.includes(nonOrphanBindings[i]));
  }

  // --- Phase 5: Custom type templates skip field validation ---
  console.log('\n--- Phase 5: Custom type skips orphan check ---');
  const customTemplate = {
    name: 'Custom Type 386',
    type: 'custom',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'anyField',
              type: 'text',
              content: '{whatever.field}',
              position: { x: 20, y: 20 },
              width: 100,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createCustom = await request('POST', '/templates', customTemplate);
  assert('Custom template created', createCustom.status === 201 || createCustom.status === 200);
  const customId = createCustom.body && createCustom.body.id;

  const validateCustom = await request('POST', '/templates/' + customId + '/validate');
  assert('Custom type validates', validateCustom.status === 200);
  // Custom types have no field schema, so no orphan detection
  assert('Custom type has no orphaned elements', !validateCustom.body.orphanedElements || validateCustom.body.orphanedElements.length === 0);

  // --- Phase 6: Static content not flagged ---
  console.log('\n--- Phase 6: Static content not flagged ---');
  const staticTemplate = {
    name: 'Static Content 386',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'header',
              type: 'text',
              content: 'INVOICE - No bindings here',
              position: { x: 20, y: 20 },
              width: 100,
              height: 15,
            },
            {
              name: 'validBinding',
              type: 'text',
              content: '{customer.name}',
              position: { x: 20, y: 40 },
              width: 100,
              height: 10,
            }
          ]
        }
      ]
    }
  };

  const createStatic = await request('POST', '/templates', staticTemplate);
  const staticId = createStatic.body && createStatic.body.id;

  const validateStatic = await request('POST', '/templates/' + staticId + '/validate');
  assert('Static content template valid', validateStatic.body.valid === true, 'errors: ' + JSON.stringify(validateStatic.body.errors));
  assert('No orphaned elements for static', !validateStatic.body.orphanedElements || validateStatic.body.orphanedElements.length === 0);

  // --- Summary ---
  console.log('\n=== Results: ' + passed + '/' + total + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
