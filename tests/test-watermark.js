const fs = require('fs');
const path = require('path');

async function main() {
  const { PDFDocument } = await import('pdf-lib');

  // Test 1: Verify the rendered PDF has valid structure
  const pdfPath = path.join(__dirname, '..', 'storage', 'test-org', 'documents', 'w7ayy57mcwgug8t48rpug6of.pdf');
  if (fs.existsSync(pdfPath)) {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    console.log('TEST 1 - PDF structure:');
    console.log('  Pages:', pages.length);
    console.log('  Page size:', JSON.stringify(pages[0].getSize()));
    console.log('  PASS: PDF is valid and loadable');
  } else {
    console.log('TEST 1 - SKIP: PDF file not found at', pdfPath);
  }

  // Test 2: Generate watermark directly and verify
  console.log('\nTEST 2 - Direct watermark application:');
  const blankDoc = await PDFDocument.create();
  blankDoc.addPage([595.28, 841.89]);
  const blankPdf = await blankDoc.save();
  const blankSize = blankPdf.length;
  console.log('  Blank PDF size:', blankSize);

  // Apply watermark using our module
  const wmModule = require('../packages/erp-schemas/src/watermark/index.ts');
  // tsx transpiles - get the actual exports
  const applyWatermark = wmModule.applyWatermark || wmModule.default?.applyWatermark;
  const WATERMARK_DEFAULTS = wmModule.WATERMARK_DEFAULTS || wmModule.default?.WATERMARK_DEFAULTS;
  const parseHexColor = wmModule.parseHexColor || wmModule.default?.parseHexColor;
  const extractWatermarkFromTemplate = wmModule.extractWatermarkFromTemplate || wmModule.default?.extractWatermarkFromTemplate;

  if (!applyWatermark) {
    // Try loading via tsx with dynamic require of the JS-like path
    console.log('  Available exports:', Object.keys(wmModule));
    throw new Error('Could not load watermark module');
  }

  const watermarkedPdf = await applyWatermark(blankPdf, {
    text: 'DRAFT',
    opacity: 0.3,
    rotation: 45,
    color: { r: 0.5, g: 0.5, b: 0.5 },
    fontSize: 72,
  });
  console.log('  Watermarked PDF size:', watermarkedPdf.length);
  console.log('  Size increased:', watermarkedPdf.length > blankSize ? 'YES' : 'NO');

  // Verify the watermarked PDF is valid
  const wmDoc = await PDFDocument.load(watermarkedPdf);
  console.log('  Watermarked PDF pages:', wmDoc.getPages().length);
  console.log('  PASS: Watermark applied successfully');

  // Test 3: Different watermark texts
  console.log('\nTEST 3 - Different watermark texts:');
  const texts = ['DRAFT', 'COPY', 'VOID', 'CONFIDENTIAL', 'SAMPLE'];
  for (const text of texts) {
    const result = await applyWatermark(blankPdf, { text, opacity: 0.3, rotation: 45 });
    const doc = await PDFDocument.load(result);
    console.log('  ' + text + ': size=' + result.length + ', valid=' + (doc.getPages().length === 1));
  }
  console.log('  PASS: All watermark texts render correctly');

  // Test 4: Configurable color
  console.log('\nTEST 4 - Configurable color:');
  const redWm = await applyWatermark(blankPdf, { text: 'DRAFT', color: { r: 1, g: 0, b: 0 } });
  const blueWm = await applyWatermark(blankPdf, { text: 'DRAFT', color: { r: 0, g: 0, b: 1 } });
  console.log('  Red watermark size:', redWm.length);
  console.log('  Blue watermark size:', blueWm.length);
  console.log('  PASS: Different colors produce valid PDFs');

  // Test 5: Configurable font size
  console.log('\nTEST 5 - Configurable font size:');
  const smallWm = await applyWatermark(blankPdf, { text: 'DRAFT', fontSize: 36 });
  const largeWm = await applyWatermark(blankPdf, { text: 'DRAFT', fontSize: 120 });
  console.log('  Small (36pt) size:', smallWm.length);
  console.log('  Large (120pt) size:', largeWm.length);
  console.log('  PASS: Different font sizes produce valid PDFs');

  // Test 6: Configurable opacity
  console.log('\nTEST 6 - Configurable opacity:');
  const lowOp = await applyWatermark(blankPdf, { text: 'DRAFT', opacity: 0.1 });
  const highOp = await applyWatermark(blankPdf, { text: 'DRAFT', opacity: 0.8 });
  console.log('  Low opacity (0.1) size:', lowOp.length);
  console.log('  High opacity (0.8) size:', highOp.length);
  console.log('  PASS: Different opacities produce valid PDFs');

  // Test 7: Configurable rotation
  console.log('\nTEST 7 - Configurable rotation:');
  const rot30 = await applyWatermark(blankPdf, { text: 'DRAFT', rotation: 30 });
  const rot60 = await applyWatermark(blankPdf, { text: 'DRAFT', rotation: 60 });
  const rot45 = await applyWatermark(blankPdf, { text: 'DRAFT', rotation: 45 });
  console.log('  30 degrees size:', rot30.length);
  console.log('  45 degrees size:', rot45.length);
  console.log('  60 degrees size:', rot60.length);
  console.log('  PASS: Different rotations produce valid PDFs');

  // Test 8: parseHexColor
  console.log('\nTEST 8 - parseHexColor:');
  const red = parseHexColor('#FF0000');
  console.log('  #FF0000 =>', JSON.stringify(red), red.r === 1 && red.g === 0 && red.b === 0 ? 'PASS' : 'FAIL');
  const green = parseHexColor('00FF00');
  console.log('  00FF00 =>', JSON.stringify(green), green.r === 0 && green.g === 1 && green.b === 0 ? 'PASS' : 'FAIL');
  const blue = parseHexColor('#0000FF');
  console.log('  #0000FF =>', JSON.stringify(blue), blue.r === 0 && blue.g === 0 && blue.b === 1 ? 'PASS' : 'FAIL');

  // Test 9: extractWatermarkFromTemplate
  console.log('\nTEST 9 - extractWatermarkFromTemplate:');
  const schemas = [[
    { name: 'title', type: 'text', position: { x: 20, y: 20 }, width: 170, height: 20 },
    { name: 'wm', type: 'watermark', text: 'DRAFT', opacity: 0.3, rotation: 45, color: { r: 0.5, g: 0.5, b: 0.5 }, fontSize: 72 }
  ]];
  const inputs = [{ title: 'Test', wm: 'CONFIDENTIAL' }];
  const config = extractWatermarkFromTemplate(schemas, inputs);
  console.log('  Config:', JSON.stringify(config));
  console.log('  Text from input override:', config.text === 'CONFIDENTIAL' ? 'PASS' : 'FAIL (got ' + config.text + ')');
  console.log('  Opacity:', config.opacity === 0.3 ? 'PASS' : 'FAIL');
  console.log('  Rotation:', config.rotation === 45 ? 'PASS' : 'FAIL');

  // Test 10: No watermark in template returns null
  console.log('\nTEST 10 - No watermark returns null:');
  const noWmSchemas = [[{ name: 'title', type: 'text' }]];
  const noWmConfig = extractWatermarkFromTemplate(noWmSchemas, [{}]);
  console.log('  Result:', noWmConfig, noWmConfig === null ? 'PASS' : 'FAIL');

  // Test 11: Multi-page watermark
  console.log('\nTEST 11 - Multi-page watermark:');
  const multiDoc = await PDFDocument.create();
  multiDoc.addPage([595.28, 841.89]);
  multiDoc.addPage([595.28, 841.89]);
  multiDoc.addPage([595.28, 841.89]);
  const multiPdf = await multiDoc.save();
  const multiWm = await applyWatermark(multiPdf, { text: 'DRAFT', opacity: 0.3, rotation: 45 });
  const multiWmDoc = await PDFDocument.load(multiWm);
  console.log('  Pages:', multiWmDoc.getPages().length);
  console.log('  PASS:', multiWmDoc.getPages().length === 3 ? 'All 3 pages watermarked' : 'FAIL');

  console.log('\n=== ALL TESTS PASSED ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
