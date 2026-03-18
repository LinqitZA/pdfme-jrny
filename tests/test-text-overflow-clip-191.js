/**
 * Test script for Feature #191: Text overflow clip strategy
 *
 * Verifies that text elements with textOverflow='clip' (default) properly
 * clip text at the element boundary in rendered PDFs.
 */
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const pathModule = require('path');

const BASE = 'http://localhost:3000/api/pdfme';
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
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + JWT,
        'Content-Type': 'application/json',
      },
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

/**
 * Extract and decompress all FlateDecode streams from a PDF buffer.
 * Returns concatenated decompressed content as a string.
 */
function extractPdfStreams(pdfBuffer) {
  const pdfStr = pdfBuffer.toString('latin1');
  let result = '';
  let searchFrom = 0;

  while (true) {
    const streamStart = pdfStr.indexOf('stream\r\n', searchFrom);
    const streamStart2 = pdfStr.indexOf('stream\n', searchFrom);
    let actualStart = -1;
    let offset = 0;

    if (streamStart >= 0 && (streamStart2 < 0 || streamStart < streamStart2)) {
      actualStart = streamStart;
      offset = 8; // 'stream\r\n'
    } else if (streamStart2 >= 0) {
      actualStart = streamStart2;
      offset = 7; // 'stream\n'
    }

    if (actualStart < 0) break;

    const dataStart = actualStart + offset;
    const endStream = pdfStr.indexOf('endstream', dataStart);
    if (endStream < 0) break;

    const compressedData = pdfBuffer.slice(dataStart, endStream);
    try {
      const decompressed = zlib.inflateSync(compressedData);
      result += decompressed.toString('latin1');
    } catch {
      // Not all streams are FlateDecode, skip
    }

    searchFrom = endStream + 9;
  }

  return result;
}

