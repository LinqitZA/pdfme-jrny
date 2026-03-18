/**
 * Feature #217: Asset upload validates file type
 * Only allowed file types accepted
 *
 * Steps:
 * 1. Upload .exe file → rejection
 * 2. Upload .png → accepted
 * 3. Upload .ttf → accepted
 * 4. Upload .woff2 → accepted
 */

const http = require('http');
const { signJwt } = require('./create-signed-token');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const TOKEN = signJwt({ sub: 'user1', orgId: 'test-asset-validation', roles: ['admin'] });

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function uploadFile(filename, content, mimeType) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const url = new URL(`${BASE}/api/pdfme/assets/upload`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('Feature #217: Asset upload validates file type\n');

  // 1. Upload .exe file - should be rejected
  console.log('Test 1: Upload .exe file → rejection');
  const exeResult = await uploadFile('malware.exe', 'MZ fake exe content', 'application/octet-stream');
  assert(exeResult.status === 400, `.exe should return 400, got ${exeResult.status}`);
  assert(exeResult.body && exeResult.body.message && exeResult.body.message.includes('Unsupported file type'), `.exe error message should mention unsupported file type`);
  assert(exeResult.body && exeResult.body.message && exeResult.body.message.includes('.exe'), `.exe error should mention .exe extension`);

  // 2. Upload .bat file - should be rejected
  console.log('Test 2: Upload .bat file → rejection');
  const batResult = await uploadFile('script.bat', '@echo off', 'application/bat');
  assert(batResult.status === 400, `.bat should return 400, got ${batResult.status}`);

  // 3. Upload .js file - should be rejected
  console.log('Test 3: Upload .js file → rejection');
  const jsResult = await uploadFile('hack.js', 'alert(1)', 'application/javascript');
  assert(jsResult.status === 400, `.js should return 400, got ${jsResult.status}`);

  // 4. Upload .html file - should be rejected
  console.log('Test 4: Upload .html file → rejection');
  const htmlResult = await uploadFile('page.html', '<html></html>', 'text/html');
  assert(htmlResult.status === 400, `.html should return 400, got ${htmlResult.status}`);

  // 5. Upload .pdf file - should be rejected (not in allowed list)
  console.log('Test 5: Upload .pdf file → rejection');
  const pdfResult = await uploadFile('doc.pdf', '%PDF-1.4 fake', 'application/pdf');
  assert(pdfResult.status === 400, `.pdf should return 400, got ${pdfResult.status}`);

  // 6. Upload .php file - should be rejected
  console.log('Test 6: Upload .php file → rejection');
  const phpResult = await uploadFile('shell.php', '<?php echo 1;', 'application/x-php');
  assert(phpResult.status === 400, `.php should return 400, got ${phpResult.status}`);

  // 7. Upload .png file - should be accepted
  console.log('Test 7: Upload .png file → accepted');
  // Minimal valid PNG (1x1 pixel)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, // bit depth 8, color type RGB
    0x00, 0x00, 0x00,       // compression, filter, interlace
  ]);
  const pngResult = await uploadFile('test-image.png', pngHeader, 'image/png');
  assert(pngResult.status === 201, `.png should return 201, got ${pngResult.status}`);
  assert(pngResult.body && pngResult.body.category === 'image', `.png category should be 'image'`);
  assert(pngResult.body && pngResult.body.originalName === 'test-image.png', `.png originalName correct`);
  assert(pngResult.body && pngResult.body.id, `.png should return an id`);

  // 8. Upload .jpg file - should be accepted
  console.log('Test 8: Upload .jpg file → accepted');
  const jpgResult = await uploadFile('photo.jpg', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'image/jpeg');
  assert(jpgResult.status === 201, `.jpg should return 201, got ${jpgResult.status}`);
  assert(jpgResult.body && jpgResult.body.category === 'image', `.jpg category should be 'image'`);

  // 9. Upload .jpeg file - should be accepted
  console.log('Test 9: Upload .jpeg file → accepted');
  const jpegResult = await uploadFile('photo.jpeg', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'image/jpeg');
  assert(jpegResult.status === 201, `.jpeg should return 201, got ${jpegResult.status}`);

  // 10. Upload .svg file - should be accepted
  console.log('Test 10: Upload .svg file → accepted');
  const svgResult = await uploadFile('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', 'image/svg+xml');
  assert(svgResult.status === 201, `.svg should return 201, got ${svgResult.status}`);
  assert(svgResult.body && svgResult.body.category === 'image', `.svg category should be 'image'`);

  // 11. Upload .webp file - should be accepted
  console.log('Test 11: Upload .webp file → accepted');
  const webpResult = await uploadFile('image.webp', Buffer.from('RIFF\x00\x00\x00\x00WEBP'), 'image/webp');
  assert(webpResult.status === 201, `.webp should return 201, got ${webpResult.status}`);

  // 12. Upload .gif file - should be accepted
  console.log('Test 12: Upload .gif file → accepted');
  const gifResult = await uploadFile('anim.gif', Buffer.from('GIF89a'), 'image/gif');
  assert(gifResult.status === 201, `.gif should return 201, got ${gifResult.status}`);

  // 13. Upload .ttf font - should be accepted
  console.log('Test 13: Upload .ttf font → accepted');
  const ttfResult = await uploadFile('CustomFont.ttf', Buffer.from([0x00, 0x01, 0x00, 0x00]), 'font/ttf');
  assert(ttfResult.status === 201, `.ttf should return 201, got ${ttfResult.status}`);
  assert(ttfResult.body && ttfResult.body.category === 'font', `.ttf category should be 'font'`);
  assert(ttfResult.body && ttfResult.body.originalName === 'CustomFont.ttf', `.ttf originalName correct`);

  // 14. Upload .otf font - should be accepted
  console.log('Test 14: Upload .otf font → accepted');
  const otfResult = await uploadFile('CustomFont.otf', Buffer.from('OTTO'), 'font/otf');
  assert(otfResult.status === 201, `.otf should return 201, got ${otfResult.status}`);
  assert(otfResult.body && otfResult.body.category === 'font', `.otf category should be 'font'`);

  // 15. Upload .woff2 font - should be accepted
  console.log('Test 15: Upload .woff2 font → accepted');
  const woff2Result = await uploadFile('CustomFont.woff2', Buffer.from('wOF2'), 'font/woff2');
  assert(woff2Result.status === 201, `.woff2 should return 201, got ${woff2Result.status}`);
  assert(woff2Result.body && woff2Result.body.category === 'font', `.woff2 category should be 'font'`);
  assert(woff2Result.body && woff2Result.body.originalName === 'CustomFont.woff2', `.woff2 originalName correct`);

  // 16. No file provided - should be rejected
  console.log('Test 16: No file provided → rejection');
  const noFileResult = await new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/pdfme/assets/upload`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
  assert(noFileResult.status === 400, `No file should return 400, got ${noFileResult.status}`);

  // 17. Double extension attack - should be rejected based on final extension
  console.log('Test 17: Double extension .png.exe → rejection');
  const doubleExtResult = await uploadFile('image.png.exe', 'fake content', 'application/octet-stream');
  assert(doubleExtResult.status === 400, `.png.exe should return 400, got ${doubleExtResult.status}`);

  // 18. Accepted files return proper metadata
  console.log('Test 18: Accepted files return proper metadata');
  assert(pngResult.body && pngResult.body.storagePath, '.png should have storagePath');
  assert(pngResult.body && pngResult.body.size > 0, '.png should have size > 0');
  assert(pngResult.body && pngResult.body.createdAt, '.png should have createdAt');
  assert(pngResult.body && pngResult.body.mimeType === 'image/png', '.png mimeType should be image/png');

  // 19. Font files have correct storage path (fonts/ directory)
  console.log('Test 19: Font storage path contains /fonts/');
  assert(ttfResult.body && ttfResult.body.storagePath && ttfResult.body.storagePath.includes('/fonts/'), '.ttf storagePath should include /fonts/');
  assert(woff2Result.body && woff2Result.body.storagePath && woff2Result.body.storagePath.includes('/fonts/'), '.woff2 storagePath should include /fonts/');

  // 20. Image files have correct storage path (assets/ directory)
  console.log('Test 20: Image storage path contains /assets/');
  assert(pngResult.body && pngResult.body.storagePath && pngResult.body.storagePath.includes('/assets/'), '.png storagePath should include /assets/');
  assert(svgResult.body && svgResult.body.storagePath && svgResult.body.storagePath.includes('/assets/'), '.svg storagePath should include /assets/');

  // Summary
  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${passed + failed} passed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
