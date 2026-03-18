const crypto = require('crypto');
const secret = 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub, orgId, roles, iat:Math.floor(Date.now()/1000), exp:9999999999})).toString('base64url');
  const sig = crypto.createHmac('sha256',secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}

async function main() {
  const token = makeToken('rate-user-a', 'org-rate-a', ['template:view','template:edit','template:publish','render:trigger']);

  // Create template
  const createRes = await fetch('http://localhost:3001/api/pdfme/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: 'Rate Test Template', type: 'invoice', schema: { pages: [{ elements: [{ name: 'f1', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }] }] } })
  });
  const createData = await createRes.json();
  console.log('Create:', createRes.status, JSON.stringify(createData).substring(0, 300));
}

main().catch(e => console.error(e));
