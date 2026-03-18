const { signJwt } = require('./create-signed-token');
const token = signJwt({sub:'user-test',orgId:'org-test',roles:['template:edit','template:publish','render:trigger','template:import']});
console.log(token);
