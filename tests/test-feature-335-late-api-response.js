/**
 * Feature #335: Late API response handled in designer
 *
 * Tests verify:
 * 1. Save generation counter prevents late responses from clearing dirty flag
 * 2. isSavingRef prevents double saves
 * 3. Slow save completion doesn't overwrite newer changes
 * 4. UI state management correctly tracks save generations
 *
 * This is a concurrency/state management feature verified through:
 * - Source code analysis of the save mechanism
 * - API endpoint behavior (save works correctly)
 * - Save generation counter logic verification
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = `org-late-${Date.now()}`;

function makeToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-335',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken();

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

async function run() {
  console.log('Feature #335: Late API response handled in designer\n');

  // Test 1: Source code has save generation counter
  console.log('Test 1: Save generation counter exists in source');
  const designerSrc = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf-8'
  );

  assert(designerSrc.includes('saveGenerationRef'), 'saveGenerationRef exists in source');
  assert(designerSrc.includes('const saveGen = saveGenerationRef.current'), 'Manual save captures generation');
  assert(designerSrc.includes('const autoSaveGen = saveGenerationRef.current'), 'Auto-save captures generation');
  assert(designerSrc.includes('saveGenerationRef.current === saveGen'), 'Manual save checks generation before clearing dirty');
  assert(designerSrc.includes('saveGenerationRef.current === autoSaveGen'), 'Auto-save checks generation before clearing dirty');
  assert(designerSrc.includes('const retryGen = saveGenerationRef.current'), 'Retry save captures generation');

  // Test 2: Generation increments when dirty
  console.log('\nTest 2: Generation increments on dirty changes');
  assert(
    designerSrc.includes('if (isDirty) {') && designerSrc.includes('saveGenerationRef.current += 1'),
    'Generation increments when isDirty becomes true'
  );

  // Test 3: isSavingRef prevents double saves
  console.log('\nTest 3: Double-save prevention');
  assert(designerSrc.includes('if (isSavingRef.current) return'), 'isSavingRef prevents double saves');
  assert(designerSrc.includes('isSavingRef.current = true'), 'isSavingRef set to true on save start');
  assert(designerSrc.includes('isSavingRef.current = false'), 'isSavingRef reset on save end');

  // Test 4: Save doesn't overwrite local state
  console.log('\nTest 4: Save response doesn\'t overwrite local state');
  // Verify that the save success handler ONLY sets status flags, not page/element data
  const saveSuccessBlock = designerSrc.substring(
    designerSrc.indexOf("if (response.ok) {", designerSrc.indexOf("const handleSave")),
    designerSrc.indexOf("} else {", designerSrc.indexOf("if (response.ok) {", designerSrc.indexOf("const handleSave")))
  );
  assert(!saveSuccessBlock.includes('setPages('), 'Save response does not call setPages');
  assert(!saveSuccessBlock.includes('setName('), 'Save response does not call setName');
  assert(!saveSuccessBlock.includes('setPageSize('), 'Save response does not call setPageSize');
  assert(!saveSuccessBlock.includes('setElements('), 'Save response does not call setElements');
  assert(saveSuccessBlock.includes('setSaveStatus'), 'Save response only updates status');

  // Test 5: isDirty preserved on save error
  console.log('\nTest 5: isDirty preserved on save error');
  assert(designerSrc.includes('// DO NOT clear isDirty - unsaved changes preserved for retry'),
    'Error handler preserves isDirty with explicit comment');

  // Test 6: API save endpoint works correctly (actual API test)
  console.log('\nTest 6: Save endpoint accepts and persists data');
  const createResult = await apiRequest('POST', '/api/pdfme/templates', {
    name: 'Late Response Test',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [] },
  });
  assert(createResult.status === 201, `Template created (status ${createResult.status})`);
  const templateId = createResult.body.id;

  // Save version 1
  const save1 = await apiRequest('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'Version 1',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [{ type: 'text', content: 'V1' }] }] },
  });
  assert(save1.status === 200, `Save V1 succeeded (status ${save1.status})`);

  // Save version 2 immediately (simulating rapid saves)
  const save2 = await apiRequest('PUT', `/api/pdfme/templates/${templateId}/draft`, {
    name: 'Version 2',
    schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [{ type: 'text', content: 'V2' }] }] },
  });
  assert(save2.status === 200, `Save V2 succeeded (status ${save2.status})`);

  // Verify latest version is V2
  const getResult = await apiRequest('GET', `/api/pdfme/templates/${templateId}`);
  assert(getResult.status === 200, 'Template retrieved');
  assert(getResult.body.name === 'Version 2', `Latest name is 'Version 2' (got '${getResult.body.name}')`);

  // Test 7: Concurrent saves don't corrupt data
  console.log('\nTest 7: Concurrent saves resolve correctly');
  const concurrentSaves = await Promise.all([
    apiRequest('PUT', `/api/pdfme/templates/${templateId}/draft`, {
      name: 'Concurrent A',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [{ type: 'text', content: 'A' }] }] },
    }),
    apiRequest('PUT', `/api/pdfme/templates/${templateId}/draft`, {
      name: 'Concurrent B',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4', pages: [{ elements: [{ type: 'text', content: 'B' }] }] },
    }),
  ]);
  assert(concurrentSaves[0].status === 200, 'Concurrent save A completed');
  assert(concurrentSaves[1].status === 200, 'Concurrent save B completed');

  // After concurrent saves, one of them should be the latest
  const afterConcurrent = await apiRequest('GET', `/api/pdfme/templates/${templateId}`);
  assert(
    afterConcurrent.body.name === 'Concurrent A' || afterConcurrent.body.name === 'Concurrent B',
    `Latest is one of the concurrent saves (got '${afterConcurrent.body.name}')`
  );

  // Test 8: Save captures state at call time (closure test)
  console.log('\nTest 8: Save uses closure-captured state');
  // The handleSave callback captures name, pageSize, pages in its dependency array
  const handleSaveMatch = designerSrc.match(/const handleSave = useCallback\(async \(\) => \{[\s\S]*?\}, \[([^\]]+)\]\)/);
  if (handleSaveMatch) {
    const deps = handleSaveMatch[1];
    assert(deps.includes('name'), 'handleSave depends on name');
    assert(deps.includes('pageSize'), 'handleSave depends on pageSize');
    assert(deps.includes('pages'), 'handleSave depends on pages');
  } else {
    assert(false, 'handleSave useCallback dependency array found');
  }

  // Test 9: Generation check in conditional dirty clearing
  console.log('\nTest 9: Conditional dirty flag clearing');
  // In manual save success
  const manualSaveGen = designerSrc.includes('if (saveGenerationRef.current === saveGen) {\n            setIsDirty(false)');
  assert(manualSaveGen, 'Manual save conditionally clears dirty based on generation');

  // In auto-save success
  const autoSaveGen = designerSrc.includes('if (saveGenerationRef.current === autoSaveGen) {\n          setIsDirty(false)');
  assert(autoSaveGen, 'Auto-save conditionally clears dirty based on generation');

  // Cleanup
  await apiRequest('DELETE', `/api/pdfme/templates/${templateId}`);

  console.log(`\n=============================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
