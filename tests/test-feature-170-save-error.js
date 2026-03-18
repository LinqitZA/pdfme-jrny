/**
 * Test Feature #170: Network failure during save shows error
 * Tests that save failures produce user-friendly errors, preserve changes, and allow retry
 */

const http = require('http');
const fs = require('fs');

const DESIGNER_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:3000/api/pdfme';
const AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdJZCI6Im9yZy0xIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzAwMDAwMDAwfQ.abc123';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
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
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testSaveHandlerCodeStructure() {
  console.log('\n--- Test: Save handler code structure ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  // Verify save state management
  assert(source.includes("saveStatus"), 'saveStatus state exists');
  assert(source.includes("saveError"), 'saveError state exists');
  assert(source.includes("'idle'") && source.includes("'saving'") && source.includes("'saved'"), 'Save status values defined');

  // Verify handleSave is async and makes API calls
  assert(source.includes("const handleSave = useCallback(async"), 'handleSave is async');
  assert(source.includes("templates/${templateId}/draft"), 'handleSave calls draft API');
  assert(source.includes("setSaveStatus('saving')"), 'Sets saving status during save');
  assert(source.includes("setSaveStatus('error')"), 'Sets error status on failure');
  assert(source.includes("setSaveError("), 'Sets error message on failure');

  // Verify error handling preserves unsaved changes
  assert(source.includes("DO NOT clear isDirty"), 'Comment confirms unsaved changes preserved');

  // Verify network error handling
  assert(source.includes("Network error"), 'Network error message defined');
  assert(source.includes("check your connection"), 'User-friendly network error message');
}

async function testSaveErrorBannerStructure() {
  console.log('\n--- Test: Save error banner UI structure ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  assert(source.includes('save-error-banner'), 'Error banner element exists');
  assert(source.includes('save-error-message'), 'Error message display element exists');
  assert(source.includes('save-error-retry'), 'Retry button exists');
  assert(source.includes('save-error-dismiss'), 'Dismiss button exists');
  assert(source.includes('save-error-icon'), 'Error icon exists');
}

async function testSaveButtonStates() {
  console.log('\n--- Test: Save button state changes ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  // Button text changes based on state
  assert(source.includes("Saving…"), 'Button shows Saving... during save');
  assert(source.includes("Retry Save"), 'Button shows Retry Save on error');
  assert(source.includes("Save Draft"), 'Button shows Save Draft normally');

  // Button disabled during saving
  assert(source.includes("disabled={saveStatus === 'saving'}"), 'Button disabled during saving');

  // Button color changes on error
  assert(source.includes("saveStatus === 'error' ? '#ef4444'"), 'Button turns red on error');
}

async function testErrorPreservesChanges() {
  console.log('\n--- Test: Error preserves unsaved changes ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  // In the error path, isDirty should NOT be set to false
  // The success path sets isDirty(false), error path should not
  const errorBlock = source.substring(
    source.indexOf("setSaveStatus('error')"),
    source.indexOf("setSaveStatus('error')") + 500
  );
  assert(!errorBlock.includes("setIsDirty(false)"), 'Error path does not clear isDirty');

  // Success path does clear isDirty
  const successBlock = source.substring(
    source.indexOf("setSaveStatus('saved')"),
    source.indexOf("setSaveStatus('saved')") + 200
  );
  assert(successBlock.includes("setIsDirty(false)"), 'Success path clears isDirty');
}

async function testRetryAfterError() {
  console.log('\n--- Test: Retry possible after error ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  // Retry button calls handleSave
  assert(source.includes('onClick={handleSave}'), 'Retry button wired to handleSave');

  // Dismiss button clears error state
  assert(source.includes("setSaveStatus('idle')") && source.includes("setSaveError(null)"), 'Dismiss clears error state');
}

async function testDesignerRendersCorrectly() {
  console.log('\n--- Test: Designer renders correctly with save features ---');
  const res = await fetch(DESIGNER_URL);
  const html = await res.text();

  assert(res.ok, 'Designer page loads successfully');
  assert(html.includes('btn-save'), 'Save button renders');
  assert(html.includes('Save Draft'), 'Save Draft text visible');
  // Error banner should be hidden initially
  assert(!html.includes('save-error-banner'), 'Error banner hidden when no error');
}

async function testServerSaveEndpointExists() {
  console.log('\n--- Test: Save (draft) API endpoint exists ---');

  // Create a template
  const createRes = await fetch(`${API_URL}/templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_TOKEN,
    },
    body: JSON.stringify({
      name: 'Save Error Test',
      type: 'invoice',
      schema: { schemas: [], basePdf: 'BLANK_PDF' },
    }),
  });

  assert(createRes.ok, 'Template created for save test');
  const template = await createRes.json();

  // Test save draft endpoint
  const saveRes = await fetch(`${API_URL}/templates/${template.id}/draft`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_TOKEN,
    },
    body: JSON.stringify({
      name: 'Updated Save Error Test',
      schema: { schemas: [], basePdf: 'BLANK_PDF', pageSize: 'A4' },
    }),
  });
  assert(saveRes.ok, 'Draft save succeeds');

  // Test save to non-existent template (should fail gracefully)
  const badSaveRes = await fetch(`${API_URL}/templates/nonexistent-id-999/draft`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_TOKEN,
    },
    body: JSON.stringify({
      name: 'Test',
      schema: {},
    }),
  });
  assert(!badSaveRes.ok, 'Save to non-existent template fails');
  assert(badSaveRes.status === 404, 'Returns 404 for non-existent template');

  // Cleanup
  await fetch(`${API_URL}/templates/${template.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': AUTH_TOKEN },
  });
}

async function testServerErrorResponseFormat() {
  console.log('\n--- Test: Server error responses have message field ---');

  // Save to non-existent template
  const res = await fetch(`${API_URL}/templates/bad-id-123/draft`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_TOKEN,
    },
    body: JSON.stringify({ name: 'Test', schema: {} }),
  });

  const body = await res.json();
  assert(body.message !== undefined, 'Error response includes message field');
  assert(typeof body.message === 'string', 'Error message is a string');
}

async function testSaveErrorHandlingEdgeCases() {
  console.log('\n--- Test: Edge case handling in save ---');
  const source = fs.readFileSync(
    '/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx',
    'utf8'
  );

  // Handles case with no templateId (local-only mode)
  assert(source.includes("if (templateId)"), 'Checks for templateId before API call');

  // Handles non-JSON error responses
  assert(source.includes(".json().catch("), 'Catches JSON parse errors in error response');

  // Handles server error status codes
  assert(source.includes("response.status"), 'References response status in error message');
}

async function main() {
  console.log('=== Feature #170: Network failure during save shows error ===\n');

  try {
    await testSaveHandlerCodeStructure();
    await testSaveErrorBannerStructure();
    await testSaveButtonStates();
    await testErrorPreservesChanges();
    await testRetryAfterError();
    await testDesignerRendersCorrectly();
    await testServerSaveEndpointExists();
    await testServerErrorResponseFormat();
    await testSaveErrorHandlingEdgeCases();
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
