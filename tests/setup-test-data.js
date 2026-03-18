/**
 * Setup test data for features #178, #179, #180
 * Creates multiple templates of different types for testing
 */
const http = require('http');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiXX0=.sig';
const BASE = process.env.API_BASE || 'http://localhost:3001';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const templates = [
    { name: 'Statement Template 2', type: 'statement' },
    { name: 'Statement Template 3', type: 'statement' },
    { name: 'PO Template 1', type: 'purchase_order' },
    { name: 'PO Template 2', type: 'purchase_order' },
    { name: 'Credit Note Template', type: 'credit_note' },
    { name: 'Delivery Note Template', type: 'delivery_note' },
  ];

  for (const t of templates) {
    const result = await apiCall('POST', '/api/pdfme/templates', {
      name: t.name,
      type: t.type,
      schema: {
        pages: [{ elements: [{ type: 'text', content: t.name, x: 20, y: 20, w: 100, h: 20 }] }],
        basePdf: { width: 210, height: 297 },
      },
    });
    console.log(`Created: ${result.name} (${result.type}) - ID: ${result.id}`);
  }

  // List all templates to verify
  const list = await apiCall('GET', '/api/pdfme/templates');
  console.log(`\nTotal templates: ${list.pagination.total}`);
  console.log('Types:', [...new Set(list.data.map(t => t.type))].join(', '));
}

main().catch(console.error);
