/**
 * Test script for Feature #190: Multi-currency field displays correctly
 */
const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg}\n`);
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${JWT}`,
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

async function run() {
  process.stdout.write('=== Feature #190: Multi-currency field displays correctly ===\n\n');

  // Test 1: USD formatting with default symbol
  process.stdout.write('Test 1: USD formatting\n');
  const r1 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1234.56,
    currencyCode: 'USD',
  });
  process.stdout.write(`  Status: ${r1.status}, Result: ${JSON.stringify(r1.body)}\n`);
  assert(r1.status === 200, 'Status is 200');
  assert(r1.body.formattedValue && r1.body.formattedValue.includes('$'), 'Contains $ symbol');
  assert(r1.body.formattedValue && r1.body.formattedValue.includes('1,234.56'), 'Contains formatted number 1,234.56');
  assert(r1.body.currencyCode === 'USD', 'Currency code is USD');
  assert(r1.body.currencySymbol === '$', 'Currency symbol is $');
  assert(r1.body.rawValue === 1234.56, 'Raw value preserved');

  // Test 2: ZAR formatting with R symbol
  process.stdout.write('\nTest 2: ZAR formatting\n');
  const r2 = await request('POST', `${BASE}/render/format-currency`, {
    value: 15999.99,
    currencyCode: 'ZAR',
    thousandSeparator: ' ',
  });
  process.stdout.write(`  Status: ${r2.status}, Result: ${JSON.stringify(r2.body)}\n`);
  assert(r2.status === 200, 'Status is 200');
  assert(r2.body.formattedValue && r2.body.formattedValue.includes('R'), 'Contains R symbol');
  assert(r2.body.formattedValue && r2.body.formattedValue.includes('15 999.99'), 'Space as thousand separator');
  assert(r2.body.currencySymbol === 'R', 'Currency symbol is R');

  // Test 3: EUR with symbol after
  process.stdout.write('\nTest 3: EUR symbol position after\n');
  const r3 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1500.00,
    currencyCode: 'EUR',
    symbolPosition: 'after',
  });
  process.stdout.write(`  Status: ${r3.status}, Result: ${JSON.stringify(r3.body)}\n`);
  assert(r3.status === 200, 'Status is 200');
  const fv3 = r3.body.formattedValue || '';
  assert(fv3.endsWith('€') || fv3.endsWith('€ ') || fv3.includes(' €'), 'EUR symbol is after the number');
  assert(r3.body.currencySymbol === '€', 'Currency symbol is euro sign');

  // Test 4: Custom decimal places (0)
  process.stdout.write('\nTest 4: Custom decimal places (0)\n');
  const r4 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1234.56,
    currencyCode: 'JPY',
    decimalPlaces: 0,
  });
  process.stdout.write(`  Status: ${r4.status}, Result: ${JSON.stringify(r4.body)}\n`);
  assert(r4.status === 200, 'Status is 200');
  assert(r4.body.formattedValue && !r4.body.formattedValue.includes('.'), 'No decimal point for JPY');

  // Test 5: Custom currency symbol
  process.stdout.write('\nTest 5: Custom currency symbol\n');
  const r5 = await request('POST', `${BASE}/render/format-currency`, {
    value: 500.00,
    currencyCode: 'XYZ',
    currencySymbol: 'XY$',
  });
  process.stdout.write(`  Status: ${r5.status}, Result: ${JSON.stringify(r5.body)}\n`);
  assert(r5.status === 200, 'Status is 200');
  assert(r5.body.formattedValue && r5.body.formattedValue.includes('XY$'), 'Uses custom symbol');
  assert(r5.body.currencySymbol === 'XY$', 'Symbol stored as XY$');

  // Test 6: Show currency code instead of symbol
  process.stdout.write('\nTest 6: Show currency code\n');
  const r6 = await request('POST', `${BASE}/render/format-currency`, {
    value: 250.00,
    currencyCode: 'GBP',
    showCurrencyCode: true,
  });
  process.stdout.write(`  Status: ${r6.status}, Result: ${JSON.stringify(r6.body)}\n`);
  assert(r6.status === 200, 'Status is 200');
  assert(r6.body.formattedValue && r6.body.formattedValue.includes('GBP'), 'Shows GBP code');

  // Test 7: Negative values
  process.stdout.write('\nTest 7: Negative value\n');
  const r7 = await request('POST', `${BASE}/render/format-currency`, {
    value: -750.25,
    currencyCode: 'USD',
  });
  process.stdout.write(`  Status: ${r7.status}, Result: ${JSON.stringify(r7.body)}\n`);
  assert(r7.status === 200, 'Status is 200');
  assert(r7.body.formattedValue && r7.body.formattedValue.includes('-'), 'Contains negative sign');
  assert(r7.body.formattedValue && r7.body.formattedValue.includes('750.25'), 'Contains absolute value');

  // Test 8: Dual currency - inline format
  process.stdout.write('\nTest 8: Dual currency inline\n');
  const r8 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1000,
    currencyCode: 'USD',
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'ZAR',
      exchangeRate: 18.50,
      format: 'inline',
    },
  });
  process.stdout.write(`  Status: ${r8.status}, Result: ${JSON.stringify(r8.body)}\n`);
  assert(r8.status === 200, 'Status is 200');
  assert(r8.body.formattedValue && r8.body.formattedValue.includes('$'), 'Contains USD symbol');
  assert(r8.body.formattedValue && r8.body.formattedValue.includes('R'), 'Contains ZAR symbol');
  assert(r8.body.formattedValue && r8.body.formattedValue.includes('('), 'Inline uses parentheses');
  assert(r8.body.dualCurrencyRaw === 18500, 'Dual value is 1000 * 18.50 = 18500');
  assert(r8.body.dualCurrencyValue && r8.body.dualCurrencyValue.includes('R'), 'Dual formatted includes R');

  // Test 9: Dual currency - below format
  process.stdout.write('\nTest 9: Dual currency below\n');
  const r9 = await request('POST', `${BASE}/render/format-currency`, {
    value: 500,
    currencyCode: 'USD',
    dualCurrency: {
      enabled: true,
      targetCurrencyCode: 'EUR',
      exchangeRate: 0.92,
      format: 'below',
    },
  });
  process.stdout.write(`  Status: ${r9.status}, Result: ${JSON.stringify(r9.body)}\n`);
  assert(r9.status === 200, 'Status is 200');
  assert(r9.body.formattedValue && r9.body.formattedValue.includes('\n'), 'Below format uses newline');
  assert(r9.body.dualCurrencyRaw !== undefined, 'Dual currency raw value present');

  // Test 10: Zero value
  process.stdout.write('\nTest 10: Zero value\n');
  const r10 = await request('POST', `${BASE}/render/format-currency`, {
    value: 0,
    currencyCode: 'USD',
  });
  process.stdout.write(`  Status: ${r10.status}, Result: ${JSON.stringify(r10.body)}\n`);
  assert(r10.status === 200, 'Status is 200');
  assert(r10.body.formattedValue && r10.body.formattedValue.includes('0.00'), 'Zero formatted as 0.00');
  assert(r10.body.rawValue === 0, 'Raw value is 0');

  // Test 11: Large number formatting
  process.stdout.write('\nTest 11: Large number\n');
  const r11 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1234567890.12,
    currencyCode: 'USD',
  });
  process.stdout.write(`  Status: ${r11.status}, Result: ${JSON.stringify(r11.body)}\n`);
  assert(r11.status === 200, 'Status is 200');
  assert(r11.body.formattedValue && r11.body.formattedValue.includes(','), 'Has thousand separators');

  // Test 12: Dual currency disabled
  process.stdout.write('\nTest 12: Dual currency disabled\n');
  const r12 = await request('POST', `${BASE}/render/format-currency`, {
    value: 100,
    currencyCode: 'USD',
    dualCurrency: {
      enabled: false,
      targetCurrencyCode: 'EUR',
      exchangeRate: 0.92,
    },
  });
  process.stdout.write(`  Status: ${r12.status}, Result: ${JSON.stringify(r12.body)}\n`);
  assert(r12.status === 200, 'Status is 200');
  assert(!r12.body.dualCurrencyValue, 'No dual currency when disabled');
  assert(!r12.body.formattedValue.includes('\n'), 'No newline when dual disabled');

  // Test 13: Custom decimal separator
  process.stdout.write('\nTest 13: Custom decimal separator (comma)\n');
  const r13 = await request('POST', `${BASE}/render/format-currency`, {
    value: 1234.56,
    currencyCode: 'EUR',
    decimalSeparator: ',',
    thousandSeparator: '.',
  });
  process.stdout.write(`  Status: ${r13.status}, Result: ${JSON.stringify(r13.body)}\n`);
  assert(r13.status === 200, 'Status is 200');
  assert(r13.body.formattedValue && r13.body.formattedValue.includes(',56'), 'Uses comma as decimal sep');
  assert(r13.body.formattedValue && r13.body.formattedValue.includes('1.234'), 'Uses dot as thousand sep');

  // Test 14: Missing value returns 400
  process.stdout.write('\nTest 14: Missing value\n');
  const r14 = await request('POST', `${BASE}/render/format-currency`, {
    currencyCode: 'USD',
  });
  process.stdout.write(`  Status: ${r14.status}\n`);
  assert(r14.status === 400, 'Returns 400 for missing value');

  // Test 15: Render with currency field in template
  process.stdout.write('\nTest 15: Create template with currencyField and render\n');
  const tmpl = await request('POST', `${BASE}/templates`, {
    name: 'Currency Test Template CURR190',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'totalAmount',
          type: 'currencyField',
          currencyCode: 'USD',
          symbolPosition: 'before',
          decimalPlaces: 2,
          position: { x: 100, y: 100 },
          width: 80,
          height: 15,
          fontSize: 14,
          alignment: 'right',
        },
        {
          name: 'foreignAmount',
          type: 'currencyField',
          currencyCode: 'EUR',
          symbolPosition: 'after',
          decimalPlaces: 2,
          dualCurrency: {
            enabled: true,
            targetCurrencyCode: 'USD',
            exchangeRate: 1.09,
            format: 'inline',
          },
          position: { x: 100, y: 120 },
          width: 80,
          height: 15,
          fontSize: 12,
          alignment: 'right',
        },
      ]],
      columns: [],
      sampledata: [{}],
    },
  });
  process.stdout.write(`  Template create status: ${tmpl.status}\n`);
  assert(tmpl.status === 201 || tmpl.status === 200, 'Template created');

  if (tmpl.body && tmpl.body.id) {
    // Publish the template
    const pub = await request('POST', `${BASE}/templates/${tmpl.body.id}/publish`, {});
    process.stdout.write(`  Publish status: ${pub.status}\n`);
    assert(pub.status === 200 || pub.status === 201, 'Template published');

    // Render with currency data
    const render = await request('POST', `${BASE}/render/now`, {
      templateId: tmpl.body.id,
      entityId: 'curr-test-190',
      channel: 'print',
      inputs: [{ totalAmount: '2500.75', foreignAmount: '1500.00' }],
    });
    process.stdout.write(`  Render status: ${render.status}\n`);
    if (render.body && typeof render.body === 'object') {
      process.stdout.write(`  Render result: ${JSON.stringify(render.body).substring(0, 200)}\n`);
    }
    assert(render.status === 200 || render.status === 201, 'Render succeeded');
    const hasDocId = render.body && (render.body.documentId || render.body.id || render.body.filePath || (render.body.document && render.body.document.id));
    assert(hasDocId, 'Document reference returned');

    // Cleanup
    await request('DELETE', `${BASE}/templates/${tmpl.body.id}`, null);
  }

  // Test 16: Known currency symbols
  process.stdout.write('\nTest 16: GBP pound symbol\n');
  const r16 = await request('POST', `${BASE}/render/format-currency`, {
    value: 99.99,
    currencyCode: 'GBP',
  });
  assert(r16.status === 200, 'Status is 200');
  assert(r16.body.currencySymbol === '\u00a3', 'GBP symbol is pound sign');

  process.stdout.write('\nTest 17: INR rupee symbol\n');
  const r17 = await request('POST', `${BASE}/render/format-currency`, {
    value: 50000,
    currencyCode: 'INR',
  });
  assert(r17.status === 200, 'Status is 200');
  assert(r17.body.currencySymbol === '\u20b9', 'INR symbol is rupee sign');

  // Summary
  process.stdout.write(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write(`Error: ${err.message}\n`);
  process.exit(1);
});
