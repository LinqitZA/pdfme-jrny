const crypto = require('crypto');
const fs = require('fs');
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: 'test-user-376',
  orgId: 'org-font-cache-376',
  roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
  iat: Math.floor(Date.now() / 1000),
  exp: 9999999999
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
fs.writeFileSync('/tmp/test-jwt-376.txt', header + '.' + payload + '.' + sig);
