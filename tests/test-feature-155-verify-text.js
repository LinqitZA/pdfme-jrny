const http = require('http');
const fs = require('fs');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';
const BASE = 'http://localhost:3000';

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
    name: 'Placeholder Verify ' + Date.now(), type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 10 },
        { name: 'logo', type: 'erpImage', assetPath: 'test-org/assets/nonexistent.png', position: { x: 10, y: 30 }, width: 60, height: 40 },
      ]],
    },
  });
  const tplId = tpl.data.id;
  await request('POST', '/api/pdfme/templates/' + tplId + '/publish');

  const r = await request('POST', '/api/pdfme/render/now', {
    templateId: tplId, entityId: 'VERIFY-TEXT', channel: 'print',
    inputs: [{ title: 'Invoice 001' }],
  });

  if (r.data && r.data.document && r.data.document.filePath) {
    const filePath = r.data.document.filePath;
    const fullPath = require('path').resolve('storage', filePath);
    process.stdout.write('PDF path: ' + fullPath + '\n');

    if (fs.existsSync(fullPath)) {
      const pdfBytes = fs.readFileSync(fullPath);
      const pdfText = pdfBytes.toString('latin1');
      const hasImageNotFound = pdfText.includes('Image not found');
      process.stdout.write('PDF contains "Image not found": ' + hasImageNotFound + '\n');
      process.stdout.write('PDF size: ' + pdfBytes.length + ' bytes\n');

      if (hasImageNotFound) {
        process.stdout.write('PASS: Placeholder text rendered in PDF\n');
      } else {
        process.stdout.write('FAIL: Placeholder text NOT found in PDF\n');
      }
    } else {
      process.stdout.write('FAIL: PDF file not found at path\n');
    }
  } else {
    process.stdout.write('FAIL: No document in response\n');
  }

  await request('DELETE', '/api/pdfme/templates/' + tplId);
}

main().catch(err => { process.stderr.write(err.stack + '\n'); process.exit(1); });
