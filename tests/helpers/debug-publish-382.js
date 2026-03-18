const http = require('http');
const crypto = require('crypto');

const secret = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'test', orgId: 'org-colspan-382', roles: ['template_admin','template:edit','template:publish','render:trigger','super_admin'], iat: Math.floor(Date.now()/1000), exp: 9999999999 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
const TOKEN = header + '.' + payload + '.' + sig;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // Create template with subRows that has bindings
  const schema = {
    pages: [{
      elements: [{
        name: 'lineItemsWithSubRows',
        type: 'lineItemsTable',
        position: { x: 10, y: 20 },
        width: 190,
        height: 200,
        showHeader: true,
        columns: [
          { key: 'item', header: 'Item', width: 50, align: 'left' },
          { key: 'description', header: 'Description', width: 60, align: 'left' },
          { key: 'qty', header: 'Qty', width: 25, align: 'right' },
          { key: 'amount', header: 'Amount', width: 55, align: 'right', format: '#,##0.00' }
        ],
        subRows: [{
          id: 'notes',
          condition: { type: 'fieldNonEmpty', field: 'notes' },
          cells: { item: '{{notes}}' },
          colSpan: 4,
          startColumnKey: 'item'
        }],
        footerRows: [{
          id: 'total',
          label: 'Total',
          labelColumnKey: 'item',
          valueColumnKey: 'amount',
          type: 'sum',
          format: '#,##0.00',
          labelColSpan: 3,
          style: { fontWeight: 'bold' }
        }]
      }]
    }]
  };

  const createRes = await req('POST', '/api/pdfme/templates', { name: 'Debug SubRow 382', type: 'invoice', orgId: 'org-colspan-382', schema });
  console.log('Create:', createRes.status, createRes.body);

  const id = JSON.parse(createRes.body).id;
  const pubRes = await req('POST', '/api/pdfme/templates/' + id + '/publish', {});
  console.log('Publish:', pubRes.status, pubRes.body);
}

main().catch(console.error);
