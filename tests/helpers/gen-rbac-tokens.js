const crypto = require('crypto');
const fs = require('fs');
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';

function makeToken(sub, orgId, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub,
    orgId: orgId,
    roles: roles,
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const tokens = {
  viewOnly: makeToken('rbac-viewer', 'org-rbac', ['template:view']),
  noRoles: makeToken('rbac-none', 'org-rbac', []),
  editOnly: makeToken('rbac-editor', 'org-rbac', ['template:edit']),
  viewAndEdit: makeToken('rbac-editor2', 'org-rbac', ['template:view', 'template:edit']),
  publishOnly: makeToken('rbac-publisher', 'org-rbac', ['template:publish']),
  editNoPublish: makeToken('rbac-edit-only', 'org-rbac', ['template:edit', 'template:view']),
  fullAccess: makeToken('rbac-admin', 'org-rbac', ['template:view', 'template:edit', 'template:publish']),
};

fs.writeFileSync('/tmp/rbac-tokens.json', JSON.stringify(tokens, null, 2));
console.log('Tokens written to /tmp/rbac-tokens.json');
console.log(JSON.stringify(tokens, null, 2));
