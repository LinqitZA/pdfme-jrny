const http = require('http');
const crypto = require('crypto');

const SECRET = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: 'u',
  orgId: 'org-aged-debtors-370',
  roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger'],
  iat: Math.floor(Date.now() / 1000),
  exp: 9999999999
})).toString('base64url');
const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
const TOKEN = header + '.' + payload + '.' + sig;

const body = JSON.stringify({
  templateId: 'sys-report-aged-debtors',
  entityId: 'test1',
  channel: 'print',
  inputs: [{
    reportTitle: 'Test',
    reportDate: '2026-03-18',
    grandTotal: '100',
    debtorsTable: JSON.stringify([['A', '1', '2', '3', '4', '5', '6']])
  }]
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/pdfme/render/now',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data.substring(0, 1000));
  });
});
req.write(body);
req.end();
