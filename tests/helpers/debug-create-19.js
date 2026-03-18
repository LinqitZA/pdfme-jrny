const http = require('http');
const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'user-test', orgId: 'org-test-19', roles: ['template_admin','template:edit','template:publish','render:trigger','render:bulk','super_admin'], iat: Math.floor(Date.now()/1000), exp: 9999999999 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
const token = header+'.'+payload+'.'+sig;

const body = JSON.stringify({
  name: 'Test TPL',
  type: 'invoice',
  schemas: [[{ name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }]],
  basePdf: { width: 210, height: 297, padding: [10,10,10,10] },
});

const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/pdfme/templates', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+token } }, function(res) {
  let d='';
  res.on('data', function(c) { d += c; });
  res.on('end', function() { console.log(res.statusCode, d); });
});
req.write(body);
req.end();
