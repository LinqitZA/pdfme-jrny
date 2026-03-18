/**
 * Unit tests for Rich Text HTML parser and field binding resolver.
 * Feature #127: Rich text renders HTML subset
 */

const { parseRichTextHtml, resolveFieldBindings, parseColor, extractRichTextFromTemplate } = require('../packages/erp-schemas/src/rich-text/index');

let pass = 0;
let fail = 0;
let total = 0;

function check(desc, expected, actual) {
  total++;
  const exp = JSON.stringify(expected);
  const act = JSON.stringify(actual);
  if (exp === act) {
    pass++;
    console.log(`  ✅ ${desc}`);
  } else {
    fail++;
    console.log(`  ❌ ${desc}`);
    console.log(`     expected: ${exp}`);
    console.log(`     actual:   ${act}`);
  }
}

function checkTrue(desc, value) {
  total++;
  if (value) {
    pass++;
    console.log(`  ✅ ${desc}`);
  } else {
    fail++;
    console.log(`  ❌ ${desc} (got false)`);
  }
}

console.log('=== Rich Text Unit Tests ===\n');

// --- parseColor ---
console.log('--- parseColor ---');
check('Parse #000000', { r: 0, g: 0, b: 0 }, parseColor('#000000'));
check('Parse #ffffff', { r: 1, g: 1, b: 1 }, parseColor('#ffffff'));
check('Parse #ff0000', { r: 1, g: 0, b: 0 }, parseColor('#ff0000'));
check('Parse #RGB shorthand', { r: 1, g: 0, b: 0 }, parseColor('#f00'));
check('Parse rgb(255,0,0)', { r: 1, g: 0, b: 0 }, parseColor('rgb(255, 0, 0)'));
check('Parse named color red', { r: 1, g: 0, b: 0 }, parseColor('red'));
check('Parse named color blue', { r: 0, g: 0, b: 1 }, parseColor('blue'));
check('Parse empty string', { r: 0, g: 0, b: 0 }, parseColor(''));

// --- resolveFieldBindings ---
console.log('\n--- resolveFieldBindings ---');
check('Simple binding', 'Hello World', resolveFieldBindings('Hello {{name}}', { name: 'World' }));
check('Multiple bindings', 'John is 30', resolveFieldBindings('{{name}} is {{age}}', { name: 'John', age: '30' }));
check('Dot notation binding', 'Acme Corp', resolveFieldBindings('{{customer.name}}', { 'customer.name': 'Acme Corp' }));
check('Missing binding returns empty', 'Hello ', resolveFieldBindings('Hello {{missing}}', {}));
check('No bindings passthrough', 'Plain text', resolveFieldBindings('Plain text', {}));
check('Empty html returns empty', '', resolveFieldBindings('', {}));

// --- parseRichTextHtml ---
console.log('\n--- parseRichTextHtml: bold ---');
{
  const segs = parseRichTextHtml('<b>Bold text</b>');
  checkTrue('Bold segment found', segs.length >= 1);
  checkTrue('Bold flag is true', segs[0].bold === true);
  check('Bold text content', 'Bold text', segs[0].text);
}

console.log('\n--- parseRichTextHtml: italic ---');
{
  const segs = parseRichTextHtml('<i>Italic text</i>');
  checkTrue('Italic segment found', segs.length >= 1);
  checkTrue('Italic flag is true', segs[0].italic === true);
  check('Italic text content', 'Italic text', segs[0].text);
}

console.log('\n--- parseRichTextHtml: underline ---');
{
  const segs = parseRichTextHtml('<u>Underlined</u>');
  checkTrue('Underline segment found', segs.length >= 1);
  checkTrue('Underline flag is true', segs[0].underline === true);
  check('Underline text content', 'Underlined', segs[0].text);
}

console.log('\n--- parseRichTextHtml: <strong> and <em> ---');
{
  const segs = parseRichTextHtml('<strong>Bold</strong> and <em>italic</em>');
  checkTrue('Has multiple segments', segs.length >= 3);
  checkTrue('Strong maps to bold', segs[0].bold === true);
  const emSeg = segs.find(s => s.italic);
  checkTrue('Em maps to italic', emSeg !== undefined);
}

console.log('\n--- parseRichTextHtml: line breaks ---');
{
  const segs = parseRichTextHtml('Line 1<br/>Line 2');
  const brSegIndex = segs.findIndex(s => s.lineBreakAfter);
  checkTrue('Line break segment found', brSegIndex >= 0);
  checkTrue('Has text after break', segs.length > brSegIndex + 1);
}

