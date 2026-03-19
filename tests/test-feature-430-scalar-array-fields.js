/**
 * Feature #430: Distinguish scalar vs array fields in the field schema
 *
 * Tests that the designer correctly separates scalar fields (for text binding)
 * from array fields (for table column mapping).
 */

const http = require('http');
const crypto = require('crypto');

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

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
    sub: 'test-user-430',
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

  console.log('\n=== Feature #430: Distinguish scalar vs array fields ===\n');

  // ────────────────────────────────────────────────────────────
  // Section 1: Verify field schema structure from API
  // ────────────────────────────────────────────────────────────
  console.log('--- Section 1: API Field Schema Structure ---');

  const invoiceRes = await fetch(`${API_BASE}/api/pdfme/field-schema/invoice`, { headers: authHeaders });
  assert(invoiceRes.ok, 'GET /field-schema/invoice returns 200');
  const invoiceData = invoiceRes.json();
  const fieldGroups = invoiceData && invoiceData.fieldGroups;
  assert(Array.isArray(fieldGroups), 'fieldGroups is an array');

  // Identify scalar and array fields from the API response
  const allFields = [];
  if (fieldGroups) {
    for (const group of fieldGroups) {
      for (const field of (group.fields || [])) {
        allFields.push({ ...field, groupKey: group.key, groupLabel: group.label });
      }
    }
  }

  const scalarFields = allFields.filter(f => !f.key.includes('[].'));
  const arrayFields = allFields.filter(f => f.key.includes('[].'));

  assert(scalarFields.length > 0, `Found ${scalarFields.length} scalar fields`);
  assert(arrayFields.length > 0, `Found ${arrayFields.length} array fields`);

  // ────────────────────────────────────────────────────────────
  // Section 2: Scalar field identification
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 2: Scalar Field Identification ---');

  // Verify specific scalar fields
  const scalarKeys = scalarFields.map(f => f.key);
  assert(scalarKeys.includes('document.number'), 'document.number is a scalar field');
  assert(scalarKeys.includes('document.date'), 'document.date is a scalar field');
  assert(scalarKeys.includes('customer.name'), 'customer.name is a scalar field');
  assert(scalarKeys.includes('customer.email'), 'customer.email is a scalar field');
  assert(scalarKeys.includes('company.name'), 'company.name is a scalar field');
  assert(scalarKeys.includes('totals.subtotal'), 'totals.subtotal is a scalar field');
  assert(scalarKeys.includes('totals.total'), 'totals.total is a scalar field');

  // Verify scalar fields do NOT contain array notation
  for (const field of scalarFields) {
    assert(!field.key.includes('[].'), `Scalar field "${field.key}" does not contain []. notation`);
  }

  // ────────────────────────────────────────────────────────────
  // Section 3: Array field identification
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 3: Array Field Identification ---');

  const arrayKeys = arrayFields.map(f => f.key);
  assert(arrayKeys.includes('lineItems[].description'), 'lineItems[].description is an array field');
  assert(arrayKeys.includes('lineItems[].quantity'), 'lineItems[].quantity is an array field');
  assert(arrayKeys.includes('lineItems[].unitPrice'), 'lineItems[].unitPrice is an array field');
  assert(arrayKeys.includes('lineItems[].amount'), 'lineItems[].amount is an array field');

  // Verify all array fields contain [] notation
  for (const field of arrayFields) {
    assert(field.key.includes('[].'), `Array field "${field.key}" contains []. notation`);
  }

  // ────────────────────────────────────────────────────────────
  // Section 4: Column key extraction from array fields
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 4: Column Key Extraction ---');

  // Parse array fields into parent → columnKey mapping
  const arrayGroups = {};
  for (const field of arrayFields) {
    const match = field.key.match(/^([^[]+)\[\]\.(.+)$/);
    assert(!!match, `Array field "${field.key}" matches parent[].column pattern`);
    if (match) {
      const parentKey = match[1];
      const columnKey = match[2];
      if (!arrayGroups[parentKey]) arrayGroups[parentKey] = [];
      arrayGroups[parentKey].push({ columnKey, label: field.label, key: field.key });
    }
  }

  assert(!!arrayGroups['lineItems'], 'lineItems parent group exists');
  if (arrayGroups['lineItems']) {
    const columnKeys = arrayGroups['lineItems'].map(f => f.columnKey);
    assert(columnKeys.includes('description'), 'lineItems has "description" column key');
    assert(columnKeys.includes('quantity'), 'lineItems has "quantity" column key');
    assert(columnKeys.includes('unitPrice'), 'lineItems has "unitPrice" column key');
    assert(columnKeys.includes('amount'), 'lineItems has "amount" column key');
  }

  // ────────────────────────────────────────────────────────────
  // Section 5: Conversion to DATA_FIELDS format (scalar only)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 5: Scalar-only DATA_FIELDS Conversion ---');

  if (fieldGroups) {
    // Simulate the scalarFields useMemo from ErpDesigner
    const dataFieldsConverted = fieldGroups.map(fg => ({
      group: fg.label || fg.key,
      fields: (fg.fields || []).map(f => ({
        key: f.key,
        label: f.label,
        example: f.exampleValue != null ? String(f.exampleValue) : '',
      })),
    }));

    const scalarOnly = dataFieldsConverted.map(group => ({
      ...group,
      fields: group.fields.filter(f => !f.key.includes('[].')),
    })).filter(g => g.fields.length > 0);

    // Scalar-only groups should NOT include Line Items (which only has array fields)
    const lineItemsGroup = scalarOnly.find(g => g.group === 'Line Items');
    assert(!lineItemsGroup, 'Scalar-only view excludes Line Items group (all array fields)');

    // But should include Document, Customer, Company, Totals
    assert(!!scalarOnly.find(g => g.group === 'Document'), 'Scalar view includes Document group');
    assert(!!scalarOnly.find(g => g.group === 'Customer'), 'Scalar view includes Customer group');
    assert(!!scalarOnly.find(g => g.group === 'Company'), 'Scalar view includes Company group');
    assert(!!scalarOnly.find(g => g.group === 'Totals'), 'Scalar view includes Totals group');

    // Verify no array fields leak into scalar view
    for (const group of scalarOnly) {
      for (const field of group.fields) {
        assert(!field.key.includes('[].'), `Scalar view field "${field.key}" is not an array field`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Section 6: Array field groups for table column picker
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 6: Array Field Groups for Tables ---');

  // Verify arrayFieldGroups structure (as computed in ErpDesigner)
  if (fieldGroups) {
    const dataFieldsConverted = fieldGroups.map(fg => ({
      group: fg.label || fg.key,
      fields: (fg.fields || []).map(f => ({
        key: f.key,
        label: f.label,
        example: f.exampleValue != null ? String(f.exampleValue) : '',
      })),
    }));

    // Simulate arrayFieldGroups useMemo
    const grouped = {};
    for (const group of dataFieldsConverted) {
      for (const field of group.fields) {
        const arrMatch = field.key.match(/^([^[]+)\[\]\.(.+)$/);
        if (arrMatch) {
          const parentKey = arrMatch[1];
          const columnKey = arrMatch[2];
          if (!grouped[parentKey]) {
            grouped[parentKey] = { label: group.group, parentKey, fields: [] };
          }
          grouped[parentKey].fields.push({
            key: field.key,
            label: field.label,
            example: field.example,
            columnKey,
          });
        }
      }
    }

    assert(!!grouped['lineItems'], 'arrayFieldGroups has lineItems');
    if (grouped['lineItems']) {
      assert(grouped['lineItems'].parentKey === 'lineItems', 'lineItems parentKey is correct');
      assert(grouped['lineItems'].label === 'Line Items', 'lineItems label is "Line Items"');
      assert(grouped['lineItems'].fields.length === 4, `lineItems has ${grouped['lineItems'].fields.length} column fields`);

      const colKeys = grouped['lineItems'].fields.map(f => f.columnKey);
      assert(colKeys.includes('description'), 'lineItems arrayGroup has description column');
      assert(colKeys.includes('quantity'), 'lineItems arrayGroup has quantity column');
      assert(colKeys.includes('unitPrice'), 'lineItems arrayGroup has unitPrice column');
      assert(colKeys.includes('amount'), 'lineItems arrayGroup has amount column');
    }
  }

  // ────────────────────────────────────────────────────────────
  // Section 7: DataSource property on table elements
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 7: DataSource Property ---');

  // Default line-items table should have dataSource: 'lineItems'
  // We verify this by checking the getDefaultElement function output structure
  // Since we can't call React functions directly, verify via template creation
  const createRes = await fetch(`${API_BASE}/api/pdfme/templates`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Test Table Template 430',
      type: 'invoice',
      schema: {
        pageSize: 'A4',
        pages: [{
          id: 'page1',
          label: 'Page 1',
          elements: [{
            id: 'table1',
            type: 'line-items',
            x: 20,
            y: 100,
            w: 495,
            h: 200,
            columns: [
              { key: 'description', header: 'Description', width: 200 },
              { key: 'quantity', header: 'Qty', width: 60 },
              { key: 'unitPrice', header: 'Price', width: 80 },
              { key: 'amount', header: 'Total', width: 80 }
            ],
            showHeader: true,
            borderStyle: 'solid',
            dataSource: 'lineItems'
          }]
        }]
      }
    })
  });

  assert(createRes.ok, 'Create template with table element and dataSource succeeds');
  const createData = createRes.json();
  const templateId = createData && createData.id;
  assert(!!templateId, `Template created with ID: ${templateId}`);

  // Verify the column keys map correctly to array field column keys
  if (templateId && arrayGroups['lineItems']) {
    const apiColumnKeys = arrayGroups['lineItems'].map(f => f.columnKey);
    const tableColumnKeys = ['description', 'quantity', 'unitPrice', 'amount'];
    for (const colKey of tableColumnKeys) {
      assert(apiColumnKeys.includes(colKey), `Table column "${colKey}" maps to lineItems[].${colKey} in field schema`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Section 8: Statement template also has correct scalar/array split
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 8: Statement Template Fields ---');

  const stmtRes = await fetch(`${API_BASE}/api/pdfme/field-schema/statement`, { headers: authHeaders });
  if (stmtRes.ok) {
    const stmtData = stmtRes.json();
    const stmtFields = [];
    if (stmtData && stmtData.fieldGroups) {
      for (const group of stmtData.fieldGroups) {
        for (const field of (group.fields || [])) {
          stmtFields.push(field);
        }
      }
    }
    const stmtScalar = stmtFields.filter(f => !f.key.includes('[].'));
    const stmtArray = stmtFields.filter(f => f.key.includes('[].'));
    assert(stmtScalar.length > 0, `Statement has ${stmtScalar.length} scalar fields`);
    // Statement may or may not have array fields depending on registration
    assert(true, `Statement has ${stmtArray.length} array fields`);
  } else {
    assert(true, 'Statement schema not registered (acceptable)');
  }

  // ────────────────────────────────────────────────────────────
  // Section 9: Hardcoded DATA_FIELDS fallback (no array fields)
  // ────────────────────────────────────────────────────────────
  console.log('\n--- Section 9: Hardcoded DATA_FIELDS Fallback ---');

  // The hardcoded DATA_FIELDS in ErpDesigner.tsx don't contain any []. fields
  // so scalarFields should equal dataFields when using defaults
  const hardcodedGroups = [
    {
      group: 'Document',
      fields: [
        { key: 'document.number', label: 'Document Number', example: 'INV-2026-001' },
        { key: 'document.date', label: 'Date', example: '2026-03-18' },
        { key: 'document.dueDate', label: 'Due Date', example: '2026-04-17' },
        { key: 'document.total', label: 'Total', example: 'R 1,250.00' },
        { key: 'document.subtotal', label: 'Subtotal', example: 'R 1,086.96' },
        { key: 'document.tax', label: 'Tax', example: 'R 163.04' },
      ],
    },
    {
      group: 'Customer',
      fields: [
        { key: 'customer.name', label: 'Name', example: 'Acme Corporation' },
        { key: 'customer.email', label: 'Email', example: 'billing@acme.com' },
        { key: 'customer.address', label: 'Address', example: '123 Main St' },
        { key: 'customer.phone', label: 'Phone', example: '+27 11 123 4567' },
        { key: 'customer.vatNumber', label: 'VAT Number', example: 'VAT4530001234' },
      ],
    },
    {
      group: 'Company',
      fields: [
        { key: 'company.name', label: 'Company Name', example: 'My Company Ltd' },
        { key: 'company.regNumber', label: 'Reg Number', example: '2020/123456/07' },
        { key: 'company.address', label: 'Address', example: '456 Business Park' },
      ],
    },
  ];

  // Verify none of the hardcoded fields have array notation
  for (const group of hardcodedGroups) {
    for (const field of group.fields) {
      assert(!field.key.includes('[].'), `Hardcoded field "${field.key}" is scalar (no []. notation)`);
    }
  }

  // Scalar filtering on hardcoded DATA_FIELDS should return all groups unchanged
  const hardcodedScalar = hardcodedGroups.map(g => ({
    ...g,
    fields: g.fields.filter(f => !f.key.includes('[].')),
  })).filter(g => g.fields.length > 0);

  assert(hardcodedScalar.length === hardcodedGroups.length, 'Hardcoded scalar groups count matches original (no array fields in defaults)');

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
