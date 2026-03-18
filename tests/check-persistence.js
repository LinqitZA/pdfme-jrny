const http = require('http');
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLUEiLCJvcmdJZCI6Im9yZy1leHBvcnQtdGVzdCIsInJvbGVzIjpbInRlbXBsYXRlOmVkaXQiLCJ0ZW1wbGF0ZTp2aWV3Il19.sig';

function req(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, process.env.API_BASE || 'http://localhost:3001');
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const phase = process.argv[2] || 'before';

  if (phase === 'before') {
    // Create a unique template
    const createRes = await req('POST', '/api/pdfme/templates', {
      name: 'RESTART_TEST_PERSIST_140',
      type: 'invoice',
      schema: { test: true },
    });
    console.log('Created template: ' + createRes.body.id);

    // Export it
    const exportRes = await req('GET', '/api/pdfme/templates/' + createRes.body.id + '/export');
    console.log('Export status: ' + exportRes.status);
    console.log('Export has template: ' + (exportRes.body.template !== undefined));

    // Lock it
    const lockRes = await req('POST', '/api/pdfme/templates/' + createRes.body.id + '/lock');
    console.log('Lock status: ' + lockRes.status);
    console.log('Lock lockedBy: ' + lockRes.body.lockedBy);

    console.log('TEMPLATE_ID=' + createRes.body.id);
  } else if (phase === 'after') {
    const templateId = process.argv[3];
    if (!templateId) {
      console.log('FAIL: No template ID provided');
      process.exit(1);
    }

    // Verify template still exists
    const getRes = await req('GET', '/api/pdfme/templates/' + templateId);
    console.log('Template exists after restart: ' + (getRes.status === 200));
    console.log('Template name: ' + getRes.body.name);

    // Verify export still works
    const exportRes = await req('GET', '/api/pdfme/templates/' + templateId + '/export');
    console.log('Export works after restart: ' + (exportRes.status === 200));

    // Verify lock persisted
    const lockStatus = await req('GET', '/api/pdfme/templates/' + templateId + '/lock');
    console.log('Lock persisted: ' + lockStatus.body.locked);
    console.log('Lock user: ' + lockStatus.body.lockedBy);

    if (getRes.status === 200 && getRes.body.name === 'RESTART_TEST_PERSIST_140' && lockStatus.body.locked) {
      console.log('PERSISTENCE_CHECK=PASS');
    } else {
      console.log('PERSISTENCE_CHECK=FAIL');
    }

    // Cleanup
    await req('DELETE', '/api/pdfme/templates/' + templateId + '/lock');
    await req('DELETE', '/api/pdfme/templates/' + templateId);
  }
}

main();
