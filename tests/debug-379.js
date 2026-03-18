const crypto = require('crypto');
const http = require('http');

const secret = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'u1',orgId:'org-debug-379',roles:['template_admin','template:edit','template:publish'],iat:Math.floor(Date.now()/1000),exp:9999999999})).toString('base64url');
const sig = crypto.createHmac('sha256',secret).update(header+'.'+payload).digest('base64url');
const token = header+'.'+payload+'.'+sig;

function req(method, path, data) {
  return new Promise((resolve, reject) => {
    const opts = {hostname:'localhost',port:3000,path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}};
    const r = http.request(opts, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  // Check available field schemas
  const invoiceFields = await req('GET', '/api/pdfme/field-schema/invoice');
  console.log('Invoice field schema:', JSON.stringify(invoiceFields, null, 2));

  // Also try a generic type that might not have field validation
  const genericFields = await req('GET', '/api/pdfme/field-schema/generic');
  console.log('Generic field schema:', JSON.stringify(genericFields, null, 2));

  // Try custom type
  const customFields = await req('GET', '/api/pdfme/field-schema/custom-379');
  console.log('Custom field schema:', JSON.stringify(customFields, null, 2));
}

main().catch(console.error);
