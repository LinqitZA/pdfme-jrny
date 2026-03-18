const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload1 = Buffer.from(JSON.stringify({sub:'user-A',orgId:'org-export-test',roles:['template:edit','template:view']})).toString('base64url');
const payload2 = Buffer.from(JSON.stringify({sub:'user-B',orgId:'org-export-test',roles:['template:view']})).toString('base64url');
console.log('TOKEN_A=' + header + '.' + payload1 + '.sig');
console.log('TOKEN_B=' + header + '.' + payload2 + '.sig');
