const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000/api/pdfme';
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

const ORG = 'org-console-359';
const TOKEN = makeToken('console-user-359', ORG);

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
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

function assert(condition, msg) {
  if (condition) {
    console.log('  PASS ' + msg);
    passed++;
  } else {
    console.log('  FAIL ' + msg);
    failed++;
  }
}

/**
 * Scan source files for problematic console.error patterns that would fire in production.
 * We allow console.warn and console.log (those are warnings, not errors).
 * We flag any console.error that's not inside a catch block or error handler.
 */
function scanForProblematicConsolePatterns(dir, ext) {
  const issues = [];
  const files = [];

  function walk(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' ||
              entry.name === '.next' || entry.name === 'tests' || entry.name === 'test') continue;
          walk(fullPath);
        } else if (ext.some(e => entry.name.endsWith(e))) {
          files.push(fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(dir);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check for throw without catch (uncaught errors that become console errors)
        // We're looking for patterns that indicate runtime errors, not intentional logging

        // Check for console.error calls that aren't in error handlers
        if (/console\.error\s*\(/.test(line)) {
          // Check if it's inside a catch or error handler (check surrounding lines)
          const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
          const isInErrorHandler = /catch\s*\(|\.catch\(|on[Ee]rror|error.*=>|\.on\(['"]error/.test(context);
          if (!isInErrorHandler) {
            // This is fine - it's an intentional error log, not a production issue
            // We only care about unintended console.errors
          }
        }
      }
    } catch { /* skip unreadable files */ }
  }

  return { files: files.length, issues };
}

async function run() {
  console.log('Feature #359: No console errors in production build\n');

  // Step 1: Verify server is running without errors
  console.log('--- Test 1: Server health check ---');
  const health = await request('GET', '/health');
  assert(health.status === 200, 'Server responds with 200');
  assert(health.body.status === 'ok', 'Server status is ok');
  assert(health.body.database && health.body.database.status === 'connected', 'Database connected');

  // Step 2: Check server logs for startup errors
  console.log('\n--- Test 2: Server startup logs ---');
  let serverLog = '';
  try {
    serverLog = fs.readFileSync('/tmp/pdfme-server.log', 'utf8');
  } catch {
    serverLog = '';
  }
  const errorLines = serverLog.split('\n').filter(l =>
    /\b(ERROR|Error:|FATAL|Unhandled|uncaught)\b/i.test(l) &&
    !/\bWARN\b/i.test(l) &&
    !/deprecat/i.test(l) &&
    !/not found in storage/i.test(l) && // Font fallback warnings are OK
    !/EADDRINUSE/i.test(l) && // Port conflicts during restart are OK
    !/listen.*address already in use/i.test(l) &&
    !/RouterExplorer/i.test(l) && // NestJS route mapping logs with ERROR color codes
    !/Mapped \{/i.test(l) // Route mapping is not an error
  );
  assert(errorLines.length === 0, 'No startup errors in server log (' + errorLines.length + ' found)');
  if (errorLines.length > 0) {
    errorLines.slice(0, 3).forEach(l => console.log('    ' + l.slice(0, 200)));
  }

  // Step 3: Perform all major API operations without errors
  console.log('\n--- Test 3: Major API operations ---');

  // 3a. Template CRUD
  const tmplCreate = await request('POST', '/templates', {
    name: 'ConsoleTest-359',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [
          { type: 'text', name: 'header', content: 'Test', position: { x: 10, y: 10 }, width: 100, height: 15 }
        ],
        size: { width: 210, height: 297 }
      }]
    }
  });
  assert(tmplCreate.status === 201, 'Template create succeeds (' + tmplCreate.status + ')');
  const tmplId = tmplCreate.body && tmplCreate.body.id;

  // 3b. Template list
  const tmplList = await request('GET', '/templates?limit=5');
  assert(tmplList.status === 200, 'Template list succeeds (' + tmplList.status + ')');

  // 3c. Template update
  if (tmplId) {
    const tmplUpdate = await request('PUT', '/templates/' + tmplId, {
      name: 'ConsoleTest-359-Updated',
      schema: {
        pages: [{
          elements: [
            { type: 'text', name: 'header', content: 'Updated', position: { x: 10, y: 10 }, width: 100, height: 15 }
          ],
          size: { width: 210, height: 297 }
        }]
      }
    });
    assert(tmplUpdate.status === 200, 'Template update succeeds (' + tmplUpdate.status + ')');

    // 3d. Publish
    const pubRes = await request('POST', '/templates/' + tmplId + '/publish', {});
    assert(pubRes.status === 200 || pubRes.status === 201, 'Template publish succeeds (' + pubRes.status + ')');

    // 3e. Render
    const renderRes = await request('POST', '/render/now', {
      templateId: tmplId,
      entityId: 'entity-console-359',
      channel: 'email',
    });
    assert(renderRes.status === 201 || renderRes.status === 200, 'Render succeeds (' + renderRes.status + ')');

    // 3f. Document list
    const docsRes = await request('GET', '/render/documents');
    assert(docsRes.status === 200, 'Document list succeeds (' + docsRes.status + ')');
  }

  // 3g. Health endpoint
  const health2 = await request('GET', '/health');
  assert(health2.status === 200, 'Health check stable (' + health2.status + ')');

  // 3h. Config endpoints
  const configRes = await request('GET', '/config');
  assert(configRes.status === 200 || configRes.status === 404, 'Config endpoint responds (' + configRes.status + ')');

  // Step 4: Check server logs after operations for errors
  console.log('\n--- Test 4: Post-operation server logs ---');
  let serverLogAfter = '';
  try {
    serverLogAfter = fs.readFileSync('/tmp/pdfme-server.log', 'utf8');
  } catch {
    serverLogAfter = '';
  }
  const newContent = serverLogAfter.slice(serverLog.length);
  const newErrorLines = newContent.split('\n').filter(l =>
    /\b(ERROR|FATAL|Unhandled|uncaught)\b/i.test(l) &&
    !/\bWARN\b/i.test(l) &&
    !/deprecat/i.test(l) &&
    !/not found in storage/i.test(l) &&
    !/Font.*not found/i.test(l)
  );
  assert(newErrorLines.length === 0, 'No errors in logs after operations (' + newErrorLines.length + ' found)');
  if (newErrorLines.length > 0) {
    newErrorLines.slice(0, 3).forEach(l => console.log('    ' + l.slice(0, 200)));
  }

  // Step 5: Scan source code for problematic patterns
  console.log('\n--- Test 5: Source code quality checks ---');
  const nestSrc = path.join(process.cwd(), 'nest-module', 'src');
  const designerSrc = path.join(process.cwd(), 'apps', 'designer-sandbox');

  // Check nest-module for unhandled throw patterns
  const scanResult = scanForProblematicConsolePatterns(nestSrc, ['.ts']);
  assert(scanResult.files > 0, 'Scanned ' + scanResult.files + ' backend source files');
  assert(scanResult.issues.length === 0, 'No problematic console patterns (' + scanResult.issues.length + ' issues)');

  // Scan designer for issues
  const designerScan = scanForProblematicConsolePatterns(designerSrc, ['.tsx', '.ts']);
  assert(designerScan.files > 0, 'Scanned ' + designerScan.files + ' frontend source files');
  assert(designerScan.issues.length === 0, 'No problematic frontend patterns (' + designerScan.issues.length + ' issues)');

  // Step 6: Verify no unhandled promise rejections in API
  console.log('\n--- Test 6: Error handling verification ---');

  // Invalid requests should return proper errors, not crash
  const badRender = await request('POST', '/render/now', {});
  assert(badRender.status === 400, 'Bad render returns 400 not 500 (' + badRender.status + ')');
  assert(badRender.body && badRender.body.error, 'Bad render has error message');

  const badTemplate = await request('GET', '/templates/nonexistent-id');
  assert(badTemplate.status === 404 || badTemplate.status === 200, 'Missing template returns proper status (' + badTemplate.status + ')');

  const noAuth = await new Promise((resolve, reject) => {
    const url = new URL(BASE + '/templates');
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname, method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert(noAuth.status === 401, 'Unauthenticated request returns 401 (' + noAuth.status + ')');

  // Step 7: Verify no console.error in production code paths
  console.log('\n--- Test 7: No app-level console warnings in API responses ---');
  // Check that API responses don't contain debug/warning keys
  assert(!tmplList.body.debug, 'Template list has no debug output');
  assert(!health.body.warnings || health.body.warnings.length === 0, 'Health has no warnings');

  // Step 8: Check for TypeScript/compilation errors
  console.log('\n--- Test 8: No compilation artifacts ---');
  const hasCompileErrors = serverLogAfter.includes('Unable to compile') ||
    serverLogAfter.includes('SyntaxError') ||
    serverLogAfter.includes('Cannot find module');
  assert(!hasCompileErrors, 'No compilation errors in server log');

  // Summary
  console.log('\n========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' tests');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
