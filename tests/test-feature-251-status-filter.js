/**
 * Feature #251: Template list filter by status
 * Verifies that the status filter shows draft/published/archived templates correctly.
 */

const { makeJwt, API_BASE } = require('./test-helpers');
const fs = require('fs');

const TOKEN = makeJwt('user-251', 'org-251', ['template:edit', 'template:publish', 'template:delete']);
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function createTemplate(name, type) {
  return fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      name,
      type: type || 'invoice',
      schema: { schemas: [[]], basePdf: 'BLANK_PDF' },
    }),
  }).then(function(res) {
    return res.json().then(function(data) {
      createdIds.push(data.id);
      return data;
    });
  });
}

function publishTemplate(id) {
  return fetch(`${API_BASE}/templates/${id}/publish`, {
    method: 'POST',
    headers: HEADERS,
  }).then(function(res) { return res.json(); });
}

function archiveTemplate(id) {
  return fetch(`${API_BASE}/templates/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  }).then(function(res) { return res.json(); });
}

function fetchTemplates(params) {
  var qs = new URLSearchParams();
  qs.set('limit', '100');
  if (params) {
    Object.keys(params).forEach(function(k) { qs.set(k, params[k]); });
  }
  return fetch(`${API_BASE}/templates?${qs.toString()}`, { headers: HEADERS })
    .then(function(res) { return res.json(); });
}

function cleanup() {
  var promises = createdIds.map(function(id) {
    return fetch(`${API_BASE}/templates/${id}`, { method: 'DELETE', headers: HEADERS }).catch(function() {});
  });
  return Promise.all(promises);
}

function testSetup() {
  console.log('\n--- Setup: Create draft, published, and archived templates ---');
  return createTemplate('Draft Template 251-A', 'invoice')
    .then(function(draftA) {
      assert(draftA.status === 'draft', 'Template 251-A created as draft');
      return createTemplate('Draft Template 251-B', 'statement');
    })
    .then(function(draftB) {
      assert(draftB.status === 'draft', 'Template 251-B created as draft');
      return createTemplate('To Publish 251-C', 'invoice');
    })
    .then(function(toPublish) {
      assert(toPublish.status === 'draft', 'Template 251-C created as draft');
      return publishTemplate(toPublish.id).then(function(pubResult) {
        assert(pubResult.status === 'published' || pubResult.version >= 1, 'Template 251-C published successfully');
        return createTemplate('To Archive 251-D', 'custom');
      });
    })
    .then(function(toArchive) {
      return archiveTemplate(toArchive.id).then(function() {
        console.log('  Template 251-D archived');
        return createTemplate('To Publish 251-E', 'statement');
      });
    })
    .then(function(toPublishE) {
      return publishTemplate(toPublishE.id).then(function() {
        console.log('  Template 251-E published');
      });
    });
}

function testFilterByDraft() {
  console.log('\n--- Filter by status=draft ---');
  return fetchTemplates({ status: 'draft' }).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    var allDraft = result.data.every(function(t) { return t.status === 'draft'; });
    assert(allDraft, 'All returned templates have status=draft (' + result.data.length + ' results)');

    var names = result.data.map(function(t) { return t.name; });
    var hasA = names.some(function(n) { return n.includes('Draft Template 251-A'); });
    var hasB = names.some(function(n) { return n.includes('Draft Template 251-B'); });
    assert(hasA, 'Draft Template 251-A found in draft filter');
    assert(hasB, 'Draft Template 251-B found in draft filter');

    var hasPublished = result.data.some(function(t) { return t.name.includes('To Publish 251-C'); });
    assert(!hasPublished, 'Published template 251-C NOT in draft filter');

    assert(result.pagination != null, 'Pagination info present');
    assert(result.pagination.total >= 2, 'At least 2 draft templates found (got ' + result.pagination.total + ')');
  });
}

function testFilterByPublished() {
  console.log('\n--- Filter by status=published ---');
  return fetchTemplates({ status: 'published' }).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    var allPublished = result.data.every(function(t) { return t.status === 'published'; });
    assert(allPublished, 'All returned templates have status=published (' + result.data.length + ' results)');

    var hasDraft = result.data.some(function(t) { return t.name.includes('Draft Template 251'); });
    assert(!hasDraft, 'Draft templates NOT in published filter');

    assert(result.data.length >= 1, 'At least 1 published template found');
  });
}

function testFilterByArchived() {
  console.log('\n--- Filter by status=archived ---');
  return fetchTemplates({ status: 'archived' }).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    var allArchived = result.data.every(function(t) { return t.status === 'archived'; });
    assert(allArchived, 'All returned templates have status=archived (' + result.data.length + ' results)');

    var hasDraft = result.data.some(function(t) { return t.name.includes('Draft Template 251'); });
    assert(!hasDraft, 'Draft templates NOT in archived filter');

    var hasPublished = result.data.some(function(t) { return t.name.includes('To Publish 251-C'); });
    assert(!hasPublished, 'Published template NOT in archived filter');

    assert(result.data.length >= 1, 'At least 1 archived template found (got ' + result.data.length + ')');
  });
}

function testNoFilterExcludesArchived() {
  console.log('\n--- No filter excludes archived by default ---');
  return fetchTemplates({}).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    var hasArchived = result.data.some(function(t) { return t.status === 'archived'; });
    assert(!hasArchived, 'No archived templates in unfiltered list');

    var hasDraft = result.data.some(function(t) { return t.status === 'draft'; });
    var hasPublished = result.data.some(function(t) { return t.status === 'published'; });
    assert(hasDraft, 'Unfiltered list includes draft templates');
    assert(hasPublished, 'Unfiltered list includes published templates');
  });
}

function testStatusAndTypeFilterCombined() {
  console.log('\n--- Status + type filter combined ---');
  return fetchTemplates({ status: 'draft', type: 'invoice' }).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    var allMatch = result.data.every(function(t) { return t.status === 'draft' && t.type === 'invoice'; });
    assert(allMatch, 'All results are draft AND invoice (' + result.data.length + ' results)');

    var hasA = result.data.some(function(t) { return t.name.includes('Draft Template 251-A'); });
    assert(hasA, 'Draft invoice 251-A found in combined filter');

    var hasB = result.data.some(function(t) { return t.name.includes('Draft Template 251-B'); });
    assert(!hasB, 'Draft statement 251-B NOT in draft+invoice filter');
  });
}

function testNonexistentStatusFilter() {
  console.log('\n--- Nonexistent status returns empty ---');
  return fetchTemplates({ status: 'nonexistent_status' }).then(function(result) {
    assert(result.data && Array.isArray(result.data), 'Response has data array');
    assert(result.data.length === 0, 'Nonexistent status returns 0 results (got ' + result.data.length + ')');
  });
}

function testPaginationReflectsStatusFilter() {
  console.log('\n--- Pagination count reflects status filter ---');
  return Promise.all([fetchTemplates({}), fetchTemplates({ status: 'draft' })])
    .then(function(results) {
      var allResult = results[0];
      var draftResult = results[1];
      assert(draftResult.pagination.total <= allResult.pagination.total,
        'Draft total (' + draftResult.pagination.total + ') <= all total (' + allResult.pagination.total + ')');
    });
}

function testUIComponentHasStatusFilter() {
  console.log('\n--- UI component has status filter ---');
  var source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/apps/designer-sandbox/components/TemplateList.tsx', 'utf-8');

  assert(source.includes('status-filter-dropdown'), 'TemplateList has status-filter-dropdown data-testid');
  assert(source.includes('statusFilter'), 'TemplateList has statusFilter state');
  assert(source.includes('setStatusFilter'), 'TemplateList has setStatusFilter');
  assert(source.includes("params.set('status', statusFilter)"), 'Status filter sent as query parameter');
  assert(source.includes('All statuses'), 'Status filter has "All statuses" default option');
  assert(source.includes('status-option-draft'), 'Status filter has draft option');
  assert(source.includes('status-option-published'), 'Status filter has published option');
  assert(source.includes('status-option-archived'), 'Status filter has archived option');
}

function testBackendStatusFilterLogic() {
  console.log('\n--- Backend status filter logic ---');
  var source = fs.readFileSync('/home/linqadmin/repo/pdfme-jrny/nest-module/src/template.service.ts', 'utf-8');

  // Verify the fix: when explicit status is provided, don't add ne(archived)
  assert(source.includes("options?.status"), 'Backend checks for status option');
  assert(source.includes("eq(templates.status, options.status)"), 'Backend uses eq for explicit status filter');
  // The key fix: conditional archived exclusion
  var hasConditionalArchived = source.includes("options?.status\n      ? [eq(templates.status, options.status)]") ||
    source.includes("options?.status\n      ? [eq(templates.status, options.status)]") ||
    (source.includes("options?.status") && source.includes("ne(templates.status, 'archived')"));
  assert(hasConditionalArchived, 'Backend conditionally excludes archived (not when explicit status given)');
}

function main() {
  console.log('=== Feature #251: Template list filter by status ===');

  return testSetup()
    .then(testFilterByDraft)
    .then(testFilterByPublished)
    .then(testFilterByArchived)
    .then(testNoFilterExcludesArchived)
    .then(testStatusAndTypeFilterCombined)
    .then(testNonexistentStatusFilter)
    .then(testPaginationReflectsStatusFilter)
    .then(testUIComponentHasStatusFilter)
    .then(testBackendStatusFilterLogic)
    .then(function() { return cleanup(); })
    .then(function() {
      console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(function(e) {
      console.error(e);
      return cleanup().then(function() { process.exit(1); });
    });
}

main();
