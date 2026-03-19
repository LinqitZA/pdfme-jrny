const crypto = require('crypto');
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'test-user-423', orgId: 'test-org-423', roles: ['admin'], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const signature = crypto.createHmac('sha256', 'pdfme-dev-secret').update(header + '.' + payload).digest('base64url');
const jwt = header + '.' + payload + '.' + signature;
const h = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt };

async function main() {
  // Create template
  const r1 = await fetch('http://localhost:3001/api/pdfme/templates', {
    method: 'POST', headers: h,
    body: JSON.stringify({ name: 'Test LIT Debug2', type: 'invoice', schema: { schemas: [[{ name: 'lineItems', type: 'lineItemsTable', position: { x: 10, y: 30 }, width: 190, height: 100, showHeader: true, columns: [{ key: 'desc', header: 'Desc', width: 80 }] }]], basePdf: 'BLANK_PDF' } }),
  });
  const d1 = await r1.json();
  const tid = d1.data?.id || d1.id;
  process.stdout.write('Create: ' + r1.status + ' tid=' + tid + '\n');

  // Publish
  const r3 = await fetch('http://localhost:3001/api/pdfme/templates/' + tid + '/publish', { method: 'POST', headers: h });
  const d3 = await r3.text();
  process.stdout.write('Publish: ' + r3.status + ' ' + d3.substring(0, 300) + '\n');

  // Cleanup
  await fetch('http://localhost:3001/api/pdfme/templates/' + tid, { method: 'DELETE', headers: h });
}
main().catch(e => process.stderr.write(e.message + '\n'));
