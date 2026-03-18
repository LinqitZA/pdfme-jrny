const http = require('http');
const { signJwt } = require('./create-signed-token');

const token = signJwt({ sub: 'u1', orgId: 'org-purge-test', roles: ['template:edit', 'template:publish'] });

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3000');
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Create template
  const tpl = await request('POST', '/api/pdfme/templates', {
    name: 'DebugPreview',
    type: 'invoice',
    orgId: 'org-purge-test',
    schema: {
      basePdf: { width: 210, height: 297, padding: [20, 20, 20, 20] },
      schemas: [[{ name: 'company', type: 'text', position: { x: 20, y: 30 }, width: 100, height: 10 }]],
      columns: ['company'],
    },
  });
  console.log('Create template:', tpl.status, JSON.stringify(tpl.body).substring(0, 200));

  const templateId = tpl.body.id;

  // Publish
  const pub = await request('PUT', `/api/pdfme/templates/${templateId}/publish`, {});
  console.log('Publish:', pub.status);

  // Preview (draft - should work on any status)
  const prev = await request('POST', `/api/pdfme/templates/${templateId}/preview`, { channel: 'print' });
  console.log('Preview:', prev.status, JSON.stringify(prev.body).substring(0, 500));
}

run().catch(console.error);
