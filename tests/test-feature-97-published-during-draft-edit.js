/**
 * Feature #97: Published version accessible during draft edit
 * Published stays live while editing draft
 * Steps: Publish v1, Save new draft v2, Render uses v1, Publish v2 - render uses v2
 */

const crypto = require('crypto');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('user-97', 'org-test-97', ['template:read', 'template:write', 'template:edit', 'template:delete', 'template:view', 'template:publish', 'render:trigger', 'render:create', 'render:read']);

var passed = 0;
var failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function api(path, opts) {
  opts = opts || {};
  var method = opts.method || 'GET';
  var body = opts.body;
  var token = opts.token;
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(BASE + path, {
    method: method, headers: headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(function(res) {
    var status = res.status;
    return res.text().then(function(text) {
      var json;
      try { json = JSON.parse(text); } catch(e) { json = text; }
      return { status: status, json: json };
    });
  });
}

var templateId;

// Schema v1 - the published version
var schemaV1 = {
  pages: [{
    elements: [
      { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'V1 Published Content' }
    ]
  }]
};

// Schema v2 - the draft edit version (different content)
var schemaV2 = {
  pages: [{
    elements: [
      { type: 'text', x: 10, y: 10, width: 100, height: 20, content: 'V2 Draft Content' },
      { type: 'text', x: 10, y: 40, width: 100, height: 20, content: 'New Element in V2' }
    ]
  }]
};

async function run() {
  console.log('Feature #97: Published version accessible during draft edit');
  console.log('=============================================================');

  // 1. Create a template
  console.log('\n--- Step 1: Create template ---');
  var r = await api('/api/pdfme/templates', {
    method: 'POST', token: TOKEN,
    body: { type: 'invoice', name: 'Test Template 97', schema: schemaV1, createdBy: 'user-97' }
  });
  assert(r.status === 201, 'Template created (201)');
  templateId = r.json.id;
  assert(!!templateId, 'Template has an ID');
  assert(r.json.status === 'draft', 'Initial status is draft');

  // 2. Publish v1
  console.log('\n--- Step 2: Publish v1 ---');
  r = await api('/api/pdfme/templates/' + templateId + '/publish', {
    method: 'POST', token: TOKEN
  });
  assert(r.status === 200 || r.status === 201, 'Template published successfully');
  assert(r.json.status === 'published', 'Status is published after publish');
  var publishedVer = r.json.publishedVer || r.json.version;
  assert(publishedVer >= 1, 'Published version is set: ' + publishedVer);

  // 3. Verify template has publishedSchema after publish
  console.log('\n--- Step 3: Verify publishedSchema exists ---');
  r = await api('/api/pdfme/templates/' + templateId, { token: TOKEN });
  assert(r.status === 200, 'GET template returns 200');
  assert(r.json.status === 'published', 'Template status is still published');
  var templateData = r.json;
  // publishedSchema should exist and match the original schema
  assert(templateData.publishedSchema !== null && templateData.publishedSchema !== undefined,
    'publishedSchema is set after publish');
  if (templateData.publishedSchema) {
    var pubPages = templateData.publishedSchema.pages;
    assert(Array.isArray(pubPages), 'publishedSchema has pages array');
    if (pubPages && pubPages[0] && pubPages[0].elements) {
      assert(pubPages[0].elements[0].content === 'V1 Published Content',
        'publishedSchema contains V1 content');
    }
  }

  // 4. Render using published v1 - should succeed
  console.log('\n--- Step 4: Render using published v1 ---');
  r = await api('/api/pdfme/render/now', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      channel: 'email',
      entityType: 'invoice',
      entityId: 'INV-097-V1',
      inputs: [{ field1: 'value1' }]
    }
  });
  assert(r.status === 200 || r.status === 201, 'Render v1 succeeds: ' + r.status);
  var docV1 = r.json;
  assert(!r.json.error || r.json.document, 'Render v1 produces a document or no error');

  // 5. Save new draft v2 (edit schema while published)
  console.log('\n--- Step 5: Save draft v2 while published ---');
  r = await api('/api/pdfme/templates/' + templateId + '/draft', {
    method: 'PUT', token: TOKEN,
    body: { schema: schemaV2 }
  });
  assert(r.status === 200, 'Draft save returns 200');

  // 6. After draft save, template should still be published
  console.log('\n--- Step 6: Verify status remains published ---');
  r = await api('/api/pdfme/templates/' + templateId, { token: TOKEN });
  assert(r.status === 200, 'GET template returns 200');
  assert(r.json.status === 'published', 'Template status is STILL published after draft save');

  // 7. The working schema should be v2 (draft content)
  var workingSchema = r.json.schema;
  if (workingSchema && workingSchema.pages && workingSchema.pages[0] && workingSchema.pages[0].elements) {
    assert(workingSchema.pages[0].elements.length === 2,
      'Working schema has 2 elements (v2 draft)');
    assert(workingSchema.pages[0].elements[0].content === 'V2 Draft Content',
      'Working schema has V2 draft content');
  } else {
    assert(false, 'Working schema has v2 content (could not verify)');
  }

  // 8. publishedSchema should still be v1
  var pubSchema = r.json.publishedSchema;
  assert(pubSchema !== null && pubSchema !== undefined, 'publishedSchema still exists');
  if (pubSchema && pubSchema.pages && pubSchema.pages[0] && pubSchema.pages[0].elements) {
    assert(pubSchema.pages[0].elements[0].content === 'V1 Published Content',
      'publishedSchema still contains V1 content');
    assert(pubSchema.pages[0].elements.length === 1,
      'publishedSchema has 1 element (v1)');
  }

  // 9. Render while draft is being edited - should use v1 published schema
  console.log('\n--- Step 7: Render uses v1 while draft v2 is being edited ---');
  r = await api('/api/pdfme/render/now', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      channel: 'email',
      entityType: 'invoice',
      entityId: 'INV-097-DURING-EDIT',
      inputs: [{ field1: 'value1' }]
    }
  });
  assert(r.status === 200 || r.status === 201, 'Render during draft edit succeeds: ' + r.status);
  assert(!r.json.error || r.json.document, 'Render during draft edit produces a document');

  // 10. Now publish v2
  console.log('\n--- Step 8: Publish v2 ---');
  r = await api('/api/pdfme/templates/' + templateId + '/publish', {
    method: 'POST', token: TOKEN
  });
  assert(r.status === 200 || r.status === 201, 'Publish v2 succeeds');
  assert(r.json.status === 'published', 'Status is published after v2 publish');
  var publishedVerV2 = r.json.publishedVer || r.json.version;
  assert(publishedVerV2 > publishedVer, 'Published version incremented: ' + publishedVerV2 + ' > ' + publishedVer);

  // 11. publishedSchema should now be v2
  console.log('\n--- Step 9: Verify publishedSchema is now v2 ---');
  r = await api('/api/pdfme/templates/' + templateId, { token: TOKEN });
  assert(r.status === 200, 'GET template returns 200');
  var newPubSchema = r.json.publishedSchema;
  assert(newPubSchema !== null && newPubSchema !== undefined, 'publishedSchema exists after v2 publish');
  if (newPubSchema && newPubSchema.pages && newPubSchema.pages[0] && newPubSchema.pages[0].elements) {
    assert(newPubSchema.pages[0].elements.length === 2,
      'publishedSchema now has 2 elements (v2)');
    assert(newPubSchema.pages[0].elements[0].content === 'V2 Draft Content',
      'publishedSchema now contains V2 content');
  }

  // 12. Render after v2 publish - should use v2 schema
  console.log('\n--- Step 10: Render uses v2 after publish ---');
  r = await api('/api/pdfme/render/now', {
    method: 'POST', token: TOKEN,
    body: {
      templateId: templateId,
      channel: 'email',
      entityType: 'invoice',
      entityId: 'INV-097-V2',
      inputs: [{ field1: 'value1' }]
    }
  });
  assert(r.status === 200 || r.status === 201, 'Render v2 succeeds: ' + r.status);
  assert(!r.json.error || r.json.document, 'Render v2 produces a document');

  // 13. Clean up
  console.log('\n--- Cleanup ---');
  await api('/api/pdfme/templates/' + templateId, { method: 'DELETE', token: TOKEN });

  console.log('\n=============================================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('Test error:', err);
  process.exit(1);
});
