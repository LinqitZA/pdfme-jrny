const http = require('http');
const crypto = require('crypto');

const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({sub:'test-user-322',orgId:'test-org',roles:['super-admin']})).toString('base64url');
const sig = crypto.createHmac('sha256','pdfme-dev-secret').update(header+'.'+payload).digest('base64url');
const JWT = header+'.'+payload+'.'+sig;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + JWT,
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch(e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

async function main() {
  console.log('=== Feature #322: Version history timestamps ordered correctly ===\n');

  // Create a template
  console.log('Step 1: Create template');
  const createRes = await request('POST', '/api/pdfme/templates', {
    name: 'VersionTimestampTest322',
    type: 'invoice',
    version: 1,
    schema: { pages: [{ elements: [] }] },
    createdBy: 'test-user-322'
  });
  assert(createRes.status === 201 || createRes.status === 200, 'Template created: ' + createRes.status);
  const templateId = createRes.body.id;
  console.log('  Template ID: ' + templateId + '\n');

  // Save 3 times with delays
  console.log('Step 2: Save template 3 times with delays');
  const saveTimestamps = [];

  for (let i = 1; i <= 3; i++) {
    const beforeSave = new Date().toISOString();
    saveTimestamps.push(beforeSave);

    const saveRes = await request('PUT', '/api/pdfme/templates/' + templateId + '/draft', {
      schema: { pages: [{ elements: [{ type: 'text', content: 'Save ' + i }] }] }
    });
    assert(saveRes.status === 200, 'Save ' + i + ' succeeded: status ' + saveRes.status);
    console.log('  Save ' + i + ' at: ' + beforeSave);

    if (i < 3) await sleep(1500);
  }

  console.log('');

  // Get version history
  console.log('Step 3: GET version history');
  const versionsRes = await request('GET', '/api/pdfme/templates/' + templateId + '/versions');
  assert(versionsRes.status === 200, 'Version history retrieved: status ' + versionsRes.status);

  const versions = versionsRes.body.data || versionsRes.body;
  console.log('  Total versions: ' + versions.length);
  assert(versions.length >= 3, 'At least 3 versions exist: ' + versions.length);

  // Step 4: Verify timestamps in descending order
  console.log('\nStep 4: Verify timestamps in descending order');
  let allDescending = true;
  for (let i = 0; i < versions.length - 1; i++) {
    const current = new Date(versions[i].savedAt).getTime();
    const next = new Date(versions[i + 1].savedAt).getTime();
    if (current < next) {
      allDescending = false;
      console.log('  ORDERING ISSUE: version ' + i + ' (' + versions[i].savedAt + ') < version ' + (i+1) + ' (' + versions[i+1].savedAt + ')');
    }
  }
  assert(allDescending, 'All timestamps in descending order (newest first)');

  // Verify each timestamp is a valid date
  let allValid = true;
  for (const v of versions) {
    const ts = new Date(v.savedAt);
    if (isNaN(ts.getTime())) {
      allValid = false;
      console.log('  INVALID timestamp: ' + v.savedAt);
    }
  }
  assert(allValid, 'All timestamps are valid dates');

  // Verify each version has distinct timestamps (saves had delays)
  console.log('\nStep 5: Verify each timestamp > previous save');
  const timestamps = versions.map(v => new Date(v.savedAt).getTime());
  let allDistinct = true;
  for (let i = 0; i < timestamps.length - 1; i++) {
    if (timestamps[i] === timestamps[i + 1]) {
      allDistinct = false;
    }
  }
  assert(allDistinct, 'All version timestamps are distinct');

  // The newest 3 versions should be from our saves (descending order)
  const newest3 = versions.slice(0, 3);
  for (let i = 0; i < newest3.length - 1; i++) {
    const current = new Date(newest3[i].savedAt).getTime();
    const next = new Date(newest3[i + 1].savedAt).getTime();
    assert(current > next, 'Version ' + i + ' savedAt (' + newest3[i].savedAt + ') > version ' + (i+1) + ' savedAt (' + newest3[i+1].savedAt + ')');
  }

  // Print version details
  console.log('\nVersion details:');
  for (const v of versions) {
    console.log('  v' + v.version + ' | status: ' + v.status + ' | savedAt: ' + v.savedAt + ' | savedBy: ' + v.savedBy);
  }

  // Cleanup
  await request('DELETE', '/api/pdfme/templates/' + templateId);

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
