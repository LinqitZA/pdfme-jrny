// Setup: Create a template for designer save draft testing
const http = require('http');

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payloadData = Buffer.from(JSON.stringify({ sub: 'user-designer', orgId: 'org-designer', roles: ['template:edit', 'template:publish', 'render:trigger'] })).toString('base64url');
const TOKEN = header + '.' + payloadData + '.devsig';

const req = http.request({hostname:'localhost',port:3000,path:'/api/pdfme/templates',method:'POST',headers:{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'}}, res => {
  let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
    console.log('Status:', res.statusCode);
    const body = JSON.parse(d);
    console.log('Template ID:', body.id);
    console.log('Token:', TOKEN);
  });
});
req.write(JSON.stringify({type:'invoice',name:'Designer Save Draft Test',schema:{schemas:[[{name:'title',type:'text',position:{x:10,y:10},width:100,height:20,content:'Hello'}]],basePdf:{width:210,height:297,padding:[10,10,10,10]}}}));
req.end();
