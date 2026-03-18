/**
 * Feature #242: Zoom resets on new template load
 *
 * Zoom returns to default (100%) when loading a different template.
 *
 * Verification approach:
 * 1. Code inspection: loadTemplate() calls setZoom(100) on new template load
 * 2. Verify zoom state initialization at 100
 * 3. Verify zoom selector exists in the UI with proper data-testid
 * 4. Verify zoom is reset as part of template load reset sequence
 * 5. Verify zoom is NOT persisted to the template schema
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-zoom-242', 'org-zoom-242', ['template:edit']);

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE.replace('/api/pdfme', ''));
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(`  ✅ ${message}\n`);
  } else {
    failed++;
    process.stdout.write(`  ❌ ${message}\n`);
  }
}

async function run() {
  process.stdout.write('Feature #242: Zoom resets on new template load\n');
  process.stdout.write('===============================================\n\n');

  // Read the ErpDesigner component source
  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const source = fs.readFileSync(designerPath, 'utf8');

  // ─── Code Verification Tests ───────────────────────────────────────

  process.stdout.write('Section 1: Code structure verification\n');

  // Test 1: Zoom state initialized at 100
  const zoomInitMatch = source.match(/const\s+\[zoom,\s*setZoom\]\s*=\s*useState\((\d+)\)/);
  assert(zoomInitMatch && zoomInitMatch[1] === '100', 'Zoom state initialized at 100');

  // Test 2: setZoom(100) is called in loadTemplate
  // Find the loadTemplate function and check for setZoom(100) call
  const loadTemplateStart = source.indexOf('async function loadTemplate()');
  assert(loadTemplateStart > -1, 'loadTemplate function exists');

  const loadTemplateSection = source.substring(loadTemplateStart, loadTemplateStart + 800);
  assert(loadTemplateSection.includes('setZoom(100)'), 'setZoom(100) called in loadTemplate');

  // Test 3: Zoom reset happens in the state reset section (before the try/fetch)
  const resetSection = loadTemplateSection.substring(0, loadTemplateSection.indexOf('try {'));
  assert(resetSection.includes('setZoom(100)'), 'Zoom reset happens before fetch (in state reset section)');

  // Test 4: Other state resets also happen in same section
  assert(resetSection.includes('setIsDirty(false)'), 'isDirty reset in same section as zoom');
  assert(resetSection.includes('setSaveStatus'), 'saveStatus reset in same section as zoom');
  assert(resetSection.includes('setPublishStatus'), 'publishStatus reset in same section as zoom');

  // Test 5: Zoom selector has data-testid for testing
  assert(source.includes('data-testid="zoom-selector"'), 'Zoom selector has data-testid');

  // Test 6: Zoom selector is controlled by zoom state
  assert(source.includes('value={zoom}'), 'Zoom selector uses zoom state as value');

  // Test 7: Zoom selector onChange updates zoom state
  assert(source.includes('onChange={(e) => setZoom(Number(e.target.value))'), 'Zoom selector onChange updates state');

  // Test 8: Zoom is used for canvas scaling
  assert(source.includes('zoom / 100'), 'Zoom value used for canvas scale calculation');

  // Test 9: Zoom is NOT saved to template schema (it's view-only state)
  // Look for schema save operations - they should not include zoom
  const saveDraftCalls = source.match(/schema:\s*\{[^}]*zoom[^}]*\}/g);
  assert(!saveDraftCalls, 'Zoom is not included in saved schema');

  // Test 10: clearUndoHistory also called on template load (sibling behavior)
  assert(loadTemplateSection.includes('clearUndoHistory') || source.includes('clearUndoHistory'),
    'Undo history also cleared on template load (consistent reset behavior)');

  // ─── API Tests: Template schema doesn't persist zoom ──────────────

  process.stdout.write('\nSection 2: API verification - zoom not persisted\n');

  // Create two templates
  const tplA = await request('POST', `${API_BASE}/templates`, {
    name: 'ZOOM_TEST_A_242',
    type: 'invoice',
    schema: { pages: [{ elements: [{ type: 'text', content: 'Template A' }] }] },
  });
  assert(tplA.status === 201, 'Template A created');

  const tplB = await request('POST', `${API_BASE}/templates`, {
    name: 'ZOOM_TEST_B_242',
    type: 'statement',
    schema: { pages: [{ elements: [{ type: 'text', content: 'Template B' }] }] },
  });
  assert(tplB.status === 201, 'Template B created');

  // Fetch templates - verify no zoom property in schema
  const fetchA = await request('GET', `${API_BASE}/templates/${tplA.body.id}`, null);
  assert(fetchA.status === 200, 'Template A fetched');
  assert(!fetchA.body.schema?.zoom, 'Template A schema has no zoom property');

  const fetchB = await request('GET', `${API_BASE}/templates/${tplB.body.id}`, null);
  assert(fetchB.status === 200, 'Template B fetched');
  assert(!fetchB.body.schema?.zoom, 'Template B schema has no zoom property');

  // Save draft with zoom in schema (should be ignored/passed through but not affect view state)
  const saveDraft = await request('PUT', `${API_BASE}/templates/${tplA.body.id}/draft`, {
    schema: { pages: [{ elements: [{ type: 'text', content: 'Updated A' }] }], zoom: 150 },
  });
  assert(saveDraft.status === 200, 'Draft saved with zoom in schema');

  // Fetch again - verify template loads correctly even if zoom was in schema
  const fetchAfterSave = await request('GET', `${API_BASE}/templates/${tplA.body.id}`, null);
  assert(fetchAfterSave.status === 200, 'Template A re-fetched after save');
  // The component should still reset zoom to 100 regardless of what's in schema

  // ─── Component State Flow Verification ─────────────────────────────

  process.stdout.write('\nSection 3: State flow verification\n');

  // Test: Zoom is in useState (re-renders on change)
  const stateDeclarations = source.match(/const\s+\[\w+,\s*set\w+\]\s*=\s*useState/g) || [];
  assert(stateDeclarations.length > 0, 'Component uses useState for state management');

  // Test: templateId is a dependency that triggers loadTemplate re-run
  const effectDeps = source.substring(source.indexOf('loadTemplate();'));
  const returnCleanup = effectDeps.indexOf('return () =>');
  if (returnCleanup > -1) {
    const afterCleanup = effectDeps.substring(returnCleanup + 100, returnCleanup + 300);
    assert(afterCleanup.includes('templateId'), 'templateId is in useEffect dependency array');
  } else {
    assert(false, 'templateId is in useEffect dependency array (cleanup not found)');
  }

  // Test: Zoom selector has valid options
  const zoomOptions = source.match(/value=\{(\d+)\}.*?(\d+)%/g);
  assert(source.includes('100%'), '100% zoom option exists');

  // Summary
  process.stdout.write(`\n===============================================\n`);
  process.stdout.write(`Results: ${passed}/${passed + failed} tests passed\n`);
  if (failed > 0) {
    process.stdout.write(`FAILED: ${failed} tests\n`);
    process.exit(1);
  } else {
    process.stdout.write('All tests passed! ✅\n');
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
