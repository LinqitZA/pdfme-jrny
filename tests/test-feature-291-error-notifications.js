const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-291', 'test-org-291', ['template:edit', 'template:publish', 'render:trigger']);

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || TOKEN),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    results.push(`  ✓ ${name}`);
  } else {
    failed++;
    results.push(`  ✗ ${name}`);
  }
}

async function run() {
  // ──────────────────────────────────────────────────────────────────
  // SECTION 1: Save failure returns clear error message
  // (Simulates save failure by saving to nonexistent template)
  // ──────────────────────────────────────────────────────────────────

  // Test 1: Save to nonexistent template returns error with message
  const saveNonExistent = await request('PUT', '/templates/nonexistent-id-291/draft', {
    name: 'Test Template',
    schema: { schemas: [], basePdf: 'BLANK_PDF' },
  });
  assert(saveNonExistent.status === 404 || saveNonExistent.status === 400 || saveNonExistent.status === 422,
    'Save to nonexistent template returns error status');
  assert(saveNonExistent.body && saveNonExistent.body.message,
    'Save error response includes message field');

  // Test 2: Save with invalid schema returns error with descriptive message
  const createRes = await request('POST', '/templates', {
    name: 'Error Test 291',
    type: 'invoice',
    schema: { schemas: [], basePdf: 'BLANK_PDF' },
  });
  const templateId = createRes.body && createRes.body.id;

  assert(createRes.status === 201 || (createRes.body && createRes.body.id),
    'Template created successfully for testing');

  if (templateId) {
    const saveInvalid = await request('PUT', `/templates/${templateId}/draft`, {
      name: 'Error Test 291',
      schema: null,
    });
    assert(saveInvalid.status >= 400, 'Save with null schema returns error status');
    assert(saveInvalid.body && typeof saveInvalid.body.message === 'string',
      'Save with null schema returns error message');

    // Test 3: Save with invalid saveMode returns error with guidance
    const badSaveMode = await request('PUT', `/templates/${templateId}/draft`, {
      name: 'Error Test 291',
      schema: { schemas: [], basePdf: 'BLANK_PDF' },
      saveMode: 'invalidMode',
    });
    assert(badSaveMode.status === 400, 'Save with invalid saveMode returns 400');
    assert(badSaveMode.body && badSaveMode.body.message,
      'Invalid saveMode error includes message');
    assert(badSaveMode.body && badSaveMode.body.details && badSaveMode.body.details.length > 0,
      'Invalid saveMode error includes details with guidance');

    // ──────────────────────────────────────────────────────────────────
    // SECTION 2: Publish failure returns clear error message
    // (Template with no elements should fail publish validation)
    // ──────────────────────────────────────────────────────────────────

    // Test 4: Publish empty template returns validation error
    const publishEmpty = await request('POST', `/templates/${templateId}/publish`);
    assert(publishEmpty.status === 422 || publishEmpty.status === 400,
      'Publish empty template returns validation error status');
    assert(publishEmpty.body && publishEmpty.body.message,
      'Publish error response includes descriptive message');

    // Test 5: Publish error includes details array for guidance
    assert(publishEmpty.body && (
      (publishEmpty.body.details && publishEmpty.body.details.length > 0) ||
      (publishEmpty.body.errors && publishEmpty.body.errors.length > 0) ||
      publishEmpty.body.message.length > 10
    ), 'Publish error provides specific guidance about what to fix');

    // ──────────────────────────────────────────────────────────────────
    // SECTION 3: Render failure returns clear error message
    // ──────────────────────────────────────────────────────────────────

    // Test 6: Render with missing fields returns error with message
    const renderMissing = await request('POST', '/render/now', {});
    assert(renderMissing.status === 400, 'Render with missing fields returns 400');
    assert(renderMissing.body && renderMissing.body.message,
      'Render error includes message field');

    // Test 7: Render with invalid templateId returns error
    const renderBadTemplate = await request('POST', '/render/now', {
      templateId: 'nonexistent-render-291',
      entityId: 'entity-1',
      data: { company: { name: 'Test' } },
    });
    assert(renderBadTemplate.status >= 400, 'Render with nonexistent template returns error');
    assert(renderBadTemplate.body && renderBadTemplate.body.message,
      'Render nonexistent template error includes message');

    // Test 8: Render with invalid channel returns error with guidance
    const renderBadChannel = await request('POST', '/render/now', {
      templateId: templateId,
      entityId: 'entity-1',
      data: { company: { name: 'Test' } },
      channel: 'fax',
    });
    assert(renderBadChannel.status === 400, 'Render with invalid channel returns 400');
    assert(renderBadChannel.body && renderBadChannel.body.details && renderBadChannel.body.details.length > 0,
      'Invalid channel error includes details with valid options');

    // ──────────────────────────────────────────────────────────────────
    // SECTION 4: Bulk render failure returns clear error
    // ──────────────────────────────────────────────────────────────────

    // Test 9: Bulk render with missing entityIds returns error
    const bulkMissing = await request('POST', '/render/bulk', {
      templateId: templateId,
    });
    assert(bulkMissing.status === 400, 'Bulk render missing entityIds returns 400');
    assert(bulkMissing.body && bulkMissing.body.message,
      'Bulk render error includes message');

    // Test 10: Bulk render with duplicate entityIds returns error with guidance
    const bulkDuplicates = await request('POST', '/render/bulk', {
      templateId: templateId,
      entityIds: ['ent-1', 'ent-1', 'ent-2'],
    });
    assert(bulkDuplicates.status === 400, 'Bulk render with duplicates returns 400');
    assert(bulkDuplicates.body && bulkDuplicates.body.message,
      'Bulk duplicate error includes message');

    // ──────────────────────────────────────────────────────────────────
    // SECTION 5: Error responses are structured (non-blocking)
    // All errors return JSON with consistent structure
    // ──────────────────────────────────────────────────────────────────

    // Test 11: Error responses always have statusCode
    assert(typeof saveNonExistent.body.statusCode === 'number' || typeof saveNonExistent.body.status === 'number',
      'Error response includes status code');

    // Test 12: Error responses are JSON (not HTML error pages)
    assert(typeof saveNonExistent.body === 'object',
      'Error response is JSON object, not HTML page');

    // Test 13: After error, server still accepts valid requests (non-blocking)
    const healthAfter = await request('GET', '/health', null, TOKEN);
    assert(healthAfter.status === 200, 'Server still responds after error operations');

    // Test 14: Can still create templates after errors (other operations not blocked)
    const createAfterError = await request('POST', '/templates', {
      name: 'Post-Error Template 291',
      type: 'statement',
      schema: { schemas: [], basePdf: 'BLANK_PDF' },
    });
    assert(createAfterError.status === 201, 'Can create templates after errors (operations not blocked)');
    const secondTemplateId = createAfterError.body && createAfterError.body.id;

    // Test 15: Can save drafts on different templates after errors
    if (secondTemplateId) {
      const saveOther = await request('PUT', `/templates/${secondTemplateId}/draft`, {
        name: 'Post-Error Template 291 Updated',
        schema: { schemas: [], basePdf: 'BLANK_PDF' },
      });
      assert(saveOther.status === 200, 'Can save drafts on other templates after errors');
    } else {
      assert(false, 'Can save drafts on other templates after errors');
    }

    // ──────────────────────────────────────────────────────────────────
    // SECTION 6: Error messages are descriptive (not generic)
    // ──────────────────────────────────────────────────────────────────

    // Test 16: Save error message is specific, not generic
    assert(
      saveNonExistent.body.message !== 'Internal Server Error' &&
      saveNonExistent.body.message !== 'Error' &&
      saveNonExistent.body.message.length > 5,
      'Save error message is specific and descriptive');

    // Test 17: Render error message is specific
    assert(
      renderMissing.body.message !== 'Internal Server Error' &&
      renderMissing.body.message !== 'Error' &&
      renderMissing.body.message.length > 5,
      'Render error message is specific and descriptive');

    // Test 18: Publish error message is specific
    assert(
      publishEmpty.body.message !== 'Internal Server Error' &&
      publishEmpty.body.message !== 'Error' &&
      publishEmpty.body.message.length > 5,
      'Publish error message is specific and descriptive');

    // ──────────────────────────────────────────────────────────────────
    // SECTION 7: Verify UI code has error notification elements
    // (Read ErpDesigner source to verify error UI patterns)
    // ──────────────────────────────────────────────────────────────────

    // Read the ErpDesigner source to verify UI error patterns
    const fs = require('fs');
    const designerSrc = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/ErpDesigner.tsx', 'utf8');

    // Test 19: Save error banner exists with retry
    assert(designerSrc.includes('save-error-banner'), 'UI has save error banner element');
    assert(designerSrc.includes('save-error-retry'), 'UI has save error retry button');
    assert(designerSrc.includes('save-error-message'), 'UI has save error message display');
    assert(designerSrc.includes('save-error-dismiss'), 'UI has save error dismiss button');

    // Test 20: Publish error banner exists with retry
    assert(designerSrc.includes('publish-error-banner'), 'UI has publish error banner element');
    assert(designerSrc.includes('publish-error-retry'), 'UI has publish error retry button');
    assert(designerSrc.includes('publish-error-message'), 'UI has publish error message display');

    // Test 21: Render error display exists
    assert(designerSrc.includes('render-error-icon'), 'UI has render error icon');
    assert(designerSrc.includes('render-message'), 'UI has render message display');
    assert(designerSrc.includes('render-dismiss'), 'UI has render dismiss button');

    // Test 22: Toast notification system exists
    assert(designerSrc.includes('toast-container'), 'UI has toast notification container');
    assert(designerSrc.includes('toast-dismiss'), 'UI has toast dismiss button');
    assert(designerSrc.includes("addToast('error'"), 'UI uses error toasts for failures');

    // Test 23: Error notifications don't block - other buttons still in DOM
    // Verify save error banner is conditionally rendered (not replacing entire UI)
    assert(designerSrc.includes("saveStatus === 'error' && saveError"), 'Save error banner is conditionally rendered');
    assert(designerSrc.includes("publishStatus === 'error' && publishError"), 'Publish error banner is conditionally rendered');

    // Test 24: Retry guidance - save button shows retry state
    assert(designerSrc.includes("Retry Save") || designerSrc.includes("'Retry Save'"),
      'Save button shows Retry Save text on error');
    assert(designerSrc.includes("Retry Publish") || designerSrc.includes("'Retry Publish'"),
      'Publish button shows Retry Publish text on error');

    // Test 25: Error state management - errors can be cleared
    assert(designerSrc.includes("setSaveStatus('idle')") && designerSrc.includes("setSaveError(null)"),
      'Save error can be dismissed (state cleared)');
    assert(designerSrc.includes("setPublishStatus('idle')") && designerSrc.includes("setPublishError(null)"),
      'Publish error can be dismissed (state cleared)');

    // Test 26: Network error friendly message
    assert(designerSrc.includes('Network error') && designerSrc.includes('check your connection'),
      'Network errors show user-friendly message with guidance');

    // Test 27: Load error has retry
    assert(designerSrc.includes('loadError'), 'UI handles template load errors');

    // Cleanup
    if (templateId) await request('DELETE', `/templates/${templateId}`);
    if (secondTemplateId) await request('DELETE', `/templates/${secondTemplateId}`);
  } else {
    // Template creation failed - add failure markers
    for (let i = 0; i < 25; i++) {
      assert(false, `Skipped - template creation failed (test ${i + 2})`);
    }
  }

  // Print results
  process.stdout.write('\n=== Feature #291: Error notification on failed operations ===\n');
  results.forEach(r => process.stdout.write(r + '\n'));
  process.stdout.write(`\nTotal: ${passed} passed, ${failed} failed out of ${passed + failed}\n\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stderr.write('Test runner error: ' + err.message + '\n');
  process.exit(1);
});
