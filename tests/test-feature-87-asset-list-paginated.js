/**
 * Feature #87: Asset list paginated
 * GET /api/pdfme/assets lists with cursor pagination
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('asset-user-87', 'org-asset-87', ['template:read', 'template:write']);
const TOKEN_B = makeToken('asset-user-87b', 'org-asset-87b', ['template:read', 'template:write']);

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

// Create a tiny valid PNG buffer
function createPng() {
  // Minimal 1x1 red PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function uploadAsset(token, name) {
  const pngBuf = createPng();
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
    pngBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(BASE + '/api/pdfme/assets/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Authorization': 'Bearer ' + token,
    },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function api(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function run() {
  console.log('Feature #87: Asset list paginated');
  console.log('='.repeat(50));

  // Upload several assets
  console.log('\n--- Setup: Upload 5 assets ---');
  const uploadedIds = [];
  for (let i = 1; i <= 5; i++) {
    const res = await uploadAsset(TOKEN, 'test-asset-87-' + i + '.png');
    assert(res.status === 201, 'Upload asset ' + i + ' returns 201 (got ' + res.status + ')');
    if (res.json.id) uploadedIds.push(res.json.id);
  }
  assert(uploadedIds.length === 5, 'All 5 assets uploaded successfully');

  // Test 1: GET /assets returns list with metadata
  console.log('\n--- Test: GET /assets returns paginated list ---');
  const listRes = await api('/api/pdfme/assets', { token: TOKEN });
  assert(listRes.status === 200, 'GET /assets returns 200 (got ' + listRes.status + ')');
  assert(Array.isArray(listRes.json.data), 'Response has data array');
  assert(listRes.json.pagination, 'Response has pagination object');
  assert(typeof listRes.json.pagination.total === 'number', 'Pagination has total count');
  assert(typeof listRes.json.pagination.limit === 'number', 'Pagination has limit');
  assert(typeof listRes.json.pagination.hasMore === 'boolean', 'Pagination has hasMore flag');

  // Test 2: Asset metadata fields
  console.log('\n--- Test: Asset metadata fields ---');
  if (listRes.json.data.length > 0) {
    const asset = listRes.json.data[0];
    assert(asset.id, 'Asset has id');
    assert(asset.filename, 'Asset has filename');
    assert(asset.originalName, 'Asset has originalName');
    assert(asset.mimeType, 'Asset has mimeType');
    assert(asset.category, 'Asset has category');
    assert(asset.storagePath, 'Asset has storagePath');
    assert(asset.orgId, 'Asset has orgId');
  }

  // Test 3: Cursor pagination with small limit
  console.log('\n--- Test: Cursor pagination ---');
  const page1 = await api('/api/pdfme/assets?limit=2', { token: TOKEN });
  assert(page1.status === 200, 'Page 1 returns 200');
  assert(page1.json.data.length === 2, 'Page 1 has 2 items (got ' + page1.json.data.length + ')');
  assert(page1.json.pagination.hasMore === true, 'Page 1 hasMore is true');
  assert(page1.json.pagination.nextCursor, 'Page 1 has nextCursor');

  const cursor1 = page1.json.pagination.nextCursor;
  const page2 = await api('/api/pdfme/assets?limit=2&cursor=' + cursor1, { token: TOKEN });
  assert(page2.status === 200, 'Page 2 returns 200');
  assert(page2.json.data.length === 2, 'Page 2 has 2 items (got ' + page2.json.data.length + ')');

  // Verify no overlap between page 1 and page 2
  const page1Ids = page1.json.data.map(a => a.id);
  const page2Ids = page2.json.data.map(a => a.id);
  const overlap = page1Ids.filter(id => page2Ids.includes(id));
  assert(overlap.length === 0, 'No overlap between pages (overlap: ' + overlap.length + ')');

  const cursor2 = page2.json.pagination.nextCursor;
  const page3 = await api('/api/pdfme/assets?limit=2&cursor=' + cursor2, { token: TOKEN });
  assert(page3.status === 200, 'Page 3 returns 200');
  assert(page3.json.data.length >= 1, 'Page 3 has remaining items');

  // Test 4: All items across pages match total
  const allPagedIds = [...page1Ids, ...page2Ids, ...page3.json.data.map(a => a.id)];
  assert(allPagedIds.length === page1.json.pagination.total, 'All paged items match total (' + allPagedIds.length + ' vs ' + page1.json.pagination.total + ')');

  // Test 5: Default limit works
  console.log('\n--- Test: Default limit ---');
  const defaultRes = await api('/api/pdfme/assets', { token: TOKEN });
  assert(defaultRes.json.pagination.limit === 20, 'Default limit is 20 (got ' + defaultRes.json.pagination.limit + ')');

  // Test 6: Tenant isolation
  console.log('\n--- Test: Tenant isolation ---');
  const otherRes = await api('/api/pdfme/assets', { token: TOKEN_B });
  assert(otherRes.status === 200, 'Other tenant returns 200');
  assert(otherRes.json.data.length === 0, 'Other tenant sees 0 assets (got ' + otherRes.json.data.length + ')');

  // Test 7: Invalid cursor gracefully handled
  console.log('\n--- Test: Invalid cursor ---');
  const invalidCursor = await api('/api/pdfme/assets?cursor=nonexistent-id', { token: TOKEN });
  assert(invalidCursor.status === 200, 'Invalid cursor returns 200');
  assert(Array.isArray(invalidCursor.json.data), 'Invalid cursor returns data array');

  // Cleanup
  console.log('\n--- Cleanup ---');
  for (const id of uploadedIds) {
    await api('/api/pdfme/assets/' + id + '?confirm=true', { method: 'DELETE', token: TOKEN });
  }

  console.log('\n' + '='.repeat(50));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
