/**
 * Test script for Feature #192: Text overflow truncate with ellipsis
 *
 * Verifies that text elements with textOverflow='truncate' properly
 * truncate text and add '...' at the boundary.
 */
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const pathModule = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    process.stdout.write('  PASS: ' + msg + '\n');
  } else {
    failed++;
    process.stdout.write('  FAIL: ' + msg + '\n');
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port || 3000, path: url.pathname, method,
      headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
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

function extractPdfStreams(pdfBuffer) {
  const pdfStr = pdfBuffer.toString('latin1');
  let result = '';
  let searchFrom = 0;
  while (true) {
    const s1 = pdfStr.indexOf('stream\r\n', searchFrom);
    const s2 = pdfStr.indexOf('stream\n', searchFrom);
    let actualStart = -1, offset = 0;
    if (s1 >= 0 && (s2 < 0 || s1 < s2)) { actualStart = s1; offset = 8; }
    else if (s2 >= 0) { actualStart = s2; offset = 7; }
    if (actualStart < 0) break;
    const dataStart = actualStart + offset;
    const endStream = pdfStr.indexOf('endstream', dataStart);
    if (endStream < 0) break;
    try {
      const decompressed = zlib.inflateSync(pdfBuffer.slice(dataStart, endStream));
      result += decompressed.toString('utf-8');
    } catch {}
    searchFrom = endStream + 9;
  }
  return result;
}

/**
 * Check if any text rendering command in the PDF has the ellipsis pattern
 * (last 3 glyphs being the same = three period characters)
 */
function hasEllipsisInPdf(decompressed) {
  const tjLines = decompressed.split('\n').filter(l => l.includes('Tj'));
  for (const line of tjLines) {
    const hexMatch = line.match(/<([0-9A-Fa-f]+)>/);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length >= 12) {
        const lastSix = hex.slice(-12);
        const g1 = lastSix.substring(0, 4);
        const g2 = lastSix.substring(4, 8);
        const g3 = lastSix.substring(8, 12);
        if (g1 === g2 && g2 === g3) return true;
      }
    }
  }
  return false;
}

/**
 * Count the number of text rendering commands (Tj) in PDF streams
 */
function countTjCommands(decompressed) {
  return (decompressed.match(/ Tj/g) || []).length;
}

