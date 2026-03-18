const crypto = require('crypto');
const http = require('http');

const BASE = 'http://localhost:3000/api/pdfme';
const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
const ORG_ID = 'org-350-font-license';

function makeToken(sub, orgId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: sub || 'test-user-350',
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    let data = null;
    if (body) data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Build a minimal valid TTF font buffer with a specific fsType value.
 * Creates a font with TTF magic bytes + table directory containing an OS/2 table.
 */
function buildTtfWithFsType(fsType) {
  // TTF header: 4 bytes magic + 2 bytes numTables + 6 bytes (searchRange, entrySelector, rangeShift)
  // Table directory: 1 entry * 16 bytes (OS/2 table)
  // OS/2 table: at least 10 bytes (fsType at offset 8)

  const numTables = 1;
  const headerSize = 12;
  const tableDirectorySize = numTables * 16;
  const os2TableOffset = headerSize + tableDirectorySize;
  const os2TableSize = 96; // Minimum OS/2 table v0 size (we only need 10 bytes for fsType)

  const totalSize = os2TableOffset + os2TableSize;
  const buf = Buffer.alloc(totalSize, 0);

  // TTF magic bytes: 0x00 0x01 0x00 0x00
  buf.writeUInt32BE(0x00010000, 0);
  // numTables
  buf.writeUInt16BE(numTables, 4);
  // searchRange, entrySelector, rangeShift (can be zero for our purposes)
  buf.writeUInt16BE(16, 6);    // searchRange
  buf.writeUInt16BE(0, 8);     // entrySelector
  buf.writeUInt16BE(16, 10);   // rangeShift

  // Table directory entry for OS/2
  const dirEntry = headerSize;
  buf.write('OS/2', dirEntry, 4, 'ascii');
  buf.writeUInt32BE(0, dirEntry + 4);    // checksum (not validated)
  buf.writeUInt32BE(os2TableOffset, dirEntry + 8); // offset
  buf.writeUInt32BE(os2TableSize, dirEntry + 12);  // length

  // OS/2 table: fsType is at offset 8 (UInt16BE)
  buf.writeUInt16BE(0x0004, os2TableOffset); // version (4)
  // bytes 2-7: average char width, weight class, etc. (zeroed)
  buf.writeUInt16BE(fsType, os2TableOffset + 8); // fsType

  return buf;
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

async function main() {
  const token = makeToken();
  const uniqueSuffix = Date.now();

  console.log('\n=== Feature #350: Template import validates font licenses ===\n');

  // ─── Test 1: Import backup with restricted font (fsType=0x0002) is rejected ───
  console.log('Test 1: Import package with restricted font (fsType=0x0002)');

  const restrictedFont = buildTtfWithFsType(0x0002); // Restricted License
  const compliantFont = buildTtfWithFsType(0x0000);   // Installable (most permissive)
  const previewFont = buildTtfWithFsType(0x0004);     // Preview & Print (allowed)

  const backupWithRestricted = {
    version: 1,
    exportedAt: new Date().toISOString(),
    orgId: 'org-source',
    templates: [
      {
        id: 'tpl-1',
        name: `ImportTest_Restricted_${uniqueSuffix}`,
        type: 'invoice',
        status: 'published',
        version: 1,
        schema: { pages: [{ elements: [{ type: 'text', content: 'Test' }] }] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ],
    assets: {
      images: [],
      fonts: [
        {
          path: `org-source/fonts/restricted-font-${uniqueSuffix}.ttf`,
          data: restrictedFont.toString('base64'),
          mimeType: 'font/ttf',
        },
        {
          path: `org-source/fonts/compliant-font-${uniqueSuffix}.ttf`,
          data: compliantFont.toString('base64'),
          mimeType: 'font/ttf',
        },
      ],
    },
    signatures: [],
    localeConfig: null,
  };

  const result1 = await request('POST', '/templates/backup/import', backupWithRestricted, token);
  assert(result1.status === 201, `Import succeeds with 201 (got ${result1.status})`);

  // Template should be imported even if font is rejected
  assert(result1.body.templatesCreated === 1, `Template imported (${result1.body.templatesCreated})`);

  // Font validation should be in the response
  assert(result1.body.fontValidation !== undefined, `fontValidation present in response`);
  if (result1.body.fontValidation) {
    assert(result1.body.fontValidation.total === 2, `Total fonts: 2 (got ${result1.body.fontValidation.total})`);
    assert(result1.body.fontValidation.rejected >= 1, `At least 1 font rejected (got ${result1.body.fontValidation.rejected})`);
    assert(result1.body.fontValidation.accepted >= 1, `At least 1 font accepted (got ${result1.body.fontValidation.accepted})`);
    assert(result1.body.fontValidation.errors.length >= 1, `Has validation error messages (${result1.body.fontValidation.errors.length})`);

    // Verify error message is clear about restriction
    const restrictedErrors = result1.body.fontValidation.errors.filter(e =>
      e.toLowerCase().includes('restrict') || e.toLowerCase().includes('fstype')
    );
    assert(restrictedErrors.length >= 1, `Error message mentions restriction/fsType: "${restrictedErrors[0] || 'none'}"`);
  }

  // Only compliant font should be restored
  assert(result1.body.assetsRestored.fonts === 1, `Only 1 compliant font restored (got ${result1.body.assetsRestored.fonts})`);

  // ─── Test 2: Verify rejected font has clear error message ───
  console.log('\nTest 2: Verify rejection message is clear');
  if (result1.body.fontValidation?.errors?.length > 0) {
    const errMsg = result1.body.fontValidation.errors[0];
    assert(errMsg.includes('restricted-font') || errMsg.includes('org-source/fonts/'), `Error identifies the font file`);
    assert(
      errMsg.toLowerCase().includes('restricted') ||
      errMsg.toLowerCase().includes('cannot be embedded') ||
      errMsg.toLowerCase().includes('fstype'),
      `Error explains why font was rejected`
    );
  } else {
    assert(false, `Error message exists for review`);
    assert(false, `Error explains rejection reason`);
  }

  // ─── Test 3: Template imported with draft status (fallback behavior) ───
  console.log('\nTest 3: Template imported as draft despite restricted font');
  assert(result1.body.templates?.length === 1, `One template in result`);
  if (result1.body.templates?.length > 0) {
    assert(result1.body.templates[0].status === 'draft', `Template status is draft (got ${result1.body.templates[0].status})`);
    assert(result1.body.templates[0].name.includes('ImportTest_Restricted'), `Template name preserved`);
  }

  // ─── Test 4: Import with all compliant fonts succeeds fully ───
  console.log('\nTest 4: Import with compliant fonts only');
  const backupAllCompliant = {
    version: 1,
    exportedAt: new Date().toISOString(),
    orgId: 'org-source-2',
    templates: [
      {
        id: 'tpl-2',
        name: `ImportTest_Compliant_${uniqueSuffix}`,
        type: 'statement',
        status: 'draft',
        version: 1,
        schema: { pages: [{ elements: [{ type: 'text', content: 'Compliant Test' }] }] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ],
    assets: {
      images: [],
      fonts: [
        {
          path: `org-source-2/fonts/installable-font-${uniqueSuffix}.ttf`,
          data: compliantFont.toString('base64'),
          mimeType: 'font/ttf',
        },
        {
          path: `org-source-2/fonts/preview-font-${uniqueSuffix}.ttf`,
          data: previewFont.toString('base64'),
          mimeType: 'font/ttf',
        },
      ],
    },
    signatures: [],
    localeConfig: null,
  };

  const result2 = await request('POST', '/templates/backup/import', backupAllCompliant, token);
  assert(result2.status === 201, `Import succeeds with 201 (got ${result2.status})`);
  assert(result2.body.templatesCreated === 1, `Template imported`);
  assert(result2.body.assetsRestored.fonts === 2, `Both compliant fonts restored (got ${result2.body.assetsRestored.fonts})`);

  if (result2.body.fontValidation) {
    assert(result2.body.fontValidation.rejected === 0, `No fonts rejected (got ${result2.body.fontValidation.rejected})`);
    assert(result2.body.fontValidation.accepted === 2, `Both fonts accepted (got ${result2.body.fontValidation.accepted})`);
    assert(result2.body.fontValidation.errors.length === 0, `No validation errors`);
  } else {
    // fontValidation may be undefined if no fonts to validate - but we have 2 fonts
    assert(false, `fontValidation should be present for fonts`);
    assert(false, `placeholder`);
    assert(false, `placeholder`);
  }

  // ─── Test 5: Import with editable fsType (0x0008) accepted ───
  console.log('\nTest 5: Import with editable fsType (0x0008) accepted');
  const editableFont = buildTtfWithFsType(0x0008); // Editable embedding
  const backupEditable = {
    version: 1,
    exportedAt: new Date().toISOString(),
    orgId: 'org-source-3',
    templates: [{
      id: 'tpl-3',
      name: `ImportTest_Editable_${uniqueSuffix}`,
      type: 'invoice',
      status: 'draft',
      version: 1,
      schema: { pages: [{ elements: [{ type: 'text', content: 'Editable' }] }] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    assets: {
      images: [],
      fonts: [{
        path: `org-source-3/fonts/editable-font-${uniqueSuffix}.ttf`,
        data: editableFont.toString('base64'),
        mimeType: 'font/ttf',
      }],
    },
    signatures: [],
    localeConfig: null,
  };

  const result3 = await request('POST', '/templates/backup/import', backupEditable, token);
  assert(result3.status === 201, `Import with editable font succeeds`);
  assert(result3.body.assetsRestored.fonts === 1, `Editable font restored`);
  if (result3.body.fontValidation) {
    assert(result3.body.fontValidation.accepted === 1, `Editable font accepted`);
    assert(result3.body.fontValidation.rejected === 0, `No rejection`);
  }

  // ─── Test 6: Single template import also validates fonts ───
  console.log('\nTest 6: Single template import validates font licenses');
  const singleImportRestricted = {
    version: 1,
    template: {
      name: `SingleImport_Restricted_${uniqueSuffix}`,
      type: 'invoice',
      schema: { pages: [{ elements: [{ type: 'text', content: 'Single' }] }] },
    },
    assets: {
      images: [],
      fonts: [
        {
          path: `fonts/restricted-single-${uniqueSuffix}.ttf`,
          data: restrictedFont.toString('base64'),
          mimeType: 'font/ttf',
        },
        {
          path: `fonts/good-single-${uniqueSuffix}.ttf`,
          data: compliantFont.toString('base64'),
          mimeType: 'font/ttf',
        },
      ],
    },
  };

  const result4 = await request('POST', '/templates/import', singleImportRestricted, token);
  assert(result4.status === 201, `Single import succeeds (got ${result4.status})`);
  assert(result4.body.status === 'draft', `Imported as draft`);
  if (result4.body.fontValidation) {
    assert(result4.body.fontValidation.invalid >= 1, `Restricted font detected as invalid (${result4.body.fontValidation.invalid})`);
    assert(result4.body.fontValidation.valid >= 1, `Compliant font accepted (${result4.body.fontValidation.valid})`);
    assert(result4.body.fontValidation.errors.length >= 1, `Has error messages for restricted font`);
  }

  // ─── Test 7: Import with no fonts still works ───
  console.log('\nTest 7: Import with no fonts works fine');
  const backupNoFonts = {
    version: 1,
    exportedAt: new Date().toISOString(),
    orgId: 'org-source-4',
    templates: [{
      id: 'tpl-4',
      name: `ImportTest_NoFonts_${uniqueSuffix}`,
      type: 'invoice',
      status: 'draft',
      version: 1,
      schema: { pages: [{ elements: [{ type: 'text', content: 'No fonts' }] }] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    assets: { images: [], fonts: [] },
    signatures: [],
    localeConfig: null,
  };

  const result5 = await request('POST', '/templates/backup/import', backupNoFonts, token);
  assert(result5.status === 201, `Import with no fonts succeeds`);
  assert(result5.body.templatesCreated === 1, `Template imported`);
  assert(result5.body.assetsRestored.fonts === 0, `No fonts to restore`);

  // ─── Summary ───
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
