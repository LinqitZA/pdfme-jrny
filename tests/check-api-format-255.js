const { signJwt } = require('./create-signed-token');
const http = require('http');

const token = signJwt({ sub: 'user-t255', orgId: 'org-t255', roles: ['template:edit','template:publish','render:trigger'] });

function req(m, p, b) {
  return new Promise((ok, no) => {
    const u = new URL(p);
    const o = { method: m, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    const r = http.request(o, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { ok({ s: res.statusCode, b: JSON.parse(d) }); } catch(e) { ok({ s: res.statusCode, b: d }); } }); });
    r.on('error', no);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}

async function go() {
  const t = await req('POST', 'http://localhost:3001/api/pdfme/templates', { name: 'test-fmt', type: 'invoice', schema: { basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] }, schemas: [[{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 50, height: 10, content: 'Hi' }]] } });
  console.log('CREATE TPL:', JSON.stringify(t.b).substring(0, 200));
  const tid = t.b.id;
  const pub = await req('POST', 'http://localhost:3001/api/pdfme/templates/' + tid + '/publish', {});
  console.log('PUBLISH:', JSON.stringify(pub.b).substring(0, 200));
  const rr = await req('POST', 'http://localhost:3001/api/pdfme/render/now', { templateId: tid, entityId: 'e1', channel: 'email' });
  console.log('RENDER:', JSON.stringify(rr.b).substring(0, 300));
}

go();
