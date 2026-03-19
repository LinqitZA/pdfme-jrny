const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'user1', orgId: 'org1', permissions: ['template:read','template:write','template:publish','template:delete','render:execute','admin:seed'] },
  'dev-secret',
  { expiresIn: '1h' }
);
process.stdout.write(token);
