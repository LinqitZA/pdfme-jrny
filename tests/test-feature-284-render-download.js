const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles})).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + signature;
}

const TOKEN = makeToken('test-user-284', 'test-org-284', ['admin']);

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
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
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          try { resolve({ status: res.statusCode, body: JSON.parse(buffer.toString()), headers: res.headers, raw: buffer }); }
          catch { resolve({ status: res.statusCode, body: buffer.toString(), headers: res.headers, raw: buffer }); }
        } else {
          resolve({ status: res.statusCode, body: null, headers: res.headers, raw: buffer });
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
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf-8'
  );

  // ──────────────────────────────────────────────
  // Test Group 1: UI Code - Render overlay and download link
  // ──────────────────────────────────────────────

  assert('render overlay exists in code',
    DESIGNER_FILE.includes('data-testid="render-overlay"'));

  assert('render dialog exists',
    DESIGNER_FILE.includes('data-testid="render-dialog"'));

  assert('render download link exists',
    DESIGNER_FILE.includes('data-testid="render-download-link"'));

  assert('download link shown when render complete and downloadUrl exists',
    DESIGNER_FILE.includes("renderStatus === 'complete' && renderResult?.downloadUrl"));

  assert('download link text says Download PDF',
    DESIGNER_FILE.includes('Download PDF'));

  assert('download link opens in new tab',
    DESIGNER_FILE.includes('target="_blank"') && DESIGNER_FILE.includes('render-download-link'));

  assert('render complete icon shown on success',
    DESIGNER_FILE.includes('data-testid="render-complete-icon"'));

  assert('render message shown',
    DESIGNER_FILE.includes('data-testid="render-message"'));

  assert('render dismiss button exists',
    DESIGNER_FILE.includes('data-testid="render-dismiss"'));

  assert('renderResult state tracks downloadUrl',
    DESIGNER_FILE.includes('downloadUrl?: string'));

  assert('renderNow sets downloadUrl from result',
    DESIGNER_FILE.includes('downloadUrl: result.downloadUrl'));

  assert('render complete message says PDF generated',
    DESIGNER_FILE.includes('PDF generated successfully'));

  // ──────────────────────────────────────────────
  // Test Group 2: UI Code - Render status transitions
  // ──────────────────────────────────────────────

  assert('render status has loading state',
    DESIGNER_FILE.includes("setRenderStatus('loading')"));

  assert('render status has complete state',
    DESIGNER_FILE.includes("setRenderStatus('complete')"));

  assert('render status has error state',
    DESIGNER_FILE.includes("setRenderStatus('error')"));

  assert('render spinner shown during loading',
    DESIGNER_FILE.includes('data-testid="render-spinner"'));

  assert('render error icon shown on error',
    DESIGNER_FILE.includes('data-testid="render-error-icon"'));

  // ──────────────────────────────────────────────
  // Test Group 3: API - Render returns downloadUrl
  // ──────────────────────────────────────────────

  // Create and publish a template
  const createRes = await request('POST', '/templates', {
    name: 'Render Download Test 284',
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

  const publishRes = await request('POST', `/templates/${templateId}/publish`);
  assert('publish template succeeds', publishRes.status === 200 || publishRes.status === 201, `got ${publishRes.status}`);

  // Render the template
  const renderRes = await request('POST', '/render/now', {
    templateId,
    entityId: 'test-entity-284',
    channel: 'print',
  });
  assert('render returns 201', renderRes.status === 201, `got ${renderRes.status}`);
  assert('render response has document', !!renderRes.body.document, 'no document in response');
  assert('render response has document id', !!renderRes.body.document?.id);
  assert('render response has downloadUrl', !!renderRes.body.downloadUrl, `downloadUrl: ${renderRes.body.downloadUrl}`);
  assert('downloadUrl contains document id',
    renderRes.body.downloadUrl && renderRes.body.downloadUrl.includes(renderRes.body.document.id));
  assert('document status is done', renderRes.body.document?.status === 'done', `got ${renderRes.body.document?.status}`);

  // ──────────────────────────────────────────────
  // Test Group 4: Download endpoint returns PDF
  // ──────────────────────────────────────────────

  const docId = renderRes.body.document?.id;
  if (docId) {
    const downloadRes = await request('GET', `/render/document/${docId}`);
    assert('download returns 200', downloadRes.status === 200, `got ${downloadRes.status}`);
    assert('download returns application/pdf content type',
      downloadRes.headers['content-type']?.includes('application/pdf'),
      `got ${downloadRes.headers['content-type']}`);
    assert('download returns non-empty PDF', downloadRes.raw.length > 100, `got ${downloadRes.raw.length} bytes`);
    assert('PDF starts with %PDF magic bytes',
      downloadRes.raw.slice(0, 4).toString() === '%PDF');
  } else {
    assert('download returns 200', false, 'no document ID to test');
    assert('download returns application/pdf', false, 'skipped');
    assert('download returns non-empty PDF', false, 'skipped');
    assert('PDF starts with %PDF magic bytes', false, 'skipped');
  }

  // ──────────────────────────────────────────────
  // Test Group 5: Invalid download ID returns 404
  // ──────────────────────────────────────────────

  const badDownloadRes = await request('GET', '/render/document/nonexistent-doc-284');
  assert('download nonexistent document returns 404',
    badDownloadRes.status === 404, `got ${badDownloadRes.status}`);

  // ──────────────────────────────────────────────
  // Test Group 6: Render controller adds downloadUrl
  // ──────────────────────────────────────────────

  const CONTROLLER_FILE = fs.readFileSync(
    path.join(__dirname, '..', 'nest-module', 'src', 'render.controller.ts'),
    'utf-8'
  );

  assert('controller adds downloadUrl to render response',
    CONTROLLER_FILE.includes('downloadUrl') && CONTROLLER_FILE.includes('/render/document/'));

  // Cleanup
  await request('DELETE', `/templates/${templateId}`);

  // Summary
  const total = passed + failed;
  console.log(`\nFeature #284: Render completion shows download link`);
  console.log(`${'='.repeat(50)}`);
  results.forEach(r => console.log(r));
  console.log(`\n${passed}/${total} tests passed${failed > 0 ? ` (${failed} failed)` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
