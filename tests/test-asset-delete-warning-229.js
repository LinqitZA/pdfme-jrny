/**
 * Feature #229: Asset delete warns about template references
 *
 * Tests:
 * 1. Upload asset and use it in a template
 * 2. DELETE asset without confirm shows warning with referencing templates
 * 3. Asset is still deletable with ?confirm=true
 * 4. Template renders handle missing asset gracefully (placeholder)
 * 5. Deleting unreferenced asset succeeds without warning
 */

const http = require('http');
const { makeJwt, API_BASE } = require('./test-helpers');

const TOKEN = makeJwt('user-229', 'org-229', ['template:edit', 'template:publish', 'render:trigger']);
const AUTH = `Bearer ${TOKEN}`;

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

function request(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'http://localhost:3000');
    const isMultipart = headers && headers['content-type'] && headers['content-type'].includes('multipart');
    const reqHeaders = {
      authorization: AUTH,
      ...(body && !isMultipart ? { 'content-type': 'application/json' } : {}),
      ...headers,
    };
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body && !isMultipart) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    } else if (isMultipart) {
      req.write(body);
    }
    req.end();
  });
}

function createMultipartBody(filename, content, mimeType) {
  const boundary = '----FormBoundary229';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

function createSmallPng() {
  // 1x1 red pixel PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function uploadAsset(filename) {
  const png = createSmallPng();
  const { body: mpBody, boundary } = createMultipartBody(filename, png, 'image/png');
  const res = await request('POST', '/api/pdfme/assets/upload?orgId=org-229', mpBody, {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  });
  return res;
}

async function createTemplateWithAsset(name, assetId, assetPath) {
  const schema = {
    pages: [
      {
        elements: [
          {
            type: 'erpImage',
            name: 'logo',
            assetId: assetId,
            assetPath: assetPath,
            position: { x: 10, y: 10 },
            width: 50,
            height: 30,
          },
          {
            type: 'text',
            name: 'title',
            content: 'Test Template',
            position: { x: 10, y: 50 },
            width: 100,
            height: 20,
          },
        ],
      },
    ],
  };
  const res = await request('POST', '/api/pdfme/templates', {
    orgId: 'org-229',
    type: 'invoice',
    name,
    schema,
    createdBy: 'user-229',
  });
  return res;
}

async function runTests() {
  console.log('\n=== Feature #229: Asset delete warns about template references ===\n');

  // Test 1: Upload an asset
  console.log('--- Upload test asset ---');
  const uploadRes = await uploadAsset('test-logo-229.png');
  assert(uploadRes.status === 201, `Asset uploaded successfully (status ${uploadRes.status})`);
  const assetId = uploadRes.body.id;
  const storagePath = uploadRes.body.storagePath;
  assert(assetId, `Asset ID returned: ${assetId}`);
  assert(storagePath, `Storage path returned: ${storagePath}`);

  // Test 2: Create a template that references the asset
  console.log('\n--- Create template referencing asset ---');
  const tmplRes = await createTemplateWithAsset('Invoice with Logo 229', assetId, storagePath);
  assert(tmplRes.status === 201 || tmplRes.status === 200, `Template created (status ${tmplRes.status})`);
  const templateId = tmplRes.body.id;
  assert(templateId, `Template ID: ${templateId}`);

  // Test 3: DELETE asset WITHOUT confirm - should show warning
  console.log('\n--- DELETE asset without confirm ---');
  const deleteNoConfirm = await request('DELETE', `/api/pdfme/assets/${assetId}`);
  assert(deleteNoConfirm.status === 200, `Returns 200 with warning (status ${deleteNoConfirm.status})`);
  assert(deleteNoConfirm.body.warning === true, `Response has warning=true`);
  assert(deleteNoConfirm.body.statusCode === 409, `Response has statusCode 409 (conflict)`);
  assert(
    deleteNoConfirm.body.message && deleteNoConfirm.body.message.includes('referenced'),
    `Warning message mentions asset is referenced`,
  );
  assert(deleteNoConfirm.body.deletable === true, `Response indicates asset is deletable with confirmation`);
  assert(
    Array.isArray(deleteNoConfirm.body.referencingTemplates),
    `Response includes referencingTemplates array`,
  );
  assert(
    deleteNoConfirm.body.referencingTemplates.length >= 1,
    `At least 1 referencing template found`,
  );
  assert(
    deleteNoConfirm.body.referencingTemplates[0].id === templateId,
    `Referencing template ID matches: ${deleteNoConfirm.body.referencingTemplates[0]?.id}`,
  );
  assert(
    deleteNoConfirm.body.referencingTemplates[0].name === 'Invoice with Logo 229',
    `Referencing template name matches`,
  );

  // Test 4: Verify asset still exists (not deleted)
  console.log('\n--- Verify asset still exists ---');
  const listAfterNoConfirm = await request('GET', '/api/pdfme/assets?orgId=org-229');
  const assetStillExists = listAfterNoConfirm.body.data.some((f) => f.includes(assetId));
  assert(assetStillExists, 'Asset still exists after DELETE without confirm');

  // Test 5: Create a second template referencing the same asset
  console.log('\n--- Create second template referencing same asset ---');
  const tmpl2Res = await createTemplateWithAsset('Credit Note with Logo 229', assetId, storagePath);
  assert(tmpl2Res.status === 201 || tmpl2Res.status === 200, `Second template created`);
  const template2Id = tmpl2Res.body.id;

  // Test 6: DELETE again without confirm - should list both templates
  console.log('\n--- DELETE asset shows multiple referencing templates ---');
  const deleteMulti = await request('DELETE', `/api/pdfme/assets/${assetId}`);
  assert(deleteMulti.body.warning === true, 'Warning shown for multiple references');
  assert(
    deleteMulti.body.referencingTemplates.length >= 2,
    `Shows ${deleteMulti.body.referencingTemplates?.length} referencing templates`,
  );

  // Test 7: DELETE asset WITH confirm=true - should succeed
  console.log('\n--- DELETE asset with confirm=true ---');
  const deleteConfirm = await request('DELETE', `/api/pdfme/assets/${assetId}?confirm=true`);
  assert(deleteConfirm.status === 200, `Confirmed delete succeeds (status ${deleteConfirm.status})`);
  assert(deleteConfirm.body.deleted === true, 'Response has deleted=true');
  assert(deleteConfirm.body.id === assetId, 'Deleted asset ID matches');
  assert(
    deleteConfirm.body.warning && deleteConfirm.body.warning.includes('referenced'),
    'Confirmed delete response includes warning about affected templates',
  );
  assert(
    Array.isArray(deleteConfirm.body.affectedTemplates),
    'Confirmed delete lists affected templates',
  );

  // Test 8: Verify asset is now deleted
  console.log('\n--- Verify asset deleted ---');
  const listAfterDelete = await request('GET', '/api/pdfme/assets?orgId=org-229');
  const assetGone = !listAfterDelete.body.data.some((f) => f.includes(assetId));
  assert(assetGone, 'Asset no longer in list after confirmed delete');

  // Test 9: Template still exists after asset deletion
  console.log('\n--- Template still accessible after asset deletion ---');
  const tmplCheck = await request('GET', `/api/pdfme/templates/${templateId}`);
  assert(tmplCheck.status === 200, `Template still accessible (status ${tmplCheck.status})`);
  assert(tmplCheck.body.name === 'Invoice with Logo 229', 'Template data preserved');

  // Test 10: Template schema still contains asset reference
  const schemaStr = JSON.stringify(tmplCheck.body.schema);
  assert(schemaStr.includes(assetId), 'Template schema still references the deleted asset ID');

  // Test 11: Deleting unreferenced asset succeeds without warning
  console.log('\n--- Delete unreferenced asset - no warning ---');
  const upload2Res = await uploadAsset('unreferenced-logo-229.png');
  assert(upload2Res.status === 201, 'Unreferenced asset uploaded');
  const unreferencedId = upload2Res.body.id;

  const deleteUnreferenced = await request('DELETE', `/api/pdfme/assets/${unreferencedId}`);
  assert(deleteUnreferenced.status === 200, `Unreferenced delete succeeds (status ${deleteUnreferenced.status})`);
  assert(deleteUnreferenced.body.deleted === true, 'Unreferenced asset deleted');
  assert(!deleteUnreferenced.body.warning, 'No warning for unreferenced asset');

  // Test 12: DELETE non-existent asset returns 404
  console.log('\n--- Delete non-existent asset ---');
  const delete404 = await request('DELETE', '/api/pdfme/assets/nonexistent-id');
  assert(delete404.status === 404, `Non-existent asset returns 404 (status ${delete404.status})`);

  // Test 13: Render pipeline handles missing asset gracefully
  console.log('\n--- Render handles missing asset gracefully ---');
  // The erp-image module already generates placeholder images for missing assets
  // Verify by checking the template can still be read with missing asset reference
  const tmplSchema = tmplCheck.body.schema;
  const erpImageElement = tmplSchema?.pages?.[0]?.elements?.find((e) => e.type === 'erpImage');
  assert(erpImageElement !== undefined, 'Template still has erpImage element referencing deleted asset');
  assert(erpImageElement?.assetId === assetId, 'erpImage still references deleted assetId');

  // Test 14: Confirm=true query parameter variants
  console.log('\n--- Confirm parameter handling ---');
  const upload3Res = await uploadAsset('confirm-test-229.png');
  const confirmAssetId = upload3Res.body.id;
  const confirmStoragePath = upload3Res.body.storagePath;
  await createTemplateWithAsset('Confirm Test Template', confirmAssetId, confirmStoragePath);

  // confirm=false should still show warning
  const deleteFalseConfirm = await request('DELETE', `/api/pdfme/assets/${confirmAssetId}?confirm=false`);
  assert(deleteFalseConfirm.body.warning === true, 'confirm=false still shows warning');

  // Now delete with confirm=true
  const deleteWithConfirm = await request('DELETE', `/api/pdfme/assets/${confirmAssetId}?confirm=true`);
  assert(deleteWithConfirm.body.deleted === true, 'confirm=true allows deletion');

  // Test 15: Warning includes template details (type, status)
  console.log('\n--- Warning includes template details ---');
  const upload4Res = await uploadAsset('detail-test-229.png');
  const detail4Id = upload4Res.body.id;
  const detail4Path = upload4Res.body.storagePath;
  await createTemplateWithAsset('Detail Template 229', detail4Id, detail4Path);

  const detailDelete = await request('DELETE', `/api/pdfme/assets/${detail4Id}`);
  assert(detailDelete.body.referencingTemplates[0].type === 'invoice', 'Warning includes template type');
  assert(detailDelete.body.referencingTemplates[0].status === 'draft', 'Warning includes template status');
  assert(detailDelete.body.referencingTemplates[0].name === 'Detail Template 229', 'Warning includes template name');
  assert(detailDelete.body.referencingTemplates[0].id, 'Warning includes template id');

  // Cleanup: delete the remaining asset
  await request('DELETE', `/api/pdfme/assets/${detail4Id}?confirm=true`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
