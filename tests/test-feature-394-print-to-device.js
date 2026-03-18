/**
 * Feature #394: Print-to-device API endpoint - direct raw socket printing
 *
 * Verifies:
 * 1. Printers table in DB schema
 * 2. PrinterService with CRUD + raw TCP socket send
 * 3. SSRF protection for printer host validation
 * 4. PrinterController with GET/POST printers and POST /print
 * 5. Connection/send timeouts
 * 6. AppModule registration
 * 7. API integration: add printer, SSRF rejection, list printers
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const API = `${BASE}/api/pdfme`;
const secret = 'pdfme-dev-secret';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${name}`);
  } else {
    failed++;
    results.push(`  FAIL: ${name}`);
  }
}

function signJwt(p) {
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const b = Buffer.from(JSON.stringify({...p,iat:Math.floor(Date.now()/1000),exp:9999999999})).toString('base64url');
  const s = crypto.createHmac('sha256',secret).update(h+'.'+b).digest('base64url');
  return h+'.'+b+'.'+s;
}

const ORG_ID = 'org-printer-394';
const USER_ID = 'user-printer-394';
const token = signJwt({
  sub: USER_ID,
  orgId: ORG_ID,
  roles: ['printer:read', 'printer:write', 'render:trigger', 'template:view', 'template:edit', 'template:publish'],
});

function httpRequest(method, urlPath, body = null, authToken = token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('=== Feature #394: Print-to-device API endpoint ===\n');

  // ─── Part 1: DB Schema ───
  console.log('--- Part 1: Printers table in DB schema ---');

  const schemaPath = path.join(__dirname, '..', 'nest-module', 'src', 'db', 'schema.ts');
  const schemaSrc = fs.readFileSync(schemaPath, 'utf-8');

  assert(
    schemaSrc.includes("export const printers = pgTable('printers'"),
    'printers table defined in schema'
  );

  assert(
    schemaSrc.includes("orgId: text('org_id')"),
    'printers table has orgId column'
  );

  assert(
    schemaSrc.includes("host: text('host')"),
    'printers table has host column'
  );

  assert(
    schemaSrc.includes("port: integer('port')"),
    'printers table has port column'
  );

  assert(
    schemaSrc.includes(".default(9100)"),
    'printers port defaults to 9100'
  );

  assert(
    schemaSrc.includes("type: text('type')"),
    'printers table has type column'
  );

  assert(
    schemaSrc.includes("isDefault"),
    'printers table has isDefault column'
  );

  assert(
    schemaSrc.includes("createdAt") && schemaSrc.includes("updatedAt"),
    'printers table has createdAt and updatedAt timestamps'
  );

  // ─── Part 2: Migration ───
  console.log('--- Part 2: Migration includes printers ---');

  const migratePath = path.join(__dirname, '..', 'nest-module', 'src', 'db', 'migrate.ts');
  const migrateSrc = fs.readFileSync(migratePath, 'utf-8');

  assert(
    migrateSrc.includes('CREATE TABLE IF NOT EXISTS printers'),
    'Migration includes CREATE TABLE printers'
  );

  assert(
    migrateSrc.includes('port INTEGER NOT NULL DEFAULT 9100'),
    'Migration sets port default to 9100'
  );

  assert(
    migrateSrc.includes('idx_printers_org_id'),
    'Migration creates org_id index on printers'
  );

  // ─── Part 3: PrinterService ───
  console.log('--- Part 3: PrinterService ---');

  const servicePath = path.join(__dirname, '..', 'nest-module', 'src', 'printer.service.ts');
  const serviceSrc = fs.readFileSync(servicePath, 'utf-8');

  assert(
    serviceSrc.includes('export class PrinterService'),
    'PrinterService class exported'
  );

  assert(
    serviceSrc.includes('@Injectable()'),
    'PrinterService is Injectable'
  );

  // CRUD methods
  assert(
    serviceSrc.includes('async create('),
    'PrinterService has create method'
  );

  assert(
    serviceSrc.includes('async findAll('),
    'PrinterService has findAll method'
  );

  assert(
    serviceSrc.includes('async findById('),
    'PrinterService has findById method'
  );

  assert(
    serviceSrc.includes('async delete('),
    'PrinterService has delete method'
  );

  // Raw TCP socket send
  assert(
    serviceSrc.includes('async sendToPrinter('),
    'PrinterService has sendToPrinter method'
  );

  assert(
    serviceSrc.includes("net.Socket"),
    'sendToPrinter uses net.Socket for TCP connection'
  );

  assert(
    serviceSrc.includes("socket.connect(port, host"),
    'sendToPrinter connects to host:port'
  );

  assert(
    serviceSrc.includes("socket.write(pdfData"),
    'sendToPrinter writes PDF data to socket'
  );

  // ─── Part 4: SSRF Protection ───
  console.log('--- Part 4: SSRF protection ---');

  assert(
    serviceSrc.includes('isPrivateNetwork'),
    'isPrivateNetwork function exists for SSRF protection'
  );

  assert(
    serviceSrc.includes('10\\.'),
    'SSRF check covers 10.x.x.x range'
  );

  assert(
    serviceSrc.includes('172\\.(1[6-9]|2'),
    'SSRF check covers 172.16-31.x.x range'
  );

  assert(
    serviceSrc.includes('192\\.168\\.'),
    'SSRF check covers 192.168.x.x range'
  );

  assert(
    serviceSrc.includes('127\\.'),
    'SSRF check covers 127.x.x.x (localhost) range'
  );

  assert(
    serviceSrc.includes('SSRF_BLOCKED'),
    'Non-private hosts are blocked with SSRF_BLOCKED error'
  );

  // ─── Part 5: Timeouts ───
  console.log('--- Part 5: Connection and send timeouts ---');

  assert(
    serviceSrc.includes('5000') || serviceSrc.includes('5s'),
    'Connection timeout set to 5 seconds'
  );

  assert(
    serviceSrc.includes('30000') || serviceSrc.includes('30s'),
    'Send timeout set to 30 seconds'
  );

  assert(
    serviceSrc.includes('Connection timeout'),
    'Connection timeout error message exists'
  );

  assert(
    serviceSrc.includes('Send timeout'),
    'Send timeout error message exists'
  );

  // ─── Part 6: PrinterController ───
  console.log('--- Part 6: PrinterController ---');

  const ctrlPath = path.join(__dirname, '..', 'nest-module', 'src', 'printer.controller.ts');
  const ctrlSrc = fs.readFileSync(ctrlPath, 'utf-8');

  assert(
    ctrlSrc.includes('export class PrinterController'),
    'PrinterController class exported'
  );

  assert(
    ctrlSrc.includes("@Get('printers')"),
    'GET /printers endpoint exists'
  );

  assert(
    ctrlSrc.includes("@Post('printers')"),
    'POST /printers endpoint exists'
  );

  assert(
    ctrlSrc.includes("@Post('print')"),
    'POST /print endpoint exists'
  );

  assert(
    ctrlSrc.includes("@Delete('printers/:id')"),
    'DELETE /printers/:id endpoint exists'
  );

  // POST /print validates printerId and templateId
  assert(
    ctrlSrc.includes('templateId') && ctrlSrc.includes('printerId'),
    'POST /print requires templateId and printerId'
  );

  // POST /print renders then sends
  assert(
    ctrlSrc.includes('renderNow') || ctrlSrc.includes('renderService'),
    'POST /print renders PDF before sending'
  );

  assert(
    ctrlSrc.includes('sendToPrinter'),
    'POST /print sends rendered PDF to printer'
  );

  // SSRF validation in controller
  assert(
    ctrlSrc.includes('validateHost'),
    'Controller validates host against SSRF allowlist'
  );

  // ─── Part 7: AppModule Registration ───
  console.log('--- Part 7: AppModule registration ---');

  const appModulePath = path.join(__dirname, '..', 'nest-module', 'src', 'app.module.ts');
  const appSrc = fs.readFileSync(appModulePath, 'utf-8');

  assert(
    appSrc.includes('PrinterController'),
    'PrinterController registered in AppModule controllers'
  );

  assert(
    appSrc.includes('PrinterService'),
    'PrinterService registered in AppModule providers'
  );

  assert(
    appSrc.includes('PrintJobService'),
    'PrintJobService registered in AppModule providers'
  );

  // ─── Part 8: API Integration Tests ───
  console.log('--- Part 8: API integration ---');

  // Test 1: List printers (initially empty)
  const listRes = await httpRequest('GET', `${API}/printers`);
  assert(
    listRes.status === 200,
    `GET /printers returns 200: ${listRes.status}`
  );

  assert(
    Array.isArray(listRes.body?.data),
    'GET /printers returns data array'
  );

  // Test 2: Add a printer (private IP)
  const addRes = await httpRequest('POST', `${API}/printers`, {
    name: 'Zebra ZD420',
    host: '192.168.1.100',
    port: 9100,
    type: 'raw',
  });

  assert(
    addRes.status === 201,
    `POST /printers with private IP returns 201: ${addRes.status}`
  );

  assert(
    addRes.body?.id && addRes.body?.name === 'Zebra ZD420',
    'Created printer has correct name'
  );

  assert(
    addRes.body?.host === '192.168.1.100' && addRes.body?.port === 9100,
    'Created printer has correct host and port'
  );

  const printerId = addRes.body?.id;

  // Test 3: SSRF protection - reject public IP
  const ssrfRes = await httpRequest('POST', `${API}/printers`, {
    name: 'Evil Printer',
    host: '8.8.8.8',
    port: 9100,
    type: 'raw',
  });

  assert(
    ssrfRes.status === 422,
    `POST /printers with public IP returns 422 (SSRF blocked): ${ssrfRes.status}`
  );

  assert(
    ssrfRes.body?.message?.includes('private network') || ssrfRes.body?.message?.includes('SSRF'),
    'SSRF error message mentions private network'
  );

  // Test 4: List printers shows the new one
  const list2Res = await httpRequest('GET', `${API}/printers`);
  assert(
    list2Res.body?.data?.length >= 1,
    'GET /printers shows at least 1 printer after creation'
  );

  // Test 5: No auth returns 401
  const noAuthRes = await httpRequest('GET', `${API}/printers`, null, null);
  assert(
    noAuthRes.status === 401,
    `GET /printers without auth returns 401: ${noAuthRes.status}`
  );

  // Test 6: POST /print without printerId returns 400
  const noPrinterRes = await httpRequest('POST', `${API}/print`, {
    templateId: 'some-template',
  });
  assert(
    noPrinterRes.status === 400,
    `POST /print without printerId returns 400: ${noPrinterRes.status}`
  );

  // Test 7: POST /print with non-existent printer returns 404
  const badPrinterRes = await httpRequest('POST', `${API}/print`, {
    templateId: 'some-template',
    printerId: 'non-existent-printer',
  });
  assert(
    badPrinterRes.status === 404,
    `POST /print with invalid printerId returns 404: ${badPrinterRes.status}`
  );

  // Test 8: SSRF with another public IP
  const ssrf2Res = await httpRequest('POST', `${API}/printers`, {
    name: 'External',
    host: '54.231.100.50',
    port: 9100,
  });
  assert(
    ssrf2Res.status === 422,
    `POST /printers with AWS IP returns 422 (SSRF blocked): ${ssrf2Res.status}`
  );

  // Test 9: Private IPs are allowed (10.x.x.x)
  const tenRes = await httpRequest('POST', `${API}/printers`, {
    name: 'Warehouse Printer',
    host: '10.0.1.50',
    port: 9100,
  });
  assert(
    tenRes.status === 201,
    `POST /printers with 10.x.x.x IP returns 201: ${tenRes.status}`
  );

  // Test 10: localhost is allowed
  const localhostRes = await httpRequest('POST', `${API}/printers`, {
    name: 'Local Printer',
    host: 'localhost',
    port: 9100,
  });
  assert(
    localhostRes.status === 201,
    `POST /printers with localhost returns 201: ${localhostRes.status}`
  );

  // Test 11: Delete printer
  if (printerId) {
    const deleteRes = await httpRequest('DELETE', `${API}/printers/${printerId}`);
    assert(
      deleteRes.status === 200,
      `DELETE /printers/:id returns 200: ${deleteRes.status}`
    );

    assert(
      deleteRes.body?.deleted === true,
      'Delete response confirms deletion'
    );
  }

  // Test 12: Delete non-existent printer
  const deleteGhostRes = await httpRequest('DELETE', `${API}/printers/non-existent-id`);
  assert(
    deleteGhostRes.status === 404,
    `DELETE /printers/non-existent returns 404: ${deleteGhostRes.status}`
  );

  // Clean up printers
  if (tenRes.body?.id) await httpRequest('DELETE', `${API}/printers/${tenRes.body.id}`);
  if (localhostRes.body?.id) await httpRequest('DELETE', `${API}/printers/${localhostRes.body.id}`);

  // ─── Part 9: Error handling ───
  console.log('--- Part 9: Error handling ---');

  assert(
    serviceSrc.includes("socket.on('error'"),
    'Socket error handler for unreachable printers'
  );

  assert(
    serviceSrc.includes('socket.destroy()'),
    'Socket destroyed on timeout/error'
  );

  assert(
    ctrlSrc.includes("'failed'") || ctrlSrc.includes("status: 'failed'"),
    'Print job marked as failed on error'
  );

  // ─── Summary ───
  console.log('\n=== Results ===');
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${passed + failed} tests passing`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
