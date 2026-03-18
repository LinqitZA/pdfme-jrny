const crypto = require('crypto');
const secret = 'pdfme-dev-secret';
function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}
const token = makeJwt({sub:'test-user',orgId:'test-org-264',roles:['admin']});
const fs = require('fs');
fs.writeFileSync('/tmp/test-jwt.txt', token);
