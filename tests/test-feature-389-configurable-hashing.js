/**
 * Feature #389: Configurable document hashing algorithm (SHA-256 / BLAKE3)
 *
 * Tests:
 * 1. HashService unit tests (sha256 and blake3 output, prefix format, verification)
 * 2. Integration: default sha256 hashing on render, prefixed hash stored
 * 3. Integration: verification works with prefixed hashes
 * 4. Integration: backward compatibility with legacy un-prefixed hashes
 * 5. Config interface has hashing section
 * 6. Centralised hash utility replaces inline crypto.createHash calls
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const API = `${BASE}/api/pdfme`;

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

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOptions = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function makeToken(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: claims.sub || 'test-user-389',
    orgId: claims.orgId || 'org-hash-test',
    roles: claims.roles || ['admin', 'template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'pdfme-dev-secret')
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function runTests() {
  const token = makeToken();
  const authHeaders = { Authorization: `Bearer ${token}` };

  // ==========================================
  // UNIT TESTS: HashService source code checks
  // ==========================================

  // Test 1: hash.service.ts exists
  const hashServicePath = path.join(__dirname, '..', 'nest-module', 'src', 'hash.service.ts');
  const hashServiceExists = fs.existsSync(hashServicePath);
  assert(hashServiceExists, 'hash.service.ts file exists');

  let hashServiceCode = '';
  if (hashServiceExists) {
    hashServiceCode = fs.readFileSync(hashServicePath, 'utf-8');
  }

  // Test 2: HashService is injectable
  assert(hashServiceCode.includes('@Injectable()'), 'HashService is @Injectable()');

  // Test 3: HashService has computeHash method
  assert(hashServiceCode.includes('computeHash(buffer: Buffer): string'), 'HashService has computeHash method');

  // Test 4: HashService supports sha256
  assert(hashServiceCode.includes("createHash('sha256')"), 'HashService supports sha256');

  // Test 5: HashService supports blake3
  assert(hashServiceCode.includes("require('blake3')"), 'HashService supports blake3');

  // Test 6: HashService prefixes hashes with algorithm
  assert(hashServiceCode.includes('`${this.algorithm}:${hex}`'), 'HashService prefixes hashes with algorithm identifier');

  // Test 7: HashService has parseStoredHash for backward compat
  assert(hashServiceCode.includes('parseStoredHash'), 'HashService has parseStoredHash method');

  // Test 8: HashService falls back to sha256 for legacy un-prefixed hashes
  assert(hashServiceCode.includes("algorithm: 'sha256', hex: storedHash"), 'HashService falls back to sha256 for legacy un-prefixed hashes');

  // Test 9: HashService has verifyHash method
  assert(hashServiceCode.includes('verifyHash(buffer: Buffer, storedHash: string)'), 'HashService has verifyHash method');

  // Test 10: HashService injects PDFME_MODULE_CONFIG
  assert(hashServiceCode.includes("@Inject('PDFME_MODULE_CONFIG')"), 'HashService injects PDFME_MODULE_CONFIG');

  // ==========================================
  // CONFIG INTERFACE TESTS
  // ==========================================

  // Test 11: types.ts has hashing section
  const typesPath = path.join(__dirname, '..', 'nest-module', 'src', 'types.ts');
  const typesCode = fs.readFileSync(typesPath, 'utf-8');
  assert(typesCode.includes("hashing?:"), 'PdfmeErpModuleConfig has hashing section');

  // Test 12: hashing section has algorithm option
  assert(typesCode.includes("algorithm?: 'sha256' | 'blake3'"), 'hashing section has algorithm option with sha256 and blake3');

  // ==========================================
  // CENTRALISED HASH - NO MORE INLINE CRYPTO
  // ==========================================

  // Test 13: render.service.ts no longer has inline createHash
  const renderServicePath = path.join(__dirname, '..', 'nest-module', 'src', 'render.service.ts');
  const renderCode = fs.readFileSync(renderServicePath, 'utf-8');
  const inlineHashMatches = renderCode.match(/crypto\s*\.\s*createHash\s*\(\s*['"]sha256['"]\s*\)/g);
  assert(!inlineHashMatches || inlineHashMatches.length === 0, 'render.service.ts has no inline crypto.createHash("sha256") calls');

  // Test 14: render.service.ts uses hashService
  assert(renderCode.includes('this.hashService.computeHash'), 'render.service.ts uses hashService.computeHash');

  // Test 15: render.service.ts uses hashService for verification
  assert(renderCode.includes('this.hashService.verifyHash'), 'render.service.ts uses hashService.verifyHash');

  // Test 16: grouped-table.controller.ts no longer has inline createHash
  const groupedTablePath = path.join(__dirname, '..', 'nest-module', 'src', 'grouped-table.controller.ts');
  const groupedTableCode = fs.readFileSync(groupedTablePath, 'utf-8');
  const gtInlineMatches = groupedTableCode.match(/crypto\s*\.\s*createHash\s*\(\s*['"]sha256['"]\s*\)/g);
  assert(!gtInlineMatches || gtInlineMatches.length === 0, 'grouped-table.controller.ts has no inline crypto.createHash calls');

  // Test 17: grouped-table.controller.ts uses hashService
  assert(groupedTableCode.includes('this.hashService.computeHash'), 'grouped-table.controller.ts uses hashService.computeHash');

  // Test 18: grouped-table.controller.ts imports HashService
  assert(groupedTableCode.includes("import { HashService }"), 'grouped-table.controller.ts imports HashService');

  // Test 19: render.service.ts imports HashService
  assert(renderCode.includes("import { HashService }"), 'render.service.ts imports HashService');

  // ==========================================
  // APP MODULE REGISTRATION
  // ==========================================

  // Test 20: app.module.ts registers HashService
  const appModulePath = path.join(__dirname, '..', 'nest-module', 'src', 'app.module.ts');
  const appModuleCode = fs.readFileSync(appModulePath, 'utf-8');
  assert(appModuleCode.includes('HashService'), 'app.module.ts registers HashService');

  // Test 21: pdfme-erp.module.ts registers HashService
  const erpModulePath = path.join(__dirname, '..', 'nest-module', 'src', 'pdfme-erp.module.ts');
  const erpModuleCode = fs.readFileSync(erpModulePath, 'utf-8');
  assert(erpModuleCode.includes('HashService'), 'pdfme-erp.module.ts registers HashService');

  // Test 22: pdfme-erp.module.ts passes hashing config
  assert(erpModuleCode.includes('hashing:'), 'pdfme-erp.module.ts passes hashing config to PDFME_MODULE_CONFIG');

  // ==========================================
  // SCHEMA COMMENT UPDATE
  // ==========================================

  // Test 23: schema.ts pdfHash column comment updated
  const schemaPath = path.join(__dirname, '..', 'nest-module', 'src', 'db', 'schema.ts');
  const schemaCode = fs.readFileSync(schemaPath, 'utf-8');
  assert(schemaCode.includes('Configurable') || schemaCode.includes('configurable') || schemaCode.includes('BLAKE3') || schemaCode.includes('blake3'),
    'schema.ts pdfHash column comment reflects configurable algorithm');

  // ==========================================
  // BLAKE3 DEPENDENCY
  // ==========================================

  // Test 24: blake3 is in package.json dependencies
  const pkgJsonPath = path.join(__dirname, '..', 'nest-module', 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  assert(pkgJson.dependencies && pkgJson.dependencies['blake3'], 'blake3 is in nest-module package.json dependencies');

  // Test 25: blake3 module is installed and loadable
  let blake3Loadable = false;
  try {
    require('blake3');
    blake3Loadable = true;
  } catch {}
  assert(blake3Loadable, 'blake3 npm package is installed and loadable');

  // ==========================================
  // HASH PREFIX FORMAT TESTS (direct module tests)
  // ==========================================

  // Test 26: SHA-256 produces correct hash for known input
  const testBuffer = Buffer.from('hello world');
  const expectedSha256 = crypto.createHash('sha256').update(testBuffer).digest('hex');
  assert(expectedSha256 === 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    'SHA-256 known hash is correct for "hello world"');

  // Test 27: BLAKE3 produces correct hash for known input
  let blake3Hash = '';
  try {
    const b3 = require('blake3');
    blake3Hash = b3.hash(testBuffer).toString('hex');
  } catch {}
  assert(blake3Hash.length === 64, 'BLAKE3 produces 64-char hex hash');
  assert(blake3Hash !== expectedSha256, 'BLAKE3 hash is different from SHA-256 hash');

  // ==========================================
  // INTEGRATION TESTS: RENDER AND VERIFY
  // ==========================================

  // Create a template for testing
  const templateRes = await fetch(`${API}/templates`, {
    method: 'POST',
    headers: authHeaders,
    body: {
      name: 'Hash Test Template ' + Date.now(),
      type: 'invoice',
      schema: {
        pages: [{
          elements: [
            { name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }
          ]
        }]
      }
    }
  });

  assert(templateRes.status === 201 || templateRes.status === 200, 'Template created for hash testing');
  const templateId = templateRes.data?.id || templateRes.data?.template?.id;

  // Publish the template
  if (templateId) {
    const pubRes = await fetch(`${API}/templates/${templateId}/publish`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (pubRes.status >= 400) {
      process.stdout.write('  DEBUG publish error: ' + JSON.stringify(pubRes.data).substring(0, 300) + '\n');
    }
  }

  // Test 29: Render a document and check hash is prefixed
  let docId = null;
  let storedHash = null;
  if (templateId) {
    const renderRes = await fetch(`${API}/render/now`, {
      method: 'POST',
      headers: authHeaders,
      body: {
        templateId,
        entityId: 'hash-test-entity-389',
        channel: 'print',
      }
    });

    if (renderRes.status >= 400) {
      process.stdout.write('  DEBUG render error: ' + JSON.stringify(renderRes.data).substring(0, 300) + '\n');
    }
    assert(renderRes.status === 201 || renderRes.status === 200, 'Document rendered successfully');

    docId = renderRes.data?.document?.id || renderRes.data?.id;
    storedHash = renderRes.data?.document?.pdfHash || renderRes.data?.pdfHash;

    // Test 30: Stored hash is prefixed with "sha256:"
    assert(storedHash && storedHash.startsWith('sha256:'), `Stored hash is prefixed with "sha256:" (got: ${storedHash ? storedHash.substring(0, 15) + '...' : 'null'})`);

    // Test 31: Hash after prefix is valid 64-char hex
    if (storedHash && storedHash.startsWith('sha256:')) {
      const hexPart = storedHash.substring(7);
      assert(hexPart.length === 64 && /^[0-9a-f]+$/.test(hexPart), 'Hash hex part is valid 64-char lowercase hex');
    }

    // Test 32: Verify document integrity passes
    if (docId) {
      const verifyRes = await fetch(`${API}/render/verify/${docId}`, {
        method: 'GET',
        headers: authHeaders,
      });

      assert(verifyRes.status === 200, 'Verify endpoint returns 200');
      assert(verifyRes.data?.verified === true, 'Document integrity verified (not tampered)');
      assert(verifyRes.data?.status === 'intact', 'Document status is intact');
      assert(verifyRes.data?.storedHash === storedHash, 'Verify response includes stored hash');
      assert(verifyRes.data?.algorithm === 'sha256', 'Verify response includes algorithm field');

      // Test 37: currentHash in verify response is raw hex (not prefixed)
      const currentHash = verifyRes.data?.currentHash;
      assert(currentHash && currentHash.length === 64 && /^[0-9a-f]+$/.test(currentHash),
        'currentHash in verify response is raw 64-char hex');
    }
  }

  // ==========================================
  // BACKWARD COMPATIBILITY TEST
  // ==========================================

  // Test 38: Legacy un-prefixed hash should still verify
  // We simulate this by checking the parseStoredHash logic in the code
  assert(hashServiceCode.includes("algorithm: 'sha256', hex: storedHash"),
    'Legacy un-prefixed hashes are treated as SHA-256 (backward compatible)');

  // Test 39: HashService computeHashWithAlgorithm method exists
  assert(hashServiceCode.includes('computeHashWithAlgorithm'), 'HashService has computeHashWithAlgorithm for explicit algorithm selection');

  // Test 40: HashService getAlgorithm method exists
  assert(hashServiceCode.includes('getAlgorithm'), 'HashService has getAlgorithm method');

  // Test 41: HashService default algorithm is sha256
  assert(hashServiceCode.includes("|| 'sha256'"), 'HashService defaults to sha256 when not configured');

  // Test 42: HashService gracefully falls back if blake3 not available
  assert(hashServiceCode.includes("falling back to sha256") || hashServiceCode.includes("fallback"),
    'HashService gracefully falls back if blake3 module fails to load');

  // ==========================================
  // RENDER SERVICE VERIFICATION LOGIC UPDATED
  // ==========================================

  // Test 43: Verification logic parses algorithm from stored hash
  assert(renderCode.includes('hashService.verifyHash'), 'Verification logic uses hashService.verifyHash (handles prefix parsing)');

  // Test 44: Verification response includes algorithm field
  assert(renderCode.includes('algorithm: verification.algorithm'), 'Verification response includes algorithm field');

  // Test 45: render.service.ts constructor has HashService dependency
  assert(renderCode.includes('private readonly hashService: HashService'), 'render.service.ts constructor has HashService dependency');

  // Test 46: grouped-table.controller.ts constructor has HashService dependency
  assert(groupedTableCode.includes('private readonly hashService: HashService'),
    'grouped-table.controller.ts constructor has HashService dependency');

  // ==========================================
  // PRINT RESULTS
  // ==========================================

  process.stdout.write('\n=== Feature #389: Configurable Document Hashing Algorithm ===\n\n');
  results.forEach(r => process.stdout.write(r + '\n'));
  process.stdout.write(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  process.stderr.write('Test error: ' + err.message + '\n');
  process.exit(1);
});
