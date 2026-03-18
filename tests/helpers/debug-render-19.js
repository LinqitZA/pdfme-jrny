const http = require('http');
const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const TS = Date.now();
const ORG = 'org-debug-19-' + TS;

function makeToken(orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-debug', orgId: orgId,
    roles: ['template_admin','template:edit','template:publish','render:trigger','render:bulk','super_admin'],
    iat: Math.floor(Date.now()/1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

function req(method, path, token, body) {
  return new Promise(function(resolve, reject) {
    const url = new URL('http://localhost:3000' + path);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method: method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, function(res) {
      let d = ''; res.on('data', function(c) { d += c; }); res.on('end', function() {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch(e) { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const token = makeToken(ORG);
  // Create template
  const tpl = await req('POST', '/api/pdfme/templates', token, {
    name: 'Debug 19', type: 'invoice',
    schema: { pages: [{ elements: [{ name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }], size: { width: 210, height: 297 } }] }
  });
  console.log('Create:', tpl.status);
  const templateId = tpl.data.id;

  // Publish
  const pub = await req('POST', '/api/pdfme/templates/' + templateId + '/publish', token, {});
  console.log('Publish:', pub.status);

  // Render
  const render = await req('POST', '/api/pdfme/render/now', token, {
    templateId: templateId, entityId: 'e-' + TS, entityType: 'invoice', channel: 'email', inputs: { title: 'Hello' }
  });
  console.log('Render status:', render.status);
  console.log('Render data:', JSON.stringify(render.data, null, 2).substring(0, 500));
}

main().catch(console.error);
