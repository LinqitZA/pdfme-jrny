const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'user-test',orgId:'org-test',roles:['template:edit','template:publish','render:trigger','template:import']})).toString('base64url');
console.log(header+'.'+payload+'.testsig');
