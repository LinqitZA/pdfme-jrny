const http = require('http');
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  { sub: 'u1', orgId: 'org-85', role: 'admin', permissions: ['template:read','template:write','document:read','document:write','render:execute'] },
  'pdfme-dev-secret',
  { expiresIn: '1h' }
);

const data = JSON.stringify({
  name: 'TEST85',
  schemas: [[{name:'f1',type:'text',position:{x:0,y:0},width:100,height:20}]],
  basePdf: {width:595,height:842,padding:[0,0,0,0]},
  entityType: 'invoice',
});

const req = http.request(
  {
    method: 'POST',
    hostname: 'localhost',
    port: 3000,
    path: '/api/pdfme/templates',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  },
  (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      const fs = require('fs');
      fs.writeFileSync('/tmp/debug-85.txt', res.statusCode + ' ' + d);
    });
  }
);
req.write(data);
req.end();
