const http = require('http');
const crypto = require('crypto');
const JWT_SECRET = 'pdfme-dev-secret';

function makeJwt(p) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify(p)).toString('base64url');
  const s = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + b).digest('base64url');
  return h + '.' + b + '.' + s;
}

const t = makeJwt({ sub: 'u1', orgId: 'org-28', roles: ['admin'], permissions: ['audit:view'] });

function req(method, path) {
  return new Promise((resolve) => {
    const r = http.request({ hostname: 'localhost', port: 3000, path, method, headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.end();
  });
}

async function main() {
  const r1 = await req('GET', '/api/pdfme/audit/policy');
  process.stdout.write('Policy: ' + r1.status + ' ' + r1.body + '\n');

  const r2 = await req('GET', '/api/pdfme/audit?limit=5');
  process.stdout.write('Audit list: ' + r2.status + ' ' + r2.body.substring(0, 300) + '\n');

  const r3 = await req('PUT', '/api/pdfme/audit/test-id');
  process.stdout.write('PUT: ' + r3.status + ' ' + r3.body + '\n');

  const r4 = await req('DELETE', '/api/pdfme/audit/test-id');
  process.stdout.write('DELETE: ' + r4.status + ' ' + r4.body + '\n');
}

main().catch(e => process.stderr.write(e.message + '\n'));
