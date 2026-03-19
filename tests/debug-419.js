const crypto = require('crypto');

const API_BASE = 'http://localhost:3001/api/pdfme';

function generateToken() {
  const secret = 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-debug',
    orgId: 'org-debug',
    roles: ['template_admin', 'template:view', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

async function run() {
  const token = generateToken();
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Create template
  const createResp = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({
      name: 'debug-rect',
      type: 'custom',
      schema: {
        pages: [{ elements: [{
          type: 'rectangle',
          name: 'r1',
          position: { x: 20, y: 30 },
          width: 80,
          height: 50,
          cornerRadius: 5,
          borderWidth: 1,
          borderColor: '#000000',
          fillColor: '#ffffff',
          opacity: 1,
        }] }],
        basePdf: { width: 595, height: 842, padding: [0, 0, 0, 0] },
      },
    }),
  });
  console.log('CREATE status:', createResp.status);
  const createData = await createResp.json();
  console.log('CREATE data:', JSON.stringify(createData).substring(0, 300));

  // Get template
  const getResp = await fetch(`${API_BASE}/templates/${createData.id}`, { headers: hdrs });
  console.log('GET status:', getResp.status);
  const getData = await getResp.json();
  console.log('GET data:', JSON.stringify(getData).substring(0, 500));

  // Save draft
  const draftResp = await fetch(`${API_BASE}/templates/${createData.id}/draft`, {
    method: 'PUT',
    headers: hdrs,
    body: JSON.stringify({
      name: 'debug-rect',
      schema: {
        pages: [{ elements: [{
          type: 'rectangle',
          name: 'r1',
          position: { x: 20, y: 30 },
          width: 80,
          height: 50,
          cornerRadius: 5,
          borderWidth: 1,
          borderColor: '#000000',
          fillColor: '#ffffff',
          opacity: 1,
        }] }],
        basePdf: { width: 595, height: 842, padding: [0, 0, 0, 0] },
      },
    }),
  });
  console.log('DRAFT status:', draftResp.status);

  // Publish
  const pubResp = await fetch(`${API_BASE}/templates/${createData.id}/publish`, {
    method: 'POST',
    headers: hdrs,
  });
  console.log('PUBLISH status:', pubResp.status);
  const pubData = await pubResp.json();
  console.log('PUBLISH data:', JSON.stringify(pubData).substring(0, 500));

  // Render
  if (pubResp.ok) {
    const renderResp = await fetch(`${API_BASE}/render/now`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        templateId: createData.id,
        entityId: 'test-debug-419',
        channel: 'email',
        inputs: {},
      }),
    });
    console.log('RENDER status:', renderResp.status);
    const renderData = await renderResp.json();
    console.log('RENDER data keys:', Object.keys(renderData));
    console.log('RENDER data:', JSON.stringify(renderData).substring(0, 800));
  }
}

run().catch(console.error);