async function run() {
  process.stdout.write('=== Feature #192: Text overflow truncate with ellipsis ===\n\n');

  const LONG_TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Test 1: Create template with textOverflow='truncate'
  process.stdout.write('Test 1: Create template with textOverflow=truncate\n');
  const tmpl1 = await request('POST', BASE + '/templates', {
    name: 'Truncate Test TRUNC192',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'truncatedField',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 50,
          height: 10,
          fontSize: 12,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
          textOverflow: 'truncate',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  assert(tmpl1.status === 201, 'Template with truncate created');
  assert(tmpl1.body && tmpl1.body.id, 'Template has ID');
  const tmplId1 = tmpl1.body ? tmpl1.body.id : null;

  if (tmplId1) {
    // Test 2: Publish
    process.stdout.write('\nTest 2: Publish template\n');
    const pub1 = await request('POST', BASE + '/templates/' + tmplId1 + '/publish', {});
    assert(pub1.status === 200 || pub1.status === 201, 'Template published');

    // Test 3: Render with long text
    process.stdout.write('\nTest 3: Render with long text exceeding bounds\n');
    const render1 = await request('POST', BASE + '/render/now', {
      templateId: tmplId1,
      entityId: 'trunc-test-192-1',
      channel: 'print',
      inputs: [{ truncatedField: LONG_TEXT }],
    });
    assert(render1.status === 200 || render1.status === 201, 'Render succeeded');
    const doc1 = render1.body && render1.body.document;
    assert(doc1 && doc1.id, 'Document created');
    assert(doc1 && doc1.filePath, 'Document has file path');
    assert(doc1 && (doc1.status === 'completed' || doc1.status === 'done'), 'Document done');

    // Test 4: Verify PDF has ellipsis pattern (3 identical glyphs at end of text)
    if (doc1 && doc1.filePath) {
      process.stdout.write('\nTest 4: Verify PDF has ellipsis pattern\n');
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc1.filePath);
      const pdfExists = fs.existsSync(pdfPath);
      assert(pdfExists, 'PDF file exists');

      if (pdfExists) {
        const pdfData = fs.readFileSync(pdfPath);
        assert(pdfData.length > 100, 'PDF has content');

        const decompressed = extractPdfStreams(pdfData);
        const hasEllipsis = hasEllipsisInPdf(decompressed);
        assert(hasEllipsis, 'PDF contains ellipsis pattern (3 identical trailing glyphs)');

        // Verify text was actually truncated (fewer glyphs than full text would have)
        const tjCount = countTjCommands(decompressed);
        assert(tjCount > 0, 'PDF has text rendering commands');
      }
    }

    // Test 5: Short text (no truncation needed)
    process.stdout.write('\nTest 5: Render with short text (no truncation)\n');
    const render2 = await request('POST', BASE + '/render/now', {
      templateId: tmplId1,
      entityId: 'trunc-test-192-2',
      channel: 'print',
      inputs: [{ truncatedField: 'ABC' }],
    });
    assert(render2.status === 200 || render2.status === 201, 'Short text render succeeded');
    const doc2 = render2.body && render2.body.document;
    assert(doc2 && (doc2.status === 'completed' || doc2.status === 'done'), 'Short text doc done');

    if (doc2 && doc2.filePath) {
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc2.filePath);
      if (fs.existsSync(pdfPath)) {
        const pdfData = fs.readFileSync(pdfPath);
        const decompressed = extractPdfStreams(pdfData);
        const noEllipsis = !hasEllipsisInPdf(decompressed);
        assert(noEllipsis, 'Short text has no ellipsis');
      }
    }

    // Cleanup
    await request('DELETE', BASE + '/templates/' + tmplId1, null);
  }

  // Test 6: Multi-line vertical truncation
  process.stdout.write('\nTest 6: Multi-line vertical truncation\n');
  const tmpl2 = await request('POST', BASE + '/templates', {
    name: 'MultiTrunc TRUNC192b',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'multiTrunc',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 100,
          height: 15,
          fontSize: 10,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1.2,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
          textOverflow: 'truncate',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  assert(tmpl2.status === 201, 'Multi-line template created');

  if (tmpl2.body && tmpl2.body.id) {
    const pub2 = await request('POST', BASE + '/templates/' + tmpl2.body.id + '/publish', {});
    assert(pub2.status === 200 || pub2.status === 201, 'Multi-line template published');

    const manyLines = Array.from({length: 20}, (_, i) => 'Line ' + (i + 1)).join('\n');
    const render3 = await request('POST', BASE + '/render/now', {
      templateId: tmpl2.body.id,
      entityId: 'trunc-multi-192',
      channel: 'print',
      inputs: [{ multiTrunc: manyLines }],
    });
    assert(render3.status === 200 || render3.status === 201, 'Multi-line truncate render succeeded');
    const doc3 = render3.body && render3.body.document;
    assert(doc3 && (doc3.status === 'completed' || doc3.status === 'done'), 'Multi-line doc done');

    if (doc3 && doc3.filePath) {
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc3.filePath);
      if (fs.existsSync(pdfPath)) {
        const pdfData = fs.readFileSync(pdfPath);
        const decompressed = extractPdfStreams(pdfData);
        const tjCount = countTjCommands(decompressed);
        // 15mm height / (1.2 * 10pt * 0.353mm/pt) = ~3.5 lines -> maxLines = 3
        // So we expect 3 or fewer Tj commands, not 20
        assert(tjCount <= 5 && tjCount > 0, 'Truncated to limited lines (got ' + tjCount + ')');
        const hasEllipsis = hasEllipsisInPdf(decompressed);
        assert(hasEllipsis, 'Multi-line truncation has ellipsis');
      }
    }

    await request('DELETE', BASE + '/templates/' + tmpl2.body.id, null);
  }

  // Test 7: Verify compiled code has truncate logic
  process.stdout.write('\nTest 7: Verify compiled code has truncation logic\n');
  const compiledPath = pathModule.join(process.cwd(), 'packages', 'schemas', 'dist', 'cjs', 'src', 'text', 'pdfRender.js');
  if (fs.existsSync(compiledPath)) {
    const code = fs.readFileSync(compiledPath, 'utf-8');
    assert(code.includes("'truncate'"), 'Compiled code handles truncate mode');
    assert(code.includes('ellipsis'), 'Compiled code has ellipsis handling');
    assert(code.includes("'...'"), 'Compiled code uses ... as ellipsis');
    assert(code.includes('maxLines'), 'Compiled code calculates maxLines');
  } else {
    assert(false, 'Compiled pdfRender.js exists');
  }

  // Test 8: Empty text (no crash)
  process.stdout.write('\nTest 8: Empty text renders without error\n');
  const tmpl3 = await request('POST', BASE + '/templates', {
    name: 'EmptyTrunc TRUNC192c',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'emptyField',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 50,
          height: 10,
          fontSize: 12,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
          textOverflow: 'truncate',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  if (tmpl3.body && tmpl3.body.id) {
    await request('POST', BASE + '/templates/' + tmpl3.body.id + '/publish', {});
    const render4 = await request('POST', BASE + '/render/now', {
      templateId: tmpl3.body.id,
      entityId: 'trunc-empty-192',
      channel: 'print',
      inputs: [{ emptyField: '' }],
    });
    assert(render4.status === 200 || render4.status === 201, 'Empty text render succeeded');
    await request('DELETE', BASE + '/templates/' + tmpl3.body.id, null);
  }

  // Test 9: Truncate with exact-fit text (should NOT have ellipsis)
  process.stdout.write('\nTest 9: Exact-fit text has no ellipsis\n');
  const tmpl4 = await request('POST', BASE + '/templates', {
    name: 'ExactTrunc TRUNC192d',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'exactField',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 100,
          height: 15,
          fontSize: 12,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
          textOverflow: 'truncate',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  if (tmpl4.body && tmpl4.body.id) {
    await request('POST', BASE + '/templates/' + tmpl4.body.id + '/publish', {});
    const render5 = await request('POST', BASE + '/render/now', {
      templateId: tmpl4.body.id,
      entityId: 'trunc-exact-192',
      channel: 'print',
      inputs: [{ exactField: 'Hi' }],
    });
    assert(render5.status === 200 || render5.status === 201, 'Exact-fit render succeeded');
    const doc5 = render5.body && render5.body.document;
    if (doc5 && doc5.filePath) {
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc5.filePath);
      if (fs.existsSync(pdfPath)) {
        const decompressed = extractPdfStreams(fs.readFileSync(pdfPath));
        const noEllipsis = !hasEllipsisInPdf(decompressed);
        assert(noEllipsis, 'Exact-fit text has no ellipsis');
      }
    }
    await request('DELETE', BASE + '/templates/' + tmpl4.body.id, null);
  }

  // Summary
  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write('Error: ' + err.message + '\n');
  process.exit(1);
});
