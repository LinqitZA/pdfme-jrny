const crypto = require('crypto');
const fs = require('fs');
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const orgId = 'org-prop-update-388';
const userId = 'user-prop-update-388';
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: userId,
  orgId: orgId,
  roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
  iat: Math.floor(Date.now() / 1000),
  exp: 9999999999
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
fs.writeFileSync('/tmp/token388.txt', header + '.' + payload + '.' + sig);
