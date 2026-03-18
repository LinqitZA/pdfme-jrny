const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000/api/pdfme';
const SECRET = 'pdfme-dev-secret';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, orgId,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'super_admin'],
    iat: Math.floor(Date.now() / 1000), exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = makeToken('test-user-372', 'org-fonts-372');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0, failed = 0, total = 0;
function assert(name, condition, detail) {
  total++;
  if (condition) { passed++; console.log('PASS: ' + name); }
  else { failed++; console.log('FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

// Known open-licence fonts and their licences
const OPEN_LICENCES = ['SIL-OFL-1.1', 'Apache-2.0', 'MIT', 'OFL-1.1'];

async function run() {
  console.log('=== Feature #372: All system fonts open-licence ===\n');

  // Step 1: Get system fonts via API
  console.log('Step 1: Fetch system fonts registry...');
  const sysRes = await request('GET', '/fonts/system');
  assert('System fonts endpoint responds 200', sysRes.status === 200, 'status=' + sysRes.status);
  assert('Has fonts array', Array.isArray(sysRes.body?.fonts));
  assert('Has at least 4 system fonts', (sysRes.body?.fonts?.length || 0) >= 4,
    'count=' + sysRes.body?.fonts?.length);

  const fonts = sysRes.body?.fonts || [];

  // Step 2: Check Inter font licence
  console.log('\nStep 2: Check Inter font...');
  const inter = fonts.find(f => f.name === 'Inter');
  assert('Inter font registered', !!inter);
  assert('Inter licence is SIL-OFL-1.1', inter?.licence === 'SIL-OFL-1.1', 'licence=' + inter?.licence);
  assert('Inter is embeddable', inter?.embeddable === true);
  assert('Inter is open-licence', inter?.openLicence === true);
  assert('Inter fsType allows embedding', inter?.fsType === 0x0000, 'fsType=' + inter?.fsType);

  // Step 3: Check Noto Sans font licence
  console.log('\nStep 3: Check Noto Sans font...');
  const noto = fonts.find(f => f.name === 'Noto Sans');
  assert('Noto Sans font registered', !!noto);
  assert('Noto Sans licence is SIL-OFL-1.1', noto?.licence === 'SIL-OFL-1.1', 'licence=' + noto?.licence);
  assert('Noto Sans is embeddable', noto?.embeddable === true);
  assert('Noto Sans is open-licence', noto?.openLicence === true);
  assert('Noto Sans fsType allows embedding', noto?.fsType === 0x0000);

  // Step 4: Check IBM Plex Sans font licence
  console.log('\nStep 4: Check IBM Plex Sans font...');
  const ibm = fonts.find(f => f.name === 'IBM Plex Sans');
  assert('IBM Plex Sans font registered', !!ibm);
  assert('IBM Plex Sans licence is SIL-OFL-1.1', ibm?.licence === 'SIL-OFL-1.1', 'licence=' + ibm?.licence);
  assert('IBM Plex Sans is embeddable', ibm?.embeddable === true);
  assert('IBM Plex Sans is open-licence', ibm?.openLicence === true);
  assert('IBM Plex Sans fsType allows embedding', ibm?.fsType === 0x0000);

  // Step 5: Check Roboto font licence
  console.log('\nStep 5: Check Roboto font...');
  const roboto = fonts.find(f => f.name === 'Roboto');
  assert('Roboto font registered', !!roboto);
  assert('Roboto licence is Apache-2.0', roboto?.licence === 'Apache-2.0', 'licence=' + roboto?.licence);
  assert('Roboto is embeddable', roboto?.embeddable === true);
  assert('Roboto is open-licence', roboto?.openLicence === true);
  assert('Roboto fsType allows embedding', roboto?.fsType === 0x0000);

  // Step 6: Verify NO proprietary fonts in system
  console.log('\nStep 6: Verify no proprietary fonts...');
  assert('allOpenLicence flag is true', sysRes.body?.allOpenLicence === true);
  assert('proprietaryCount is 0', sysRes.body?.proprietaryCount === 0,
    'count=' + sysRes.body?.proprietaryCount);
  assert('No proprietary font names', (sysRes.body?.proprietaryFonts?.length || 0) === 0);

  // Verify all fonts have recognized open licences
  const allRecognized = fonts.every(f => OPEN_LICENCES.includes(f.licence));
  assert('All licences are recognized open-source', allRecognized);

  // Check no known proprietary fonts
  const proprietaryNames = ['Arial', 'Helvetica', 'Times New Roman', 'Calibri', 'Cambria',
    'Verdana', 'Tahoma', 'Georgia', 'Segoe UI', 'Century Gothic'];
  const hasProprietary = fonts.some(f => proprietaryNames.includes(f.name));
  assert('No known proprietary fonts in registry', !hasProprietary);

  // Step 7: Verify font sources are reputable
  console.log('\nStep 7: Verify font sources...');
  for (const font of fonts) {
    const hasSource = !!font.source;
    assert(`${font.name} has source info`, hasSource, 'source=' + font.source);
    const hasLicenceUrl = !!font.licenceUrl && font.licenceUrl.startsWith('https://');
    assert(`${font.name} has licence URL`, hasLicenceUrl, 'url=' + font.licenceUrl);
  }

  // Step 8: Verify all fonts have consistent role descriptions
  console.log('\nStep 8: Font roles...');
  for (const font of fonts) {
    assert(`${font.name} has role description`, !!font.role && font.role.length > 5);
  }

  // Step 9: Verify licence summary
  console.log('\nStep 9: Licence summary...');
  const licences = sysRes.body?.licences || [];
  assert('Licence list includes SIL-OFL-1.1', licences.includes('SIL-OFL-1.1'));
  assert('Licence list includes Apache-2.0', licences.includes('Apache-2.0'));
  assert('Only open licences in list', licences.every(l => OPEN_LICENCES.includes(l)));

  console.log('\n=== Results ===');
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
