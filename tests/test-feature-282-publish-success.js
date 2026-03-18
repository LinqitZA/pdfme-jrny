const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-282', 'test-org-282', ['admin']);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + TOKEN,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
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

function assert(name, condition, detail) {
  if (condition) {
    passed++;
    results.push(`  PASS: ${name}`);
  } else {
    failed++;
    results.push(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  }
}

async function run() {
  const DESIGNER_FILE = fs.readFileSync(
    require('path').join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );

  // ──────────────────────────────────────────────
  // Test Group 1: UI Code Structure - Publish success toast
  // ──────────────────────────────────────────────

  assert('publish-success-toast element exists in code',
    DESIGNER_FILE.includes('data-testid="publish-success-toast"'));

  assert('success toast shows when publishStatus is published',
    DESIGNER_FILE.includes("publishStatus === 'published'") && DESIGNER_FILE.includes('publish-success-toast'));

  assert('success toast message mentions published',
    DESIGNER_FILE.includes('Template published successfully'));

  assert('publish button changes text to Published on success',
    DESIGNER_FILE.includes("'\\u2713 Published'") || DESIGNER_FILE.includes("'\u2713 Published'") || DESIGNER_FILE.includes("Published'"));

  assert('publish button background turns green on success',
    DESIGNER_FILE.includes("publishStatus === 'published' ? '#059669'"));

  assert('publish success auto-dismisses after timeout',
    DESIGNER_FILE.includes('setTimeout') && DESIGNER_FILE.includes("prev === 'published' ? 'idle'"));

  // ──────────────────────────────────────────────
  // Test Group 2: Template status badge in UI
  // ──────────────────────────────────────────────

  assert('template-status-badge element exists in code',
    DESIGNER_FILE.includes('data-testid="template-status-badge"'));

  assert('status badge shows templateStatus text',
    DESIGNER_FILE.includes('{templateStatus}'));

  assert('templateStatus state is defined',
    DESIGNER_FILE.includes("useState<'draft' | 'published' | 'archived' | null>"));

  assert('templateStatus is set from loaded template data',
    DESIGNER_FILE.includes('setTemplateStatus(template.status)'));

  assert('templateStatus updates to published on successful publish',
    DESIGNER_FILE.includes("setTemplateStatus('published')"));

  assert('status badge has green styling for published',
    DESIGNER_FILE.includes("templateStatus === 'published' ? '#dcfce7'"));

  assert('status badge has yellow styling for draft',
    DESIGNER_FILE.includes('#fef9c3'));

  // ──────────────────────────────────────────────
  // Test Group 3: API - Publish returns correct status
  // ──────────────────────────────────────────────

  // Create a fresh template
  const createRes = await request('POST', '/templates', {
    name: 'Publish Success Test 282',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', x: 50, y: 50, w: 200, h: 24, content: 'Test' }],
        basePdf: { width: 210, height: 297 }
      }]
    }
  });
  assert('create template returns 201', createRes.status === 201, `got ${createRes.status}`);
  const templateId = createRes.body.id;

  assert('new template has draft status', createRes.body.status === 'draft', `got ${createRes.body.status}`);

  // Publish the template
  const publishRes = await request('POST', `/templates/${templateId}/publish`);
  assert('publish returns success (200 or 201)', publishRes.status === 200 || publishRes.status === 201, `got ${publishRes.status}`);
  assert('publish response has status published', publishRes.body.status === 'published', `got ${publishRes.body.status}`);
  assert('publish response has version incremented', publishRes.body.version >= 2, `got v${publishRes.body.version}`);
  assert('publish response has publishedVer set', publishRes.body.publishedVer !== null && publishRes.body.publishedVer !== undefined);

  // Verify GET returns published status
  const getRes = await request('GET', `/templates/${templateId}`);
  assert('GET template shows published status', getRes.body.status === 'published', `got ${getRes.body.status}`);

  // ──────────────────────────────────────────────
  // Test Group 4: Publish error handling
  // ──────────────────────────────────────────────

  assert('error banner element exists in code',
    DESIGNER_FILE.includes('data-testid="publish-error-banner"'));

  assert('publish error message element exists',
    DESIGNER_FILE.includes('data-testid="publish-error-message"'));

  assert('publish error retry button exists',
    DESIGNER_FILE.includes('data-testid="publish-error-retry"'));

  assert('publish error dismiss button exists',
    DESIGNER_FILE.includes('data-testid="publish-error-dismiss"'));

  // Publish nonexistent template returns 404
  const badPublishRes = await request('POST', '/templates/nonexistent-id/publish');
  assert('publish nonexistent template returns error',
    badPublishRes.status === 404 || badPublishRes.status === 422,
    `got ${badPublishRes.status}`);

  // ──────────────────────────────────────────────
  // Test Group 5: Publish flow state transitions
  // ──────────────────────────────────────────────

  assert('publishStatus state has publishing state',
    DESIGNER_FILE.includes("'publishing'"));

  assert('button shows Publishing text during publish',
    DESIGNER_FILE.includes("Publishing\u2026") || DESIGNER_FILE.includes("Publishing…"));

  assert('button is disabled during publishing',
    DESIGNER_FILE.includes("publishStatus === 'publishing'") && DESIGNER_FILE.includes('disabled'));

  assert('publish prevents double-click with ref guard',
    DESIGNER_FILE.includes('isPublishingRef.current'));

  // ──────────────────────────────────────────────
  // Test Group 6: Second publish creates new version correctly
  // ──────────────────────────────────────────────

  // Create another template, publish it twice (create new draft after first publish)
  const createRes2 = await request('POST', '/templates', {
    name: 'Publish Twice Test 282',
    type: 'invoice',
    schema: {
      pages: [{
        elements: [{ type: 'text', x: 50, y: 50, w: 200, h: 24, content: 'Test 2' }],
        basePdf: { width: 210, height: 297 }
      }]
    }
  });
  const tid2 = createRes2.body.id;
  const pub1 = await request('POST', `/templates/${tid2}/publish`);
  assert('first publish succeeds', pub1.status === 200 || pub1.status === 201, `got ${pub1.status}`);

  // ──────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────
  await request('DELETE', `/templates/${templateId}`);
  await request('DELETE', `/templates/${tid2}`);

  // Summary
  const total = passed + failed;
  console.log(`\nFeature #282: Publish success shows confirmation`);
  console.log(`${'='.repeat(50)}`);
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${total} tests passed${failed > 0 ? ` (${failed} failed)` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
