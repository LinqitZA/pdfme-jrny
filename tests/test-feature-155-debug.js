const http = require('http');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';
const BASE = process.env.API_BASE || 'http://localhost:3001';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname, method,
      headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: text }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const tpl = await request('POST', '/api/pdfme/templates', {
    name: 'Img Debug ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'logo', type: 'erpImage', assetPath: 'test-org/assets/nonexistent.png', position: { x: 10, y: 30 }, width: 60, height: 40 },
      ]],
    },
  });
  process.stdout.write('Template: ' + JSON.stringify(tpl.data && tpl.data.id) + '\n');
  const tplId = tpl.data.id;

  await request('POST', '/api/pdfme/templates/' + tplId + '/publish');

  const r = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'DBG-1', channel: 'print',
    inputs: [{ title: 'Test' }],
  });
  process.stdout.write('Render status: ' + r.status + '\n');
  process.stdout.write('Render error: ' + JSON.stringify(r.data && r.data.error) + '\n');
  process.stdout.write('Doc status: ' + JSON.stringify(r.data && r.data.document && r.data.document.status) + '\n');
  process.stdout.write('Error msg: ' + JSON.stringify(r.data && r.data.document && r.data.document.errorMessage) + '\n');

  await request('DELETE', '/api/pdfme/templates/' + tplId);
}

main().catch(err => { process.stderr.write(err.stack + '\n'); process.exit(1); });
