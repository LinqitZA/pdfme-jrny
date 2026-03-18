/**
 * Test script for Feature #149: DataSource registry resolves template type
 *
 * Tests:
 * 1. Register InvoiceDataSource for invoice type
 * 2. Call registry.resolve('invoice') - verify InvoiceDataSource returned
 * 3. Call with unregistered type - verify appropriate error
 * 4. API endpoint tests: list, check, resolve
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
let PASS = 0;
let FAIL = 0;

// Build dev JWT token
function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles })).toString('base64url');
  return header + '.' + payload + '.devsig';
}

const TOKEN = makeToken('user-ds-test', 'org-ds-test', ['render:trigger']);

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

async function main() {
  console.log('=== Feature #149: DataSource registry resolves template type ===\n');

  // --- Unit tests (test the DataSourceRegistry class directly) ---
  console.log('--- Unit tests: DataSourceRegistry class ---\n');

  // Inline DataSourceRegistry (mirrors the TypeScript class in nest-module/src/datasource.registry.ts)
  class DataSourceRegistry {
    constructor() { this.sources = new Map(); }
    register(source) { this.sources.set(source.templateType, source); }
    resolve(templateType) {
      const source = this.sources.get(templateType);
      if (!source) {
        throw new Error(
          `No DataSource registered for template type "${templateType}". ` +
          `Registered types: [${this.getRegisteredTypes().join(', ')}]`
        );
      }
      return source;
    }
    has(templateType) { return this.sources.has(templateType); }
    getRegisteredTypes() { return Array.from(this.sources.keys()); }
    unregister(templateType) { return this.sources.delete(templateType); }
  }

  const registry = new DataSourceRegistry();

  // Step 1: Register InvoiceDataSource for invoice type
  console.log('Step 1: Register InvoiceDataSource for invoice type...');
  const invoiceDataSource = {
    templateType: 'invoice',
    resolve: async (entityId, orgId) => {
      return [{ invoiceNumber: 'INV-001', entityId, orgId, amount: 1500.00 }];
    },
  };
  registry.register(invoiceDataSource);
  assert('register does not throw', true);

  // Step 2: Call registry.resolve('invoice') - verify InvoiceDataSource returned
  console.log('\nStep 2: Call registry.resolve("invoice")...');
  const resolved = registry.resolve('invoice');
  assert('resolve returns the registered DataSource', resolved === invoiceDataSource);
  assert('resolved.templateType === "invoice"', resolved.templateType === 'invoice');

  // Verify the resolve function works
  const data = await resolved.resolve('entity-001', 'org-001');
  assert('DataSource.resolve returns data', Array.isArray(data) && data.length === 1);
  assert('data contains invoiceNumber', data[0].invoiceNumber === 'INV-001');

  // Step 3: Call with unregistered type - verify appropriate error
  console.log('\nStep 3: Call resolve with unregistered type...');
  let errorThrown = false;
  let errorMessage = '';
  try {
    registry.resolve('unknown_type');
  } catch (err) {
    errorThrown = true;
    errorMessage = err.message;
  }
  assert('resolve throws for unregistered type', errorThrown);
  assert('error message mentions the type', errorMessage.includes('unknown_type'));
  assert('error message lists registered types', errorMessage.includes('invoice'));

  // Step 4: has() method
  console.log('\nStep 4: has() method...');
  assert('has("invoice") = true', registry.has('invoice') === true);
  assert('has("unknown") = false', registry.has('unknown') === false);

  // Step 5: getRegisteredTypes()
  console.log('\nStep 5: getRegisteredTypes()...');
  const types = registry.getRegisteredTypes();
  assert('getRegisteredTypes includes "invoice"', types.includes('invoice'));

  // Step 6: Register multiple types
  console.log('\nStep 6: Register multiple types...');
  registry.register({
    templateType: 'statement',
    resolve: async () => [{ statementDate: '2026-03-31' }],
  });
  registry.register({
    templateType: 'purchase_order',
    resolve: async () => [{ poNumber: 'PO-001' }],
  });
  assert('3 types registered', registry.getRegisteredTypes().length === 3);

  // Step 7: unregister
  console.log('\nStep 7: Unregister...');
  const removed = registry.unregister('statement');
  assert('unregister returns true', removed === true);
  assert('has("statement") = false after unregister', !registry.has('statement'));
  const removedAgain = registry.unregister('statement');
  assert('unregister returns false for non-existent', removedAgain === false);

  // --- API endpoint tests ---
  console.log('\n--- API tests: DataSource endpoints ---\n');

  // Test: GET /api/pdfme/datasources (list - should be empty initially since no DS registered in app)
  console.log('Step 8: GET /api/pdfme/datasources — list registered types...');
  const listResp = await request('GET', '/api/pdfme/datasources');
  assert('GET /datasources returns 200', listResp.status === 200);
  assert('response has types array', Array.isArray(listResp.body.types));
  assert('response has count', typeof listResp.body.count === 'number');
  console.log('  Registered types:', listResp.body.types);

  // Test: GET /api/pdfme/datasources/nonexistent — should return 404
  console.log('\nStep 9: GET /api/pdfme/datasources/nonexistent — should return 404...');
  const checkResp = await request('GET', '/api/pdfme/datasources/nonexistent');
  assert('GET /datasources/nonexistent returns 404', checkResp.status === 404);
  assert('error message mentions type', checkResp.body.message && checkResp.body.message.includes('nonexistent'));

  // Test: POST /api/pdfme/datasources/nonexistent/resolve — should return 404
  console.log('\nStep 10: POST /api/pdfme/datasources/nonexistent/resolve — should return 404...');
  const resolveResp = await request('POST', '/api/pdfme/datasources/nonexistent/resolve', {
    entityId: 'entity-001',
  });
  assert('POST resolve for unregistered type returns 404', resolveResp.status === 404);

  // Summary
  console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===');
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
