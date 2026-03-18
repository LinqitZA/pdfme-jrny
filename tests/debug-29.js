const http = require('http');
const crypto = require('crypto');
const BASE = 'http://localhost:3000/api/pdfme';
const JWT_SECRET = 'pdfme-dev-secret';

function makeJwt(payload) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}

const TOKEN = makeJwt({
  sub: 'u1', orgId: 'org-d29', roles: ['admin'],
  permissions: ['template:view','template:edit','template:publish','template:delete','render:trigger','audit:view'],
});

function req(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const r = http.request({
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d.substring(0, 500) }));
    });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // Create
  const c = await req('POST', BASE + '/templates', {
    type: 'invoice', name: 'Debug29', schema: { pages: [{ elements: [] }] },
  });
  process.stdout.write('CREATE: ' + c.status + ' ' + c.body.substring(0, 200) + '\n');
  const id = JSON.parse(c.body).id;

  // Update draft
  const u = await req('PUT', BASE + '/templates/' + id + '/draft', {
    name: 'Debug29-Updated', schema: { pages: [{ elements: [] }] },
  });
  process.stdout.write('UPDATE: ' + u.status + ' ' + u.body.substring(0, 300) + '\n');

  // Publish
  const p = await req('POST', BASE + '/templates/' + id + '/publish');
  process.stdout.write('PUBLISH: ' + p.status + ' ' + p.body.substring(0, 300) + '\n');

  // Fork
  const f = await req('POST', BASE + '/templates/' + id + '/fork', { name: 'Forked' });
  process.stdout.write('FORK: ' + f.status + ' ' + f.body.substring(0, 300) + '\n');

  // Delete
  const d = await req('DELETE', BASE + '/templates/' + id);
  process.stdout.write('DELETE: ' + d.status + ' ' + d.body.substring(0, 300) + '\n');
}

main().catch(e => process.stderr.write(e.message + '\n'));
