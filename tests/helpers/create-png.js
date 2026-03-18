var fs = require('fs');
var b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
fs.writeFileSync('/tmp/test-export-341.png', Buffer.from(b64, 'base64'));
console.log('Written ' + Buffer.from(b64, 'base64').length + ' bytes');
