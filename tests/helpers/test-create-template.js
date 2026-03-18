const http = require('http');
const crypto = require('crypto');

const secret = 'pdfme-dev-secret';
function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId, roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const token = makeToken('test', 'org-test', ['template:view','template:edit','template:publish']);

const body = JSON.stringify({ name: 'test-creation', type: 'invoice' });
const req = http.request({
  method: 'POST',
  hostname: 'localhost',
  port: 3000,
  path: '/api/pdfme/templates',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const fs = require('fs');
    fs.writeFileSync('/tmp/create-template-result.json', JSON.stringify({ status: res.statusCode, body: data }, null, 2));
  });
});
req.write(body);
req.end();
