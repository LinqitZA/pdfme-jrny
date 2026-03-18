const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'test-user',orgId:'test-org',roles:['template:view','template:edit']})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
const fs = require('fs');
fs.writeFileSync('/tmp/test-jwt.txt', header + '.' + payload + '.' + sig);
