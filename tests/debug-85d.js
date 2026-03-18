const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const SECRET = 'pdfme-dev-secret';
const token = jwt.sign(
  { sub: 'u1', orgId: 'org-85d', roles: ['template:read','template:write','document:read','document:write','render:trigger'] },
  SECRET,
  { expiresIn: '1h' }
);

function req(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, process.env.API_BASE || 'http://localhost:3001');
    const r = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  // Create template
  const tmpl = await req('POST', '/api/pdfme/templates', {
    name: 'DEBUG85D',
    type: 'invoice',
    schema: { pages: [[{ name: 'f1', type: 'text', position: { x: 0, y: 0 }, width: 100, height: 20 }]], basePdf: { width: 595, height: 842, padding: [0, 0, 0, 0] } },
  });
  const tmplData = JSON.parse(tmpl.body);

  // Render
  const render = await req('POST', '/api/pdfme/render/now', {
    templateId: tmplData.id,
    inputs: [{ f1: 'Test' }],
    entityType: 'invoice',
    entityId: 'ent-d1',
    channel: 'print',
  });
  fs.writeFileSync('/tmp/debug-85d.txt', 'tmpl: ' + tmpl.status + '\nrender: ' + render.status + ' ' + render.body.substring(0, 1000));

  // Cleanup
  await req('DELETE', '/api/pdfme/templates/' + tmplData.id);
}

run();
