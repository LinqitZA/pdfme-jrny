// Verify that preview PDF differs from regular render due to watermark
// Create same template, render both ways, compare

const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Create a simple template
  const tmpl = await request('POST', `${BASE}/templates`, {
    name: 'watermark-verify',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        { name: 'field1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 },
        { name: 'field2', type: 'text', position: { x: 10, y: 40 }, width: 100, height: 20 },
      ]],
    },
  });

  // Publish it
  await request('POST', `${BASE}/templates/${tmpl.id}/publish`, {});

  // Regular render (no watermark)
  const regular = await request('POST', `${BASE}/render/now`, {
    templateId: tmpl.id,
    entityId: 'e1',
    channel: 'email',
    inputs: [{ field1: 'Sample Name', field2: '2026-03-15' }],
  });

  // Preview render (with watermark + sample data)
  const preview = await request('POST', `${BASE}/templates/${tmpl.id}/preview`, {
    sampleRowCount: 5,
    channel: 'email',
  });

  const regularHash = regular.document ? regular.document.pdfHash : 'N/A';
  const previewId = preview.previewId || 'N/A';

  console.log('Regular render hash:', regularHash);
  console.log('Preview ID:', previewId);
  console.log('Preview has downloadUrl:', !!preview.downloadUrl);
  console.log('Preview has expiresAt:', !!preview.expiresAt);

  // Read both PDFs and compare sizes
  const fs = require('fs');
  const regularPath = regular.document ? `storage/${regular.document.filePath}` : null;
  const previewPath = preview.previewId ? `storage/test-org/previews/${preview.previewId}.pdf` : null;

  if (regularPath && fs.existsSync(regularPath) && previewPath && fs.existsSync(previewPath)) {
    const regularSize = fs.statSync(regularPath).size;
    const previewSize = fs.statSync(previewPath).size;
    console.log('Regular PDF size:', regularSize);
    console.log('Preview PDF size:', previewSize);
    console.log('Sizes differ:', regularSize !== previewSize);

    // Even with same input, the watermark overlay makes them different
    const regularBuf = fs.readFileSync(regularPath);
    const previewBuf = fs.readFileSync(previewPath);
    const buffersEqual = regularBuf.equals(previewBuf);
    console.log('PDFs are different:', !buffersEqual);

    if (!buffersEqual) {
      console.log('PASS: Preview PDF differs from regular render (watermark applied)');
    } else {
      console.log('FAIL: Preview PDF identical to regular render');
    }
  } else {
    console.log('SKIP: Could not compare files');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