console.log('\n--- parseRichTextHtml: styled span ---');
{
  const segs = parseRichTextHtml('<span style="font-size: 18px; color: #ff0000; font-weight: bold">Large red bold</span>');
  checkTrue('Span segment found', segs.length >= 1);
  const seg = segs[0];
  checkTrue('Font size from span', seg.fontSize > 0);
  check('Color is red', { r: 1, g: 0, b: 0 }, seg.color);
  checkTrue('Bold from span style', seg.bold === true);
}

console.log('\n--- parseRichTextHtml: nested tags ---');
{
  const segs = parseRichTextHtml('<b><i>Bold and italic</i></b>');
  checkTrue('Nested segment found', segs.length >= 1);
  const seg = segs[0];
  checkTrue('Is bold', seg.bold === true);
  checkTrue('Is italic', seg.italic === true);
  check('Content correct', 'Bold and italic', seg.text);
}

console.log('\n--- parseRichTextHtml: paragraphs ---');
{
  const segs = parseRichTextHtml('<p>First para</p><p>Second para</p>');
  const lineBreaks = segs.filter(s => s.lineBreakAfter);
  checkTrue('Paragraphs produce line breaks', lineBreaks.length >= 2);
}

console.log('\n--- parseRichTextHtml: plain text ---');
{
  const segs = parseRichTextHtml('Just plain text');
  checkTrue('Single segment', segs.length === 1);
  check('Content preserved', 'Just plain text', segs[0].text);
  checkTrue('Not bold', segs[0].bold === false);
  checkTrue('Not italic', segs[0].italic === false);
  checkTrue('Not underline', segs[0].underline === false);
}

console.log('\n--- parseRichTextHtml: HTML entities ---');
{
  const segs = parseRichTextHtml('A &amp; B &lt; C');
  const fullText = segs.map(s => s.text).join('');
  check('Entities decoded', 'A & B < C', fullText);
}

console.log('\n--- parseRichTextHtml: mixed content ---');
{
  const segs = parseRichTextHtml('Normal <b>bold</b> <i>italic</i> <u>underline</u> end');
  const boldSegs = segs.filter(s => s.bold);
  const italicSegs = segs.filter(s => s.italic);
  const underlineSegs = segs.filter(s => s.underline);
  const normalSegs = segs.filter(s => !s.bold && !s.italic && !s.underline);
  checkTrue('Has bold segments', boldSegs.length > 0);
  checkTrue('Has italic segments', italicSegs.length > 0);
  checkTrue('Has underline segments', underlineSegs.length > 0);
  checkTrue('Has normal segments', normalSegs.length > 0);
}

// --- extractRichTextFromTemplate ---
console.log('\n--- extractRichTextFromTemplate ---');
{
  const schemas = [[
    { name: 'title', type: 'text', position: { x: 10, y: 10 }, width: 100, height: 20 },
    { name: 'body', type: 'richText', position: { x: 10, y: 40 }, width: 190, height: 80, fontSize: 14 },
  ]];
  const inputs = [{ title: 'Test', body: '<b>Bold</b> normal' }];
  const result = extractRichTextFromTemplate(schemas, inputs);

  checkTrue('Rich text info extracted', result.richTextInfo.length === 1);
  checkTrue('Schema cleaned (richText removed)', result.cleanedSchemas[0].length === 1);
  check('Remaining element is text', 'text', result.cleanedSchemas[0][0].type);
  checkTrue('Segments parsed', result.richTextInfo[0].segments.length >= 2);
  check('Page index correct', 0, result.richTextInfo[0].pageIndex);
  check('Position preserved', { x: 10, y: 40 }, result.richTextInfo[0].position);
}

// --- Field bindings within rich text ---
console.log('\n--- Field bindings in extractRichTextFromTemplate ---');
{
  const schemas = [[
    { name: 'rt', type: 'richText', position: { x: 0, y: 0 }, width: 100, height: 50 },
  ]];
  const inputs = [{ rt: '<b>{{customer}}</b> owes {{amount}}', customer: 'Acme', amount: 'R500' }];
  const result = extractRichTextFromTemplate(schemas, inputs);
  const segments = result.richTextInfo[0].segments;
  const allText = segments.map(s => s.text).join('');
  checkTrue('Field bindings resolved: customer', allText.includes('Acme'));
  checkTrue('Field bindings resolved: amount', allText.includes('R500'));
  checkTrue('Bold preserved after binding', segments.some(s => s.bold && s.text.includes('Acme')));
}

console.log(`\n===================================`);
console.log(`Results: ${pass}/${total} passed, ${fail} failed`);
console.log(`===================================`);

process.exit(fail > 0 ? 1 : 0);
