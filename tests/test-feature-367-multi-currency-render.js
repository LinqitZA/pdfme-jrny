const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('user-367', 'org-367');

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

let passed = 0;
let failed = 0;
let total = 0;

function assert(name, condition, detail) {
  total++;
  if (condition) {
    passed++;
    process.stdout.write('PASS: ' + name + '\n');
  } else {
    failed++;
    process.stdout.write('FAIL: ' + name + (detail ? ' - ' + detail : '') + '\n');
  }
}

async function run() {
  process.stdout.write('=== Feature #367: Multi-currency document renders both currencies ===\n\n');

  // Step 1: Test the format-currency endpoint with dual currency config
  process.stdout.write('--- Testing format-currency API with dual currency ---\n');

  // Test 1: Basic dual currency below format (USD -> EUR)
  const dualBelow = await request('POST', '/render/format-currency', {
    value: 1000,
    currencyCode: 'USD',
    currencySymbol: '$',
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'EUR',
      targetCurrencySymbol: '€',
      exchangeRate: 0.92,
      format: 'below'
    }
  });

  assert('Dual currency format-currency returns 200', dualBelow.status === 200,
    'status=' + dualBelow.status);
  assert('Primary currency formatted correctly', dualBelow.body.formattedValue &&
    dualBelow.body.formattedValue.includes('$'),
    'value=' + dualBelow.body.formattedValue);
  assert('Primary currency formatted with correct amount', dualBelow.body.formattedValue &&
    dualBelow.body.formattedValue.includes('1,000.00'),
    'value=' + dualBelow.body.formattedValue);
  assert('Dual currency value present', !!dualBelow.body.dualCurrencyValue,
    'dualValue=' + dualBelow.body.dualCurrencyValue);
  assert('Dual currency value contains EUR symbol', dualBelow.body.dualCurrencyValue &&
    dualBelow.body.dualCurrencyValue.includes('€'),
    'dualValue=' + dualBelow.body.dualCurrencyValue);
  assert('Dual currency raw value is correct (1000 * 0.92 = 920)',
    Math.abs(dualBelow.body.dualCurrencyRaw - 920) < 0.01,
    'dualRaw=' + dualBelow.body.dualCurrencyRaw);
  assert('Below format uses newline separator', dualBelow.body.formattedValue &&
    dualBelow.body.formattedValue.includes('\n'),
    'value=' + JSON.stringify(dualBelow.body.formattedValue));

  // Test 2: Dual currency inline format (ZAR -> USD)
  const dualInline = await request('POST', '/render/format-currency', {
    value: 15000,
    currencyCode: 'ZAR',
    currencySymbol: 'R',
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'USD',
      targetCurrencySymbol: '$',
      exchangeRate: 0.055,
      format: 'inline'
    }
  });

  assert('Inline dual currency returns 200', dualInline.status === 200,
    'status=' + dualInline.status);
  assert('Primary ZAR value formatted', dualInline.body.formattedValue &&
    dualInline.body.formattedValue.includes('R'),
    'value=' + dualInline.body.formattedValue);
  assert('Inline format uses parentheses', dualInline.body.formattedValue &&
    dualInline.body.formattedValue.includes('(') && dualInline.body.formattedValue.includes(')'),
    'value=' + dualInline.body.formattedValue);
  assert('Inline format contains both currencies', dualInline.body.formattedValue &&
    dualInline.body.formattedValue.includes('R') && dualInline.body.formattedValue.includes('$'),
    'value=' + dualInline.body.formattedValue);
  assert('Dual currency raw for ZAR->USD correct (15000 * 0.055 = 825)',
    Math.abs(dualInline.body.dualCurrencyRaw - 825) < 0.01,
    'dualRaw=' + dualInline.body.dualCurrencyRaw);

  // Test 3: Dual currency with different decimal places
  const dualDecimals = await request('POST', '/render/format-currency', {
    value: 500.50,
    currencyCode: 'GBP',
    currencySymbol: '£',
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'JPY',
      targetCurrencySymbol: '¥',
      exchangeRate: 190.5,
      format: 'below',
      symbolPosition: 'before',
      decimalPlaces: 0
    }
  });

  assert('GBP->JPY dual currency returns 200', dualDecimals.status === 200);
  assert('JPY uses 0 decimal places', dualDecimals.body.dualCurrencyValue &&
    !dualDecimals.body.dualCurrencyValue.includes('.'),
    'dualValue=' + dualDecimals.body.dualCurrencyValue);
  assert('JPY converted value correct (500.50 * 190.5 ~= 95345)',
    Math.abs(dualDecimals.body.dualCurrencyRaw - 95345.25) < 1,
    'dualRaw=' + dualDecimals.body.dualCurrencyRaw);

  // Step 2: Create a template with multi-currency fields and render it
  process.stdout.write('\n--- Creating template with currency fields for rendering ---\n');

  const templateRes = await request('POST', '/templates', {
    name: 'MultiCurrency-367',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'MULTI-CURRENCY INVOICE' },
          { name: 'invoiceNo', type: 'text', position: { x: 20, y: 40 }, width: 80, height: 10, content: 'INV-367-001' },
          { name: 'subtotal', type: 'text', position: { x: 20, y: 60 }, width: 80, height: 10, content: 'Subtotal' },
          { name: 'vat', type: 'text', position: { x: 20, y: 75 }, width: 80, height: 10, content: 'VAT (15%)' },
          { name: 'total', type: 'text', position: { x: 20, y: 90 }, width: 80, height: 10, content: 'Total' },
          { name: 'foreignTotal', type: 'text', position: { x: 20, y: 105 }, width: 80, height: 10, content: 'Foreign Currency Total' },
          { name: 'exchangeRate', type: 'text', position: { x: 20, y: 120 }, width: 80, height: 10, content: 'Exchange Rate' }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Template created', templateRes.status === 201, 'status=' + templateRes.status);
  const templateId = templateRes.body && templateRes.body.id;

  if (!templateId) {
    process.stdout.write('Cannot continue without template ID\n');
    process.stdout.write('Response: ' + JSON.stringify(templateRes.body).substring(0, 300) + '\n');
    process.exit(1);
  }

  // Publish the template
  const publishRes = await request('POST', '/templates/' + templateId + '/publish', {});
  assert('Template published', publishRes.status === 200 || publishRes.status === 201,
    'status=' + publishRes.status);

  // Render with multi-currency data (foreign currency via input fields)
  const renderRes = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'INV-MULTICUR-001',
    channel: 'email',
    inputs: [{
      title: 'MULTI-CURRENCY INVOICE',
      invoiceNo: 'INV-367-001',
      subtotal: 'R 10,000.00',
      vat: 'R 1,500.00',
      total: 'R 11,500.00',
      foreignTotal: '$632.50 (USD)',
      exchangeRate: '1 USD = R 18.18'
    }]
  });

  assert('Multi-currency render succeeds', renderRes.status === 200 || renderRes.status === 201,
    'status=' + renderRes.status + ' body=' + JSON.stringify(renderRes.body).substring(0, 300));

  const doc = renderRes.body;
  assert('Render returns document info', !!(doc && (doc.document || doc.id)),
    'keys=' + (doc ? Object.keys(doc).join(',') : 'null'));

  if (doc && doc.document) {
    assert('Document has file path', !!(doc.document.filePath || doc.document.path),
      'doc=' + JSON.stringify(Object.keys(doc.document)));
    assert('Document status is done', doc.document.status === 'done',
      'status=' + doc.document.status);
  }

  // Step 3: Verify dual currency via format-currency with correct symbols
  process.stdout.write('\n--- Verifying dual currency symbol formatting ---\n');

  // Test with various symbol positions
  const afterSymbol = await request('POST', '/render/format-currency', {
    value: 2500,
    currencyCode: 'EUR',
    currencySymbol: '€',
    symbolPosition: 'after',
    thousandSeparator: '.',
    decimalSeparator: ',',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'GBP',
      targetCurrencySymbol: '£',
      exchangeRate: 0.86,
      format: 'below',
      symbolPosition: 'before'
    }
  });

  assert('After-symbol formatting correct', afterSymbol.status === 200);
  assert('EUR with after position shows number then symbol', afterSymbol.body.formattedValue &&
    afterSymbol.body.formattedValue.includes('2.500,00') &&
    afterSymbol.body.formattedValue.includes('€'),
    'value=' + JSON.stringify(afterSymbol.body.formattedValue));
  assert('GBP dual with before position shows symbol then number', afterSymbol.body.dualCurrencyValue &&
    afterSymbol.body.dualCurrencyValue.startsWith('£'),
    'dual=' + afterSymbol.body.dualCurrencyValue);

  // Test 4: Disabled dual currency still works (single currency only)
  const singleCurrency = await request('POST', '/render/format-currency', {
    value: 750,
    currencyCode: 'USD',
    currencySymbol: '$',
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: false,
      targetCurrencyCode: 'EUR',
      exchangeRate: 0.92
    }
  });

  assert('Disabled dual currency returns single value', singleCurrency.status === 200);
  assert('No dual currency value when disabled', !singleCurrency.body.dualCurrencyValue,
    'dual=' + singleCurrency.body.dualCurrencyValue);
  assert('Single currency formatted correctly', singleCurrency.body.formattedValue === '$750.00',
    'value=' + singleCurrency.body.formattedValue);

  // Test 5: Show currency code instead of symbol
  const withCode = await request('POST', '/render/format-currency', {
    value: 1234.56,
    currencyCode: 'USD',
    showCurrencyCode: true,
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'ZAR',
      exchangeRate: 18.18,
      format: 'inline'
    }
  });

  assert('Currency code mode returns 200', withCode.status === 200);
  assert('Shows USD code', withCode.body.formattedValue &&
    withCode.body.formattedValue.includes('USD'),
    'value=' + withCode.body.formattedValue);

  // Test 6: Large amounts with dual currency
  const largeAmount = await request('POST', '/render/format-currency', {
    value: 1234567.89,
    currencyCode: 'ZAR',
    currencySymbol: 'R',
    symbolPosition: 'before',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'USD',
      targetCurrencySymbol: '$',
      exchangeRate: 0.055,
      format: 'below'
    }
  });

  assert('Large dual currency amount renders', largeAmount.status === 200);
  assert('Large amount has thousand separators', largeAmount.body.formattedValue &&
    largeAmount.body.formattedValue.includes('1,234,567.89'),
    'value=' + JSON.stringify(largeAmount.body.formattedValue));
  assert('Dual large amount correctly converted',
    Math.abs(largeAmount.body.dualCurrencyRaw - 67901.23) < 1,
    'dualRaw=' + largeAmount.body.dualCurrencyRaw);

  // Test 7: Render with dual currency template via currencyField elements
  process.stdout.write('\n--- Creating template with currencyField elements ---\n');

  const currencyTemplateRes = await request('POST', '/templates', {
    name: 'DualCurrencyField-367',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      pages: [{
        elements: [
          { name: 'heading', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 15, content: 'DUAL CURRENCY INVOICE' },
          { name: 'subtotal', type: 'currencyField', position: { x: 120, y: 60 }, width: 70, height: 20,
            currencyCode: 'ZAR', currencySymbol: 'R', symbolPosition: 'before',
            thousandSeparator: ',', decimalSeparator: '.', decimalPlaces: 2,
            dualCurrency: {
              enabled: true,
              targetCurrencyCode: 'USD',
              targetCurrencySymbol: '$',
              exchangeRate: 0.055,
              format: 'below'
            }
          },
          { name: 'total', type: 'currencyField', position: { x: 120, y: 85 }, width: 70, height: 20,
            currencyCode: 'ZAR', currencySymbol: 'R', symbolPosition: 'before',
            thousandSeparator: ',', decimalSeparator: '.', decimalPlaces: 2,
            dualCurrency: {
              enabled: true,
              targetCurrencyCode: 'USD',
              targetCurrencySymbol: '$',
              exchangeRate: 0.055,
              format: 'inline'
            }
          }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });

  assert('Currency field template created', currencyTemplateRes.status === 201,
    'status=' + currencyTemplateRes.status);
  const currencyTemplateId = currencyTemplateRes.body && currencyTemplateRes.body.id;

  if (currencyTemplateId) {
    const pubRes = await request('POST', '/templates/' + currencyTemplateId + '/publish', {});
    assert('Currency field template published', pubRes.status === 200 || pubRes.status === 201);

    const currencyRenderRes = await request('POST', '/render/now', {
      templateId: currencyTemplateId,
      entityId: 'INV-DUAL-367',
      channel: 'email',
      inputs: [{
        heading: 'DUAL CURRENCY INVOICE',
        subtotal: '10000',
        total: '11500'
      }]
    });

    assert('Dual currency field render succeeds',
      currencyRenderRes.status === 200 || currencyRenderRes.status === 201,
      'status=' + currencyRenderRes.status + ' body=' + JSON.stringify(currencyRenderRes.body).substring(0, 300));

    if (currencyRenderRes.body && currencyRenderRes.body.document) {
      assert('Dual currency render has document', !!currencyRenderRes.body.document.id);
      assert('Dual currency render status is done', currencyRenderRes.body.document.status === 'done',
        'status=' + currencyRenderRes.body.document.status);
    }
  }

  // Summary
  process.stdout.write('\n=== RESULTS ===\n');
  process.stdout.write('Passed: ' + passed + '/' + total + '\n');
  process.stdout.write('Failed: ' + failed + '/' + total + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write('ERROR: ' + err.message + '\n');
  process.exit(1);
});
