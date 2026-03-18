const crypto = require('crypto');
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'test-user-322',orgId:'test-org',roles:['super-admin']})).toString('base64url');
const sig = crypto.createHmac('sha256','pdfme-dev-secret').update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
