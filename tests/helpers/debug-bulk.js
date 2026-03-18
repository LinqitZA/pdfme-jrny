const crypto = require('crypto');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const secret = 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, orgId, roles, iat: Math.floor(Date.now() / 1000), exp: 9999999999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('debug-bulk', 'org-debug-bulk', ['template:view', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk']);

async function api(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function main() {
  // Reset rate limits
  await api('/api/pdfme/render/rate-limit/reset', { method: 'POST', token: TOKEN, body: {} });

  // Create template
  const cr = await api('/api/pdfme/templates', {
    method: 'POST', token: TOKEN,
    body: { name: 'Debug Bulk ' + Date.now(), type: 'invoice', schema: { pages: [{ elements: [{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'T' }] }] } }
  });
  const templateId = cr.json?.id;
  await api(`/api/pdfme/templates/${templateId}/publish`, { method: 'POST', token: TOKEN });

  for (let i = 1; i <= 6; i++) {
    const res = await api('/api/pdfme/render/bulk', {
      method: 'POST', token: TOKEN,
      body: { templateId, entityIds: [`e-${i}`], channel: 'email' }
    });
    console.log(`Request ${i}: status=${res.status} message=${JSON.stringify(res.json?.message || res.json?.error || '').substring(0, 100)}`);
  }
}
main().catch(console.error);
