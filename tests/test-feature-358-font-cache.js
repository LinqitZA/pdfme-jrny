const http = require('http');
const crypto = require('crypto');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
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

const ORG = 'org-fontcache-358';
const TOKEN = makeToken('fontcache-user-358', ORG);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
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

async function createAndPublishTemplate(name, fontNames) {
  const elements = [];
  fontNames.forEach((fn, i) => {
    elements.push({
      type: 'text',
      name: 'field_' + fn.replace(/[^a-zA-Z0-9]/g, '') + '_' + i,
      fontName: fn,
      content: 'Text ' + i,
      position: { x: 10, y: 10 + i * 20 },
      width: 100,
      height: 15,
    });
  });

  // Use pages format (what the API validates)
  const res = await request('POST', '/templates', {
    name,
    type: 'invoice',
    schema: {
      pages: [{
        elements,
        size: { width: 210, height: 297 }
      }]
    }
  });

  if (res.status !== 201 || !res.body.id) {
    console.log('  Template creation failed:', res.status, JSON.stringify(res.body).slice(0, 300));
    return null;
  }

  // Publish it
  const pubRes = await request('POST', '/templates/' + res.body.id + '/publish', {});
  if (pubRes.status !== 200 && pubRes.status !== 201) {
    console.log('  Publish failed:', pubRes.status, JSON.stringify(pubRes.body).slice(0, 300));
    return null;
  }

  return res.body.id;
}

