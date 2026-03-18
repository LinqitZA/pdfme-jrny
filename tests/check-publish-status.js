// Quick check what status code publish returns
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'user-test',orgId:'org-test',roles:['template:edit','template:publish']})).toString('base64url');
const TOKEN = header + '.' + payload + '.testsig';

async function run() {
  // Create a template
  const createRes = await fetch('http://localhost:3001/api/pdfme/templates', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'status-check',
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20, content: 'Test' }] }] },
    }),
  });
  console.log('Create status:', createRes.status);
  const template = await createRes.json();
  console.log('Template ID:', template.id);

  // Publish
  const pubRes = await fetch(`http://localhost:3001/api/pdfme/templates/${template.id}/publish`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  console.log('Publish status:', pubRes.status);
  const pubData = await pubRes.json();
  console.log('Publish data:', JSON.stringify(pubData).slice(0, 200));

  // Republish
  const repub = await fetch(`http://localhost:3001/api/pdfme/templates/${template.id}/publish`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  console.log('Republish status:', repub.status);
  const repubData = await repub.json();
  console.log('Republish data:', JSON.stringify(repubData).slice(0, 200));
}
run().catch(console.error);
