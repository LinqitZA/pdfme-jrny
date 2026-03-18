const crypto = require('crypto');
const s = 'pdfme-dev-secret';
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify({sub:'test',orgId:'org-test',roles:['template:view','template:edit','template:publish'],iat:Math.floor(Date.now()/1000),exp:9999999999})).toString('base64url');
const sig = crypto.createHmac('sha256',s).update(h+'.'+p).digest('base64url');
const fs = require('fs');
fs.writeFileSync('/tmp/token25.txt', h+'.'+p+'.'+sig);
