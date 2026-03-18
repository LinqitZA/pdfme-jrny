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
  const res = await req('POST', '/api/pdfme/templates', {
    name: 'Test Create',
    type: 'custom-colspan',
    orgId: 'org-colspan-382',
    schema: { pages: [{ elements: [{ name: 'test', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 }] }] }
  });
  console.log('Result:', res.status, res.body);
}

main().catch(console.error);
