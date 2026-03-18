/**
 * Feature #329: Signature capturedAt timestamp correct
 *
 * Tests that signature capture time is recorded accurately.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:3000';
const ORG_ID = 'org-sig-test-329';
const USER_ID = 'sig-test-user-329';

function generateToken(sub, orgId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Create a minimal 1x1 transparent PNG for testing
function createMinimalPNG() {
  // Minimal valid PNG: 1x1 pixel transparent
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001' +
    '0100000000376ef9240000000a49444154789c626001000000' +
    '0500010d0a2db40000000049454e44ae426082',
    'hex'
  );
  return 'data:image/png;base64,' + pngBytes.toString('base64');
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function runTests() {
  console.log('Feature #329: Signature capturedAt timestamp correct\n');

  // Step 1: Note current time before upload
  const beforeUpload = new Date();
  console.log(`Before upload time: ${beforeUpload.toISOString()}`);

  // Step 2: Upload signature
  console.log('\nStep 1: Uploading signature...');
  const uploadRes = await request('POST', '/api/pdfme/signatures', {
    data: createMinimalPNG(),
    orgId: ORG_ID,
  });

  assert(uploadRes.status === 201, `Upload returns 201 (got ${uploadRes.status})`);
  assert(uploadRes.body.capturedAt !== undefined, 'Response includes capturedAt');
  assert(uploadRes.body.userId === USER_ID, `userId matches (${uploadRes.body.userId})`);
  assert(uploadRes.body.orgId === ORG_ID, `orgId matches (${uploadRes.body.orgId})`);
  assert(uploadRes.body.id !== undefined, 'Response includes id');
  assert(uploadRes.body.filePath !== undefined, 'Response includes filePath');

  const afterUpload = new Date();

  // Step 3: Verify capturedAt is close to upload time
  console.log('\nStep 2: Verifying capturedAt timestamp accuracy...');
  const capturedAt = new Date(uploadRes.body.capturedAt);
  assert(!isNaN(capturedAt.getTime()), 'capturedAt is a valid date');

  const timeDiffMs = Math.abs(capturedAt.getTime() - beforeUpload.getTime());
  assert(timeDiffMs < 5000, `capturedAt within 5s of upload time (diff: ${timeDiffMs}ms)`);

  assert(capturedAt >= beforeUpload, `capturedAt (${capturedAt.toISOString()}) >= beforeUpload (${beforeUpload.toISOString()})`);
  assert(capturedAt <= afterUpload, `capturedAt (${capturedAt.toISOString()}) <= afterUpload (${afterUpload.toISOString()})`);

  // Verify ISO 8601 format
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  assert(isoRegex.test(uploadRes.body.capturedAt), `capturedAt is ISO 8601 format: ${uploadRes.body.capturedAt}`);

  // Step 4: Query the signature and verify capturedAt matches
  console.log('\nStep 3: Querying signature via GET /signatures/me...');
  const getRes = await request('GET', '/api/pdfme/signatures/me');
  assert(getRes.status === 200, `GET returns 200 (got ${getRes.status})`);
  assert(getRes.body.capturedAt !== undefined, 'GET response includes capturedAt');

  const getCapturedAt = new Date(getRes.body.capturedAt);
  assert(!isNaN(getCapturedAt.getTime()), 'GET capturedAt is a valid date');

  // Compare upload and GET timestamps - should be the same record
  const uploadTime = new Date(uploadRes.body.capturedAt).getTime();
  const getTime = getCapturedAt.getTime();
  const getTimeDiff = Math.abs(uploadTime - getTime);
  assert(getTimeDiff < 1000, `GET capturedAt matches upload capturedAt (diff: ${getTimeDiff}ms)`);

  // Step 5: Upload again and verify new capturedAt is newer
  console.log('\nStep 4: Re-uploading to verify new capturedAt...');
  await new Promise(r => setTimeout(r, 100)); // Small delay
  const beforeReupload = new Date();

  const reuploadRes = await request('POST', '/api/pdfme/signatures', {
    data: createMinimalPNG(),
    orgId: ORG_ID,
  });

  assert(reuploadRes.status === 201, `Re-upload returns 201`);
  const reuploadCapturedAt = new Date(reuploadRes.body.capturedAt);
  assert(reuploadCapturedAt > capturedAt, `New capturedAt (${reuploadCapturedAt.toISOString()}) > old capturedAt (${capturedAt.toISOString()})`);
  assert(reuploadCapturedAt >= beforeReupload, `New capturedAt >= re-upload start time`);

  // Step 6: Verify the new signature is returned by GET (old one replaced)
  console.log('\nStep 5: Verify updated signature is returned...');
  const getRes2 = await request('GET', '/api/pdfme/signatures/me');
  assert(getRes2.status === 200, 'GET after re-upload returns 200');
  const get2CapturedAt = new Date(getRes2.body.capturedAt);
  const get2Diff = Math.abs(get2CapturedAt.getTime() - reuploadCapturedAt.getTime());
  assert(get2Diff < 1000, `GET returns updated capturedAt (diff: ${get2Diff}ms)`);

  // Cleanup: revoke signature
  console.log('\nCleaning up...');
  await request('DELETE', '/api/pdfme/signatures/me');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`========================================`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
