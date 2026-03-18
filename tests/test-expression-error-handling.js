/**
 * Tests for Feature #157: Expression error handling configurable
 *
 * Tests that expression evaluation errors can be handled per configuration:
 * - 'emptyString': shows blank on error
 * - '#ERROR': shows #ERROR text on error (default)
 * - 'fail': render fails with descriptive message
 */

const http = require('http');

const BASE_URL = process.env.API_BASE || 'http://localhost:3001';
let PASS = 0;
let FAIL = 0;

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-err-157', 'org-err-157', [
  'template:edit', 'template:publish', 'render:trigger'
]);

function assert(desc, condition) {
  if (condition) {
    PASS++;
    console.log('  PASS:', desc);
  } else {
    FAIL++;
    console.log('  FAIL:', desc);
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
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

// Register ts-node for direct imports
try {
  require('ts-node').register({ transpileOnly: true, project: './nest-module/tsconfig.json' });
} catch (e) {
  console.log('ts-node registration:', e.message);
}

async function main() {
  console.log('=== Feature #157: Expression Error Handling Configurable ===\n');

  // -------- PART 1: Direct unit tests of evaluateCalculatedField --------
  console.log('--- Part 1: Direct Unit Tests ---\n');

  let evaluateCalculatedField;
  let resolveCalculatedFields;
  try {
    const mod = require('../packages/erp-schemas/src/calculated-field');
    evaluateCalculatedField = mod.evaluateCalculatedField;
    resolveCalculatedFields = mod.resolveCalculatedFields;
  } catch (e) {
    console.log('Failed to import calculated-field module:', e.message);
    process.exit(1);
  }

  // Test 1: Division by zero with default onError -> '#ERROR'
  console.log('Test 1: Division by zero with default onError -> #ERROR');
  {
    const result = evaluateCalculatedField('100 / 0', {});
    assert(`Default error mode returns '#ERROR': got '${result}'`, result === '#ERROR');
  }

  // Test 2: Division by zero with onError='emptyString' -> ''
  console.log('\nTest 2: Division by zero with onError=emptyString -> blank');
  {
    const result = evaluateCalculatedField('100 / 0', {}, undefined, undefined, 'emptyString');
    assert(`emptyString mode returns empty string: got '${result}'`, result === '');
  }

  // Test 3: Division by zero with onError='#ERROR' -> '#ERROR'
  console.log('\nTest 3: Division by zero with onError=#ERROR -> #ERROR');
  {
    const result = evaluateCalculatedField('100 / 0', {}, undefined, undefined, '#ERROR');
    assert(`#ERROR mode returns '#ERROR': got '${result}'`, result === '#ERROR');
  }

  // Test 4: Division by zero with onError='fail' -> throws
  console.log('\nTest 4: Division by zero with onError=fail -> throws');
  {
    let threw = false;
    let errorMsg = '';
    try {
      evaluateCalculatedField('100 / 0', {}, undefined, undefined, 'fail');
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert(`fail mode throws an error`, threw);
    assert(`Error message contains 'Calculated field expression error': ${errorMsg}`,
           errorMsg.includes('Calculated field expression error'));
  }

  // Test 5: Invalid expression with emptyString -> ''
  console.log('\nTest 5: Invalid/unknown function with emptyString');
  {
    const result = evaluateCalculatedField('UNKNOWN_FUNC(5)', {}, undefined, undefined, 'emptyString');
    assert(`Invalid function returns empty string: got '${result}'`, result === '');
  }

  // Test 6: Invalid expression with #ERROR -> '#ERROR'
  console.log('\nTest 6: Invalid/unknown function with #ERROR');
  {
    const result = evaluateCalculatedField('UNKNOWN_FUNC(5)', {}, undefined, undefined, '#ERROR');
    assert(`Invalid function returns '#ERROR': got '${result}'`, result === '#ERROR');
  }

  // Test 7: Invalid expression with fail -> throws
  console.log('\nTest 7: Invalid/unknown function with fail -> throws');
  {
    let threw = false;
    try {
      evaluateCalculatedField('UNKNOWN_FUNC(5)', {}, undefined, undefined, 'fail');
    } catch (e) {
      threw = true;
    }
    assert(`Invalid function with fail mode throws`, threw);
  }

  // Test 8: Valid expression works normally regardless of error mode
  console.log('\nTest 8: Valid expression works with all error modes');
  {
    const r1 = evaluateCalculatedField('10 + 5', {}, undefined, undefined, 'emptyString');
    const r2 = evaluateCalculatedField('10 + 5', {}, undefined, undefined, '#ERROR');
    const r3 = evaluateCalculatedField('10 + 5', {}, undefined, undefined, 'fail');
    assert(`emptyString mode: 10+5 = '${r1}'`, r1 === '15');
    assert(`#ERROR mode: 10+5 = '${r2}'`, r2 === '15');
    assert(`fail mode: 10+5 = '${r3}'`, r3 === '15');
  }

  // Test 9: Division by zero with format pattern + emptyString
  console.log('\nTest 9: Division by zero with format + emptyString');
  {
    const result = evaluateCalculatedField('100 / 0', {}, '#,##0.00', undefined, 'emptyString');
    assert(`Format + emptyString returns empty: got '${result}'`, result === '');
  }

  // Test 10: Division by zero with format + #ERROR
  console.log('\nTest 10: Division by zero with format + #ERROR');
  {
    const result = evaluateCalculatedField('100 / 0', {}, '#,##0.00', undefined, '#ERROR');
    assert(`Format + #ERROR returns '#ERROR': got '${result}'`, result === '#ERROR');
  }

  // Test 11: Division by zero with format + fail
  console.log('\nTest 11: Division by zero with format + fail -> throws');
  {
    let threw = false;
    try {
      evaluateCalculatedField('100 / 0', {}, '#,##0.00', undefined, 'fail');
    } catch (e) {
      threw = true;
    }
    assert(`Format + fail mode throws`, threw);
  }

  // Test 12: onError from engineOptions as fallback
  console.log('\nTest 12: onError from engineOptions as fallback');
  {
    const result = evaluateCalculatedField('100 / 0', {}, undefined, { onError: 'emptyString' });
    assert(`engineOptions onError=emptyString works: got '${result}'`, result === '');
  }

  // Test 13: Per-field onError overrides engineOptions
  console.log('\nTest 13: Per-field onError overrides engineOptions');
  {
    const result = evaluateCalculatedField('100 / 0', {}, undefined, { onError: 'emptyString' }, '#ERROR');
    assert(`Per-field #ERROR overrides engineOptions emptyString: got '${result}'`, result === '#ERROR');
  }

  // -------- PART 2: resolveCalculatedFields integration --------
  console.log('\n--- Part 2: resolveCalculatedFields Integration ---\n');

  // Test 14: resolveCalculatedFields with onError=emptyString shows blank
  console.log('Test 14: resolveCalculatedFields with onError=emptyString');
  {
    const template = {
      basePdf: { width: 210, height: 297 },
      schemas: [[{
        type: 'calculatedField',
        name: 'total',
        expression: '100 / 0',
        onError: 'emptyString',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
      }]],
    };
    const inputs = [{}];
    const resolved = resolveCalculatedFields(template, inputs);
    const calcValue = resolved.inputs[0]['total'];
    assert(`Resolved value is empty: got '${calcValue}'`, calcValue === '');
  }

  // Test 15: resolveCalculatedFields with onError=#ERROR shows #ERROR
  console.log('\nTest 15: resolveCalculatedFields with onError=#ERROR');
  {
    const template = {
      basePdf: { width: 210, height: 297 },
      schemas: [[{
        type: 'calculatedField',
        name: 'total',
        expression: '100 / 0',
        onError: '#ERROR',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
      }]],
    };
    const inputs = [{}];
    const resolved = resolveCalculatedFields(template, inputs);
    const calcValue = resolved.inputs[0]['total'];
    assert(`Resolved value is '#ERROR': got '${calcValue}'`, calcValue === '#ERROR');
  }

  // Test 16: resolveCalculatedFields with onError=fail throws
  console.log('\nTest 16: resolveCalculatedFields with onError=fail throws');
  {
    const template = {
      basePdf: { width: 210, height: 297 },
      schemas: [[{
        type: 'calculatedField',
        name: 'total',
        expression: '100 / 0',
        onError: 'fail',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
      }]],
    };
    const inputs = [{}];
    let threw = false;
    let errorMsg = '';
    try {
      resolveCalculatedFields(template, inputs);
    } catch (e) {
      threw = true;
      errorMsg = e.message;
    }
    assert(`resolveCalculatedFields throws with fail mode`, threw);
    assert(`Error message is descriptive: ${errorMsg}`, errorMsg.includes('Calculated field expression error'));
  }

  // Test 17: resolveCalculatedFields with default onError (no onError field)
  console.log('\nTest 17: resolveCalculatedFields default onError (#ERROR)');
  {
    const template = {
      basePdf: { width: 210, height: 297 },
      schemas: [[{
        type: 'calculatedField',
        name: 'total',
        expression: '100 / 0',
        position: { x: 10, y: 10 },
        width: 100,
        height: 20,
      }]],
    };
    const inputs = [{}];
    const resolved = resolveCalculatedFields(template, inputs);
    const calcValue = resolved.inputs[0]['total'];
    assert(`Default (no onError) shows '#ERROR': got '${calcValue}'`, calcValue === '#ERROR');
  }

  // -------- PART 3: API integration tests --------
  console.log('\n--- Part 3: API Integration Tests ---\n');

  // Create a template for render testing
  console.log('Creating template for render tests...');
  const createResp = await request('POST', '/api/pdfme/templates', {
    type: 'invoice',
    name: 'Error Handling Test 157',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          type: 'calculatedField',
          name: 'calcDivZero',
          expression: '100 / 0',
          onError: 'emptyString',
          position: { x: 10, y: 10 },
          width: 100,
          height: 20,
          fontSize: 12,
        }
      ]],
    },
  });

  if (createResp.status === 201 || createResp.status === 200) {
    const templateId = createResp.body.id;
    console.log(`  Template created: ${templateId}`);

    // Publish template
    await request('POST', `/api/pdfme/templates/${templateId}/publish`, {});

    // Test 18: Render with onError=emptyString succeeds
    console.log('\nTest 18: API render with div/0 + emptyString succeeds');
    {
      const renderResp = await request('POST', '/api/pdfme/render/now', {
        templateId,
        entityId: 'entity-err-test-1',
        channel: 'print',
        inputs: [{ dummy: 'val' }],
      });
      assert(`Render with emptyString onError succeeds (status ${renderResp.status})`,
             renderResp.status === 200 || renderResp.status === 201);
    }

    // Create a template with onError=fail
    const createFail = await request('POST', '/api/pdfme/templates', {
      type: 'invoice',
      name: 'Error Handling Fail Test 157',
      schema: {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        schemas: [[
          {
            type: 'calculatedField',
            name: 'calcFail',
            expression: '100 / 0',
            onError: 'fail',
            position: { x: 10, y: 10 },
            width: 100,
            height: 20,
            fontSize: 12,
          }
        ]],
      },
    });

    if (createFail.status === 201 || createFail.status === 200) {
      const failTemplateId = createFail.body.id;
      await request('POST', `/api/pdfme/templates/${failTemplateId}/publish`, {});

      // Test 19: Render with onError=fail returns error
      console.log('\nTest 19: API render with div/0 + fail returns error');
      {
        const renderResp = await request('POST', '/api/pdfme/render/now', {
          templateId: failTemplateId,
          entityId: 'entity-err-test-2',
          channel: 'print',
          inputs: [{ dummy: 'val' }],
        });
        assert(`Render with fail onError returns error status (status ${renderResp.status})`,
               renderResp.status >= 400);
      }
    } else {
      console.log('  Could not create fail template, skipping API fail test');
    }
  } else {
    console.log('  Could not create template, skipping API tests');
    console.log('  Response:', JSON.stringify(createResp.body).substring(0, 200));
  }

  // -------- SUMMARY --------
  console.log(`\n========================================`);
  console.log(`Results: ${PASS} passed, ${FAIL} failed out of ${PASS + FAIL} tests`);
  console.log(`========================================\n`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
