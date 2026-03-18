const crypto = require('crypto');
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const p = Buffer.from(JSON.stringify({sub:'user1',orgId:'org1',roles:['admin']})).toString('base64url');
const s = crypto.createHmac('sha256', secret).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