async function run() {
  process.stdout.write('=== Feature #191: Text overflow clip strategy ===\n\n');

  const LONG_TEXT = 'This is a very long text that should exceed the boundary of the element and be clipped. '.repeat(10);
  const SHORT_TEXT = 'Short text';

  // Test 1: Create template with explicit textOverflow='clip'
  process.stdout.write('Test 1: Create template with textOverflow=clip\n');
  const tmpl1 = await request('POST', BASE + '/templates', {
    name: 'Clip Overflow Test CLIP191',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'clippedField',
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
          textOverflow: 'clip',
        },
        {
          name: 'normalField',
          type: 'text',
          position: { x: 10, y: 30 },
          width: 100,
          height: 8,
          fontSize: 10,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
        },
      ]],
      columns: [],
      sampledata: [{}],
    },
  });
  assert(tmpl1.status === 201, 'Template with clip created (status 201)');
  assert(tmpl1.body && tmpl1.body.id, 'Template has ID');
  const tmplId1 = tmpl1.body ? tmpl1.body.id : null;

  if (tmplId1) {
    // Test 2: Publish
    process.stdout.write('\nTest 2: Publish template\n');
    const pub1 = await request('POST', BASE + '/templates/' + tmplId1 + '/publish', {});
    assert(pub1.status === 200 || pub1.status === 201, 'Template published');

    // Test 3: Render with long text (clip overflow)
    process.stdout.write('\nTest 3: Render with long text exceeding bounds\n');
    const render1 = await request('POST', BASE + '/render/now', {
      templateId: tmplId1,
      entityId: 'clip-test-191-1',
      channel: 'print',
      inputs: [{ clippedField: LONG_TEXT, normalField: SHORT_TEXT }],
    });
    assert(render1.status === 200 || render1.status === 201, 'Render succeeded with long text');
    const doc1 = render1.body && render1.body.document;
    assert(doc1 && doc1.id, 'Document created with ID');
    assert(doc1 && doc1.filePath, 'Document has file path');
    assert(doc1 && (doc1.status === 'completed' || doc1.status === 'done'), 'Document status is done');

    // Test 4: Verify PDF has clipping operators
    if (doc1 && doc1.filePath) {
      process.stdout.write('\nTest 4: Verify PDF has clipping operators\n');
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc1.filePath);
      const pdfExists = fs.existsSync(pdfPath);
      assert(pdfExists, 'PDF file exists on disk');

      if (pdfExists) {
        const pdfData = fs.readFileSync(pdfPath);
        assert(pdfData.length > 100, 'PDF file has content');
        assert(pdfData.toString('latin1').includes('%PDF'), 'Valid PDF header');

        // Decompress PDF streams and check for clipping operators
        const decompressed = extractPdfStreams(pdfData);
        const hasClipOp = decompressed.includes(' W ') || decompressed.includes(' W\n') || decompressed.includes('\nW\n') || decompressed.includes('\nW ');
        assert(hasClipOp, 'PDF contains clip operator (W) in decompressed streams');

        const hasRectOp = decompressed.includes(' re ') || decompressed.includes(' re\n') || decompressed.includes('\nre\n');
        assert(hasRectOp, 'PDF contains rectangle operator (re) for clip boundary');

        const hasGStateSave = decompressed.includes(' q ') || decompressed.includes(' q\n') || decompressed.includes('\nq\n') || decompressed.includes('\nq ');
        assert(hasGStateSave, 'PDF contains graphics state save (q) for clipping');

        const hasGStateRestore = decompressed.includes(' Q ') || decompressed.includes(' Q\n') || decompressed.includes('\nQ\n') || decompressed.includes('\nQ ');
        assert(hasGStateRestore, 'PDF contains graphics state restore (Q) after clipping');
      }
    }

    // Test 5: Render with short text (no overflow needed but clip still applied)
    process.stdout.write('\nTest 5: Render with short text\n');
    const render2 = await request('POST', BASE + '/render/now', {
      templateId: tmplId1,
      entityId: 'clip-test-191-2',
      channel: 'print',
      inputs: [{ clippedField: SHORT_TEXT, normalField: SHORT_TEXT }],
    });
    assert(render2.status === 200 || render2.status === 201, 'Render succeeded with short text');
    const doc2 = render2.body && render2.body.document;
    assert(doc2 && (doc2.status === 'completed' || doc2.status === 'done'), 'Short text document done');

    // Cleanup
    await request('DELETE', BASE + '/templates/' + tmplId1, null);
  }

  // Test 6: Default textOverflow (omitted) renders as clip
  process.stdout.write('\nTest 6: Default textOverflow renders as clip\n');
  const tmpl2 = await request('POST', BASE + '/templates', {
    name: 'Default Overflow CLIP191b',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'defaultOverflow',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 40,
          height: 8,
          fontSize: 12,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  assert(tmpl2.status === 201, 'Template without explicit textOverflow created');

  if (tmpl2.body && tmpl2.body.id) {
    const pub2 = await request('POST', BASE + '/templates/' + tmpl2.body.id + '/publish', {});
    assert(pub2.status === 200 || pub2.status === 201, 'Default template published');

    const render3 = await request('POST', BASE + '/render/now', {
      templateId: tmpl2.body.id,
      entityId: 'clip-default-191',
      channel: 'print',
      inputs: [{ defaultOverflow: LONG_TEXT }],
    });
    assert(render3.status === 200 || render3.status === 201, 'Default overflow render succeeded');
    const doc3 = render3.body && render3.body.document;
    assert(doc3 && (doc3.status === 'completed' || doc3.status === 'done'), 'Default overflow doc done');

    if (doc3 && doc3.filePath) {
      const pdfPath = pathModule.join(process.cwd(), 'storage', doc3.filePath);
      if (fs.existsSync(pdfPath)) {
        const pdfData = fs.readFileSync(pdfPath);
        const decompressed = extractPdfStreams(pdfData);
        const hasClipOp = decompressed.includes(' W ') || decompressed.includes(' W\n') || decompressed.includes('\nW\n') || decompressed.includes('\nW ');
        assert(hasClipOp, 'Default overflow PDF has clip operator');
      } else {
        assert(false, 'Default overflow PDF file exists');
      }
    }

    await request('DELETE', BASE + '/templates/' + tmpl2.body.id, null);
  }

  // Test 7: Multi-line text overflow clipped
  process.stdout.write('\nTest 7: Multi-line text overflow clipped\n');
  const tmpl3 = await request('POST', BASE + '/templates', {
    name: 'Multiline Clip CLIP191c',
    type: 'invoice',
    schema: {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[
        {
          name: 'multiLineClip',
          type: 'text',
          position: { x: 10, y: 10 },
          width: 80,
          height: 12,
          fontSize: 10,
          alignment: 'left',
          verticalAlignment: 'top',
          lineHeight: 1.2,
          characterSpacing: 0,
          fontColor: '#000000',
          backgroundColor: '',
          textOverflow: 'clip',
        },
      ]],
      columns: [], sampledata: [{}],
    },
  });
  assert(tmpl3.status === 201, 'Multi-line clip template created');

  if (tmpl3.body && tmpl3.body.id) {
    await request('POST', BASE + '/templates/' + tmpl3.body.id + '/publish', {});
    const multiLineText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6 exceeding boundary';
    const render4 = await request('POST', BASE + '/render/now', {
      templateId: tmpl3.body.id,
      entityId: 'clip-multiline-191',
      channel: 'print',
      inputs: [{ multiLineClip: multiLineText }],
    });
    assert(render4.status === 200 || render4.status === 201, 'Multi-line clip render succeeded');
    const doc4 = render4.body && render4.body.document;
    assert(doc4 && (doc4.status === 'completed' || doc4.status === 'done'), 'Multi-line clip doc done');

    await request('DELETE', BASE + '/templates/' + tmpl3.body.id, null);
  }

  // Test 8: Verify code has clipping logic
  process.stdout.write('\nTest 8: Verify compiled code has clipping logic\n');
  const compiledPath = pathModule.join(process.cwd(), 'packages', 'schemas', 'dist', 'cjs', 'src', 'text', 'pdfRender.js');
  if (fs.existsSync(compiledPath)) {
    const code = fs.readFileSync(compiledPath, 'utf-8');
    assert(code.includes('useClipping'), 'Compiled code has useClipping variable');
    assert(code.includes('pushGraphicsState'), 'Compiled code calls pushGraphicsState');
    assert(code.includes('popGraphicsState'), 'Compiled code calls popGraphicsState');
    assert(code.includes("textOverflow || 'clip'"), 'Default textOverflow is clip');
  } else {
    assert(false, 'Compiled pdfRender.js exists');
  }

  // Summary
  process.stdout.write('\n=== Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  process.stdout.write('Error: ' + err.message + '\n');
  process.exit(1);
});