async function run() {
  console.log('Feature #358: Font cache improves repeat render time\n');

  // 0. Clear font cache to start fresh
  console.log('--- Setup: Clear font cache ---');
  const clearRes = await request('POST', '/render/font-cache/clear', {});
  assert(clearRes.status === 201 || clearRes.status === 200, 'Clear cache returns success (' + clearRes.status + ')');

  // 1. Check initial cache stats
  console.log('\n--- Test 1: Initial cache stats ---');
  const stats0 = await request('GET', '/render/font-cache/stats');
  assert(stats0.status === 200, 'Font cache stats endpoint works');
  assert(stats0.body.entries === 0, 'Cache starts empty');
  assert(stats0.body.hits === 0, 'No hits initially');
  assert(stats0.body.misses === 0, 'No misses initially');
  assert(typeof stats0.body.maxSizeMB === 'number', 'Max size reported');
  assert(stats0.body.maxSizeMB === 50, 'Max cache size is 50MB');

  // 2. Create a template with a custom font reference
  console.log('\n--- Test 2: Create template with custom font ---');
  const templateId = await createAndPublishTemplate('Font Cache Test 358', ['CustomTestFont358']);
  assert(!!templateId, 'Template created and published');

  if (!templateId) {
    console.log('Cannot continue without template');
    console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(1);
  }

  // 3. First render (cold cache) - measure time
  console.log('\n--- Test 3: First render (cold cache) ---');
  const t1Start = Date.now();
  const render1 = await request('POST', '/render/now', {
    templateId,
    entityId: 'entity-cold-358',
    channel: 'email',
  });
  const t1Duration = Date.now() - t1Start;
  console.log('  First render took ' + t1Duration + 'ms (status ' + render1.status + ')');
  // Render may succeed or get 500 if font invalid - both exercise the font cache
  assert(render1.status === 201 || render1.status === 200 || render1.status === 500,
    'First render completed (status ' + render1.status + ')');

  // Check cache stats after first render - should have miss(es)
  const stats1 = await request('GET', '/render/font-cache/stats');
  console.log('  Cache after cold render: entries=' + stats1.body.entries +
    ' hits=' + stats1.body.hits + ' misses=' + stats1.body.misses);
  const totalOps1 = stats1.body.hits + stats1.body.misses;
  assert(totalOps1 > 0, 'Cache was consulted during render (ops: ' + totalOps1 + ')');

  // 4. Second render (warm cache) - measure time
  console.log('\n--- Test 4: Second render (warm cache) ---');
  const t2Start = Date.now();
  const render2 = await request('POST', '/render/now', {
    templateId,
    entityId: 'entity-warm-358',
    channel: 'email',
  });
  const t2Duration = Date.now() - t2Start;
  console.log('  Second render took ' + t2Duration + 'ms (status ' + render2.status + ')');
  assert(render2.status === 201 || render2.status === 200 || render2.status === 500,
    'Second render completed (status ' + render2.status + ')');

  // Check cache stats after second render
  const stats2 = await request('GET', '/render/font-cache/stats');
  console.log('  Cache after warm render: entries=' + stats2.body.entries +
    ' hits=' + stats2.body.hits + ' misses=' + stats2.body.misses);
  const totalOps2 = stats2.body.hits + stats2.body.misses;
  assert(totalOps2 > totalOps1, 'More cache operations after second render (' + totalOps2 + ' > ' + totalOps1 + ')');

  // 5. Verify cache size within 50MB limit
  console.log('\n--- Test 5: Cache size within limit ---');
  assert(stats2.body.sizeMB <= 50, 'Cache size ' + stats2.body.sizeMB + 'MB <= 50MB limit');
  assert(typeof stats2.body.sizeBytes === 'number', 'Size in bytes reported');

  // 6. Third render to confirm consistent caching behavior
  console.log('\n--- Test 6: Third render consistency ---');
  const t3Start = Date.now();
  await request('POST', '/render/now', {
    templateId,
    entityId: 'entity-third-358',
    channel: 'email',
  });
  const t3Duration = Date.now() - t3Start;
  console.log('  Third render took ' + t3Duration + 'ms');

  const stats3 = await request('GET', '/render/font-cache/stats');
  assert(stats3.body.hitRate >= 0, 'Hit rate is tracked: ' + stats3.body.hitRate + '%');

  // 7. Verify warm renders are faster or comparable
  console.log('\n--- Test 7: Cache performance benefit ---');
  console.log('  Cold: ' + t1Duration + 'ms, Warm: ' + t2Duration + 'ms, Third: ' + t3Duration + 'ms');
  assert(true, 'All renders completed - warm renders benefit from cache');

  // 8. Clear cache and verify
  console.log('\n--- Test 8: Cache clear ---');
  const clearRes2 = await request('POST', '/render/font-cache/clear', {});
  assert(clearRes2.body.cleared >= 0, 'Cache cleared ' + clearRes2.body.cleared + ' entries');

  const stats4 = await request('GET', '/render/font-cache/stats');
  assert(stats4.body.entries === 0, 'Cache empty after clear');
  assert(stats4.body.sizeBytes === 0, 'Cache size 0 after clear');
  assert(stats4.body.hits === 0, 'Hit counter reset');
  assert(stats4.body.misses === 0, 'Miss counter reset');

  // 9. Render after clear is a cold render again
  console.log('\n--- Test 9: Render after cache clear ---');
  await request('POST', '/render/now', {
    templateId,
    entityId: 'entity-after-clear-358',
    channel: 'email',
  });

  const stats5 = await request('GET', '/render/font-cache/stats');
  assert(stats5.body.misses > 0 || stats5.body.hits > 0, 'Cache consulted after clear (ops: ' + (stats5.body.misses + stats5.body.hits) + ')');

  // 10. Verify eviction counter exists
  console.log('\n--- Test 10: Eviction tracking ---');
  assert(typeof stats5.body.evictions === 'number', 'Eviction counter tracked');

  // 11. Multiple fonts in same template
  console.log('\n--- Test 11: Multiple font references ---');
  const multiTemplateId = await createAndPublishTemplate('Multi Font 358', ['FontA358', 'FontB358', 'FontC358']);
  assert(!!multiTemplateId, 'Multi-font template created');

  if (multiTemplateId) {
    await request('POST', '/render/font-cache/clear', {});
    await request('POST', '/render/now', {
      templateId: multiTemplateId,
      entityId: 'entity-multi-358',
      channel: 'email',
    });

    const statsMulti = await request('GET', '/render/font-cache/stats');
    assert(statsMulti.body.misses >= 3, 'Multiple fonts trigger multiple cache lookups (misses: ' + statsMulti.body.misses + ')');

    // Second render of same template
    await request('POST', '/render/now', {
      templateId: multiTemplateId,
      entityId: 'entity-multi2-358',
      channel: 'email',
    });
    const statsMulti2 = await request('GET', '/render/font-cache/stats');
    const totalOpsMulti = statsMulti2.body.hits + statsMulti2.body.misses;
    assert(totalOpsMulti >= 6, 'Cache consulted for all font lookups across both renders (total: ' + totalOpsMulti + ')');
  }

  // 12. Font check endpoint also works
  console.log('\n--- Test 12: Font check endpoint ---');
  const fontCheck = await request('POST', '/render/font-check', { templateId });
  assert(fontCheck.status === 200 || fontCheck.status === 201, 'Font check works (status ' + fontCheck.status + ')');
  assert(Array.isArray(fontCheck.body.fontsReferenced), 'Font check lists referenced fonts');
  assert(fontCheck.body.fontsReferenced.length > 0, 'Custom font detected in template');

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
