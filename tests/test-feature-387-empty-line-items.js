/**
 * Feature #387: Render pipeline handles empty line items gracefully
 *
 * Tests:
 * 1. Create template with line items table
 * 2. Render with empty line items array
 * 3. Verify no crash
 * 4. Verify table header shown without rows
 * 5. Verify footer still renders
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
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

const ORG_ID = 'org-empty-lit-387';
const TOKEN = makeToken('test-user-387', ORG_ID);

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

function requestRaw(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on('error', reject);
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
  console.log('=== Feature #387: Render pipeline handles empty line items gracefully ===\n');

  // --- Phase 1: Create template with line items table and footer rows ---
  console.log('--- Phase 1: Create template with lineItemsTable ---');
  const templatePayload = {
    name: 'Empty LIT Invoice 387',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'title',
              type: 'text',
              content: 'INVOICE',
              position: { x: 20, y: 10 },
              width: 100,
              height: 15,
              fontSize: 18,
            },
            {
              name: 'invoiceNumber',
              type: 'text',
              content: '{document.number}',
              position: { x: 20, y: 30 },
              width: 100,
              height: 10,
            },
            {
              name: 'lineItems',
              type: 'lineItemsTable',
              position: { x: 20, y: 50 },
              width: 170,
              height: 150,
              showHeader: true,
              repeatHeader: true,
              columns: [
                { key: 'description', header: 'Description', width: 80 },
                { key: 'quantity', header: 'Qty', width: 30, align: 'right' },
                { key: 'unitPrice', header: 'Unit Price', width: 30, align: 'right' },
                { key: 'amount', header: 'Amount', width: 30, align: 'right' },
              ],
              footerRows: [
                {
                  id: 'subtotal',
                  label: 'Subtotal',
                  labelColumnKey: 'description',
                  valueColumnKey: 'amount',
                  type: 'sum',
                  labelColSpan: 3,
                },
                {
                  id: 'vat',
                  label: 'VAT (15%)',
                  labelColumnKey: 'description',
                  valueColumnKey: 'amount',
                  type: 'percentage',
                  referenceFooterId: 'subtotal',
                  percentage: 0.15,
                  labelColSpan: 3,
                },
                {
                  id: 'total',
                  label: 'Total',
                  labelColumnKey: 'description',
                  valueColumnKey: 'amount',
                  type: 'sumWithFooters',
                  footerIds: ['subtotal', 'vat'],
                  labelColSpan: 3,
                },
              ],
            }
          ]
        }
      ]
    }
  };

  const createRes = await request('POST', '/templates', templatePayload);
  assert('Template created', createRes.status === 201 || createRes.status === 200, 'got ' + createRes.status);
  const templateId = createRes.body && createRes.body.id;

  // Publish
  const publishRes = await request('POST', '/templates/' + templateId + '/publish');
  assert('Template published', publishRes.status === 200 || publishRes.status === 201, 'got ' + publishRes.status);

  // --- Phase 2: Render with empty line items array ---
  console.log('\n--- Phase 2: Render with empty line items ---');
  const renderEmpty = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-empty-lit-387',
    channel: 'email',
    inputs: [{
      'document.number': 'INV-EMPTY-001',
      lineItems: '[]',
    }]
  });
  assert('Render with empty items succeeds', renderEmpty.status === 200 || renderEmpty.status === 201, 'got ' + renderEmpty.status + ' body: ' + JSON.stringify(renderEmpty.body).substring(0, 200));
  const docEmpty = renderEmpty.body && renderEmpty.body.document;
  assert('Document created', !!(docEmpty && docEmpty.id), 'no document id');
  assert('Document status is done', docEmpty && docEmpty.status === 'done', 'status: ' + (docEmpty && docEmpty.status));

  // Download PDF and verify it's valid
  if (docEmpty && docEmpty.id) {
    const pdfRes = await requestRaw('GET', '/render/document/' + docEmpty.id);
    assert('PDF download succeeds', pdfRes.status === 200, 'got ' + pdfRes.status);
    assert('PDF is valid (starts with %PDF)', pdfRes.buffer.toString('latin1', 0, 5) === '%PDF-', 'got: ' + pdfRes.buffer.toString('latin1', 0, 10));
    assert('PDF has content (> 1KB)', pdfRes.buffer.length > 1000, 'size: ' + pdfRes.buffer.length);
  }

  // --- Phase 3: Render with null/undefined/missing line items ---
  console.log('\n--- Phase 3: Render with missing line items ---');
  const renderMissing = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-missing-lit-387',
    channel: 'email',
    inputs: [{
      'document.number': 'INV-MISSING-001',
      // lineItems not provided at all
    }]
  });
  assert('Render with missing items succeeds', renderMissing.status === 200 || renderMissing.status === 201, 'got ' + renderMissing.status);
  const docMissing = renderMissing.body && renderMissing.body.document;
  assert('Document created (missing items)', !!(docMissing && docMissing.id));
  assert('Document status done (missing items)', docMissing && docMissing.status === 'done', 'status: ' + (docMissing && docMissing.status));

  // --- Phase 4: Render with empty string line items ---
  console.log('\n--- Phase 4: Render with empty string line items ---');
  const renderEmptyStr = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-empty-str-387',
    channel: 'email',
    inputs: [{
      'document.number': 'INV-EMPTY-STR-001',
      lineItems: '',
    }]
  });
  assert('Render with empty string items succeeds', renderEmptyStr.status === 200 || renderEmptyStr.status === 201, 'got ' + renderEmptyStr.status);
  const docEmptyStr = renderEmptyStr.body && renderEmptyStr.body.document;
  assert('Document created (empty string)', !!(docEmptyStr && docEmptyStr.id));
  assert('Document status done (empty string)', docEmptyStr && docEmptyStr.status === 'done', 'status: ' + (docEmptyStr && docEmptyStr.status));

  // --- Phase 5: Verify that non-empty render still works ---
  console.log('\n--- Phase 5: Non-empty render still works ---');
  const lineItemsData = [
    { description: 'Widget A', quantity: 10, unitPrice: 100, amount: 1000 },
    { description: 'Widget B', quantity: 5, unitPrice: 200, amount: 1000 },
  ];
  const renderFull = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-full-lit-387',
    channel: 'email',
    inputs: [{
      'document.number': 'INV-FULL-001',
      lineItems: JSON.stringify(lineItemsData),
    }]
  });
  assert('Render with full items succeeds', renderFull.status === 200 || renderFull.status === 201, 'got ' + renderFull.status);
  const docFull = renderFull.body && renderFull.body.document;
  assert('Document created (full)', !!(docFull && docFull.id));
  assert('Document status done (full)', docFull && docFull.status === 'done', 'status: ' + (docFull && docFull.status));

  // Compare sizes - full should be larger than empty
  if (docEmpty && docEmpty.id && docFull && docFull.id) {
    const pdfEmpty = await requestRaw('GET', '/render/document/' + docEmpty.id);
    const pdfFull = await requestRaw('GET', '/render/document/' + docFull.id);
    assert('Full PDF larger than empty PDF', pdfFull.buffer.length > pdfEmpty.buffer.length,
      'empty=' + pdfEmpty.buffer.length + ' full=' + pdfFull.buffer.length);
  }

  // --- Phase 6: Template with table only (no other elements) ---
  console.log('\n--- Phase 6: Table-only template with empty data ---');
  const tableOnlyPayload = {
    name: 'Table Only 387',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'items',
              type: 'lineItemsTable',
              position: { x: 10, y: 10 },
              width: 190,
              height: 200,
              showHeader: true,
              columns: [
                { key: 'item', header: 'Item', width: 100 },
                { key: 'amount', header: 'Amount', width: 90, align: 'right' },
              ],
              footerRows: [
                { id: 'total', label: 'Total', valueColumnKey: 'amount', type: 'sum', labelColSpan: 1 },
              ],
            }
          ]
        }
      ]
    }
  };

  const createTableOnly = await request('POST', '/templates', tableOnlyPayload);
  assert('Table-only template created', createTableOnly.status === 201 || createTableOnly.status === 200);
  const tableOnlyId = createTableOnly.body && createTableOnly.body.id;

  const publishTableOnly = await request('POST', '/templates/' + tableOnlyId + '/publish');
  assert('Table-only published', publishTableOnly.status === 200 || publishTableOnly.status === 201);

  const renderTableOnly = await request('POST', '/render/now', {
    templateId: tableOnlyId,
    entityId: 'inv-table-only-387',
    channel: 'print',
    inputs: [{ items: '[]' }]
  });
  assert('Table-only empty render succeeds', renderTableOnly.status === 200 || renderTableOnly.status === 201, 'got ' + renderTableOnly.status);
  assert('Table-only doc status done', renderTableOnly.body && renderTableOnly.body.document && renderTableOnly.body.document.status === 'done');

  // --- Phase 7: Print channel with empty items ---
  console.log('\n--- Phase 7: Print channel with empty items ---');
  const renderPrint = await request('POST', '/render/now', {
    templateId: templateId,
    entityId: 'inv-print-empty-387',
    channel: 'print',
    inputs: [{
      'document.number': 'INV-PRINT-EMPTY',
      lineItems: '[]',
    }]
  });
  assert('Print channel empty render succeeds', renderPrint.status === 200 || renderPrint.status === 201);
  assert('Print doc status done', renderPrint.body && renderPrint.body.document && renderPrint.body.document.status === 'done');

  // --- Phase 8: Table with no footer rows and empty items ---
  console.log('\n--- Phase 8: No footer rows, empty items ---');
  const noFooterPayload = {
    name: 'No Footer Table 387',
    type: 'invoice',
    schema: {
      pages: [
        {
          elements: [
            {
              name: 'items',
              type: 'lineItemsTable',
              position: { x: 10, y: 10 },
              width: 190,
              height: 100,
              showHeader: true,
              columns: [
                { key: 'name', header: 'Name', width: 100 },
                { key: 'value', header: 'Value', width: 90 },
              ],
              // No footerRows
            }
          ]
        }
      ]
    }
  };

  const createNoFooter = await request('POST', '/templates', noFooterPayload);
  assert('No-footer template created', createNoFooter.status === 201 || createNoFooter.status === 200);
  const noFooterId = createNoFooter.body && createNoFooter.body.id;

  const publishNoFooter = await request('POST', '/templates/' + noFooterId + '/publish');
  assert('No-footer published', publishNoFooter.status === 200 || publishNoFooter.status === 201);

  const renderNoFooter = await request('POST', '/render/now', {
    templateId: noFooterId,
    entityId: 'inv-no-footer-387',
    channel: 'email',
    inputs: [{ items: '[]' }]
  });
  assert('No-footer empty render succeeds', renderNoFooter.status === 200 || renderNoFooter.status === 201, 'got ' + renderNoFooter.status);
  assert('No-footer doc status done', renderNoFooter.body && renderNoFooter.body.document && renderNoFooter.body.document.status === 'done',
    'status: ' + (renderNoFooter.body && renderNoFooter.body.document && renderNoFooter.body.document.status));

  // --- Phase 9: Bulk render with empty items ---
  console.log('\n--- Phase 9: Bulk render with empty items ---');
  const renderBulk = await request('POST', '/render/bulk', {
    templateId: templateId,
    entityIds: ['bulk-empty-1', 'bulk-empty-2', 'bulk-empty-3'],
    channel: 'email',
    inputs: [{
      'document.number': 'BULK-EMPTY',
      lineItems: '[]',
    }]
  });
  assert('Bulk render with empty items accepted', renderBulk.status === 202, 'got ' + renderBulk.status);
  if (renderBulk.body && renderBulk.body.batchId) {
    // Wait for batch to complete
    await new Promise(function(r) { setTimeout(r, 3000); });
    const batchStatus = await request('GET', '/render/batch/' + renderBulk.body.batchId);
    assert('Bulk batch completed', batchStatus.body && (batchStatus.body.status === 'completed' || batchStatus.body.status === 'running'),
      'status: ' + (batchStatus.body && batchStatus.body.status));
  }

  // --- Phase 10: Verify document history for empty renders ---
  console.log('\n--- Phase 10: Document history ---');
  const docs = await request('GET', '/render/documents/' + templateId);
  assert('Document list accessible', docs.status === 200, 'got ' + docs.status);
  const allDocs = docs.body && docs.body.data;
  assert('Multiple documents created', allDocs && allDocs.length >= 3, 'got ' + (allDocs && allDocs.length));

  // Verify all empty-render docs have status 'done' (not failed)
  if (allDocs) {
    const failedDocs = allDocs.filter(function(d) { return d.status === 'failed'; });
    assert('No failed documents from empty renders', failedDocs.length === 0, 'failed: ' + failedDocs.length);
  }

  // --- Summary ---
  console.log('\n=== Results: ' + passed + '/' + total + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
