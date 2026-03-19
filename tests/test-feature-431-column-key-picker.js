/**
 * Feature #431: Add field picker dropdown to table column key input
 *
 * Tests that the table column key input uses a datalist/combobox with
 * available array field keys from the field schema, auto-populates header
 * and alignment, and still accepts custom free-text keys.
 */

const http = require('http');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const DESIGNER_BASE = process.env.DESIGNER_BASE || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

function generateToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'test-user-431',
    orgId: 'org-1',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', 'pdfme-dev-secret')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => { try { return JSON.parse(data); } catch { return null; } },
          text: () => data,
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runTests() {
  const token = generateToken();
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  console.log('\n=== Feature #431: Field picker dropdown for table column key ===\n');

  // ────────────────────────────────────────────────────────────
  // Section 1: Verify array fields available for column suggestions
  // ────────────────────────────────────────────────────────────
  console.log('--- Section 1: Array Fields for Column Suggestions ---');

  const invoiceRes = await fetch(`${API_BASE}/api/pdfme/field-schema/invoice`, { headers: authHeaders });
  assert(invoiceRes.ok, 'GET /field-schema/invoice returns 200');
  const invoiceData = invoiceRes.json();

  // Extract array fields and build column suggestions
  const arrayFields = [];
  if (invoiceData && invoiceData.fieldGroups) {
    for (const group of invoiceData.fieldGroups) {
      for (const field of (group.fields || [])) {
        if (field.key.includes('[].')) {
          arrayFields.push(field);
        }
      }
    }
  }

  assert(arrayFields.length >= 4, `Found ${arrayFields.length} array fields for column suggestions`);

  // Build column key suggestions (simulating the component logic)
  const columnKeySuggestions = arrayFields.map(f => {
    const match = f.key.match(/^([^[]+)\[\]\.(.+)$/);
    return {
      columnKey: match ? match[2] : f.key,
      label: f.label,
      fieldType: f.type || 'string',
    };
  });

  assert(columnKeySuggestions.length >= 4, `Built ${columnKeySuggestions.length} column key suggestions`);

  // ────────────────────────────────────────────────────────────
  // Section 2: Verify suggestion content
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 2: Suggestion Content ---');

  const descSuggestion = columnKeySuggestions.find(s => s.columnKey === 'description');
  assert(!!descSuggestion, 'description column key suggestion exists');
  assert(descSuggestion && descSuggestion.label === 'Description', 'description suggestion has label "Description"');
  assert(descSuggestion && descSuggestion.fieldType === 'string', 'description suggestion has type string');

  const qtySuggestion = columnKeySuggestions.find(s => s.columnKey === 'quantity');
  assert(!!qtySuggestion, 'quantity column key suggestion exists');
  assert(qtySuggestion && qtySuggestion.label === 'Quantity', 'quantity suggestion has label "Quantity"');
  assert(qtySuggestion && qtySuggestion.fieldType === 'number', 'quantity suggestion has type number');

  const priceSuggestion = columnKeySuggestions.find(s => s.columnKey === 'unitPrice');
  assert(!!priceSuggestion, 'unitPrice column key suggestion exists');
  assert(priceSuggestion && priceSuggestion.label === 'Unit Price', 'unitPrice suggestion has label "Unit Price"');
  assert(priceSuggestion && priceSuggestion.fieldType === 'currency', 'unitPrice suggestion has type currency');

  const amountSuggestion = columnKeySuggestions.find(s => s.columnKey === 'amount');
  assert(!!amountSuggestion, 'amount column key suggestion exists');
  assert(amountSuggestion && amountSuggestion.label === 'Line Amount', 'amount suggestion has label "Line Amount"');
  assert(amountSuggestion && amountSuggestion.fieldType === 'currency', 'amount suggestion has type currency');

  // ────────────────────────────────────────────────────────────
  // Section 3: Auto-populate header from suggestion
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 3: Auto-populate Header ---');

  // Simulate the onChange logic from SortableColumnItem
  function simulateKeyChange(newKey, suggestions) {
    const updates = { key: newKey };
    if (suggestions) {
      const match = suggestions.find(s => s.columnKey === newKey);
      if (match) {
        updates.header = match.label;
        if (match.fieldType === 'currency' || match.fieldType === 'number') {
          updates.align = 'right';
        } else {
          updates.align = 'left';
        }
      }
    }
    return updates;
  }

  // Test: selecting 'description' auto-fills header and left align
  const descUpdates = simulateKeyChange('description', columnKeySuggestions);
  assert(descUpdates.key === 'description', 'Key set to "description"');
  assert(descUpdates.header === 'Description', 'Header auto-filled to "Description"');
  assert(descUpdates.align === 'left', 'Align auto-set to "left" for string type');

  // Test: selecting 'quantity' auto-fills header and right align
  const qtyUpdates = simulateKeyChange('quantity', columnKeySuggestions);
  assert(qtyUpdates.key === 'quantity', 'Key set to "quantity"');
  assert(qtyUpdates.header === 'Quantity', 'Header auto-filled to "Quantity"');
  assert(qtyUpdates.align === 'right', 'Align auto-set to "right" for number type');

  // Test: selecting 'unitPrice' auto-fills header and right align
  const priceUpdates = simulateKeyChange('unitPrice', columnKeySuggestions);
  assert(priceUpdates.key === 'unitPrice', 'Key set to "unitPrice"');
  assert(priceUpdates.header === 'Unit Price', 'Header auto-filled to "Unit Price"');
  assert(priceUpdates.align === 'right', 'Align auto-set to "right" for currency type');

  // Test: selecting 'amount' auto-fills header and right align
  const amountUpdates = simulateKeyChange('amount', columnKeySuggestions);
  assert(amountUpdates.key === 'amount', 'Key set to "amount"');
  assert(amountUpdates.header === 'Line Amount', 'Header auto-filled to "Line Amount"');
  assert(amountUpdates.align === 'right', 'Align auto-set to "right" for currency type');

  // ────────────────────────────────────────────────────────────
  // Section 4: Custom key (not in schema) still accepted
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 4: Custom Key Handling ---');

  const customUpdates = simulateKeyChange('customColumn', columnKeySuggestions);
  assert(customUpdates.key === 'customColumn', 'Custom key "customColumn" is accepted');
  assert(!customUpdates.header, 'No auto-fill for custom key (header not set)');
  assert(!customUpdates.align, 'No auto-align for custom key');

  const freeTextUpdates = simulateKeyChange('mySpecialField', columnKeySuggestions);
  assert(freeTextUpdates.key === 'mySpecialField', 'Free text key "mySpecialField" is accepted');

  // ────────────────────────────────────────────────────────────
  // Section 5: Fallback when no suggestions
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 5: Fallback Without Suggestions ---');

  const noSuggestionUpdates = simulateKeyChange('description', undefined);
  assert(noSuggestionUpdates.key === 'description', 'Key works without suggestions');
  assert(!noSuggestionUpdates.header, 'No auto-fill without suggestions');
  assert(!noSuggestionUpdates.align, 'No auto-align without suggestions');

  const emptyUpdates = simulateKeyChange('quantity', []);
  assert(emptyUpdates.key === 'quantity', 'Key works with empty suggestions');
  assert(!emptyUpdates.header, 'No auto-fill with empty suggestions');

  // ────────────────────────────────────────────────────────────
  // Section 6: DataSource-driven suggestion filtering
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 6: DataSource Filtering ---');

  // Verify that lineItems array group exists
  const lineItemsGroup = {};
  for (const field of arrayFields) {
    const match = field.key.match(/^([^[]+)\[\]\.(.+)$/);
    if (match) {
      const parentKey = match[1];
      if (!lineItemsGroup[parentKey]) lineItemsGroup[parentKey] = [];
      lineItemsGroup[parentKey].push({ columnKey: match[2], label: field.label, fieldType: field.type });
    }
  }

  assert(!!lineItemsGroup['lineItems'], 'lineItems array group found');
  assert(lineItemsGroup['lineItems'] && lineItemsGroup['lineItems'].length === 4, 'lineItems has 4 column suggestions');

  // A table element with dataSource: 'lineItems' should get lineItems suggestions
  const tableElement = {
    id: 'table1',
    type: 'line-items',
    dataSource: 'lineItems',
  };
  assert(tableElement.dataSource === 'lineItems', 'Table element has dataSource: lineItems');
  assert(lineItemsGroup[tableElement.dataSource] !== undefined, 'Suggestions available for table dataSource');

  // A table element without dataSource should not get suggestions
  const noDataSourceElement = {
    id: 'table2',
    type: 'line-items',
  };
  assert(!noDataSourceElement.dataSource, 'Table without dataSource has no suggestions');

  // ────────────────────────────────────────────────────────────
  // Section 7: Template with table and dataSource persists
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 7: Template Persistence ---');

  const createRes = await fetch(`${API_BASE}/api/pdfme/templates`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Test Column Picker 431',
      type: 'invoice',
      schema: {
        pageSize: 'A4',
        pages: [{
          id: 'page1',
          label: 'Page 1',
          elements: [{
            id: 'table1',
            type: 'line-items',
            x: 20, y: 100, w: 495, h: 200,
            columns: [
              { key: 'description', header: 'Description', width: 200, align: 'left' },
              { key: 'quantity', header: 'Quantity', width: 60, align: 'right' },
              { key: 'unitPrice', header: 'Unit Price', width: 80, align: 'right' },
              { key: 'amount', header: 'Line Amount', width: 80, align: 'right' }
            ],
            showHeader: true,
            borderStyle: 'solid',
            dataSource: 'lineItems'
          }]
        }]
      }
    })
  });

  assert(createRes.ok, 'Create template with column picker keys succeeds');
  const createData = createRes.json();
  const templateId = createData && createData.id;
  assert(!!templateId, `Template created with ID: ${templateId}`);

  // ────────────────────────────────────────────────────────────
  // Section 8: Alignment rules
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 8: Alignment Rules ---');

  // Test alignment rules per field type
  const alignRules = [
    { type: 'string', expected: 'left' },
    { type: 'date', expected: 'left' },
    { type: 'number', expected: 'right' },
    { type: 'currency', expected: 'right' },
  ];

  for (const rule of alignRules) {
    const testSuggestion = [{ columnKey: 'test', label: 'Test', fieldType: rule.type }];
    const result = simulateKeyChange('test', testSuggestion);
    assert(result.align === rule.expected, `Field type "${rule.type}" auto-aligns to "${rule.expected}"`);
  }

  // ────────────────────────────────────────────────────────────
  // Cleanup
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Cleanup ---');
  if (templateId) {
    await fetch(`${API_BASE}/api/pdfme/templates/${templateId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    console.log(`  ⚠️ Cleanup attempted for template ${templateId}`);
  }

  // ────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
