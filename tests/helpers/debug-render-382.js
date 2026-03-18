const http = require('http');
const crypto = require('crypto');

const secret = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'test', orgId: 'org-colspan-382', roles: ['template_admin','template:edit','template:publish','render:trigger','super_admin'], iat: Math.floor(Date.now()/1000), exp: 9999999999 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
const TOKEN = header + '.' + payload + '.' + sig;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const listRes = await req('GET', '/api/pdfme/templates?orgId=org-colspan-382&limit=1', null);
  console.log('List:', listRes.body.substring(0, 300));
  const templates = JSON.parse(listRes.body);
  const tArr = templates.data || templates.templates || templates;
  if (!tArr || !tArr.length) { console.log('No templates'); return; }
  const tid = tArr[0].id;
  console.log('Template:', tid);

  const res = await req('POST', '/api/pdfme/render/now', {
    templateId: tid, orgId: 'org-colspan-382', channel: 'email', entityId: 'debug-382',
    inputs: [{ invoiceTable: JSON.stringify([{item:'A',description:'B',qty:1,unitPrice:10,amount:10}]) }]
  });
  console.log('Render response:', res.status, res.body.substring(0, 500));
}

main().catch(console.error);
