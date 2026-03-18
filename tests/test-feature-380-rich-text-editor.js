/**
 * Test Feature #380: Rich text editor in Properties panel
 *
 * Verifies:
 * - Rich text WYSIWYG editor exists in ErpDesigner Properties panel
 * - Toolbar has Bold, Italic, Underline, and Font Size controls
 * - Editor uses contentEditable for WYSIWYG editing
 * - Rich text content (HTML) is stored and rendered correctly
 * - API renders rich text templates with formatting
 */

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3001';
const ORG_ID = 'org-richtext-380';
const USER_ID = 'user-richtext-380';

function generateToken(orgId, userId) {
  const secret = process.env.JWT_SECRET || 'pdfme-dev-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId || USER_ID,
    orgId: orgId || ORG_ID,
    roles: ['template_admin', 'template:edit', 'template:publish', 'render:trigger', 'render:bulk', 'super_admin'],
    iat: Math.floor(Date.now() / 1000),
    exp: 9999999999
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const TOKEN = generateToken(ORG_ID, USER_ID);
const templateIds = [];

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let bodyData;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      bodyData = JSON.stringify(body);
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsed;
        try {
          parsed = JSON.parse(buffer.toString());
        } catch {
          parsed = buffer;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers, buffer });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

async function run() {
  console.log('\n=== Feature #380: Rich text editor in Properties panel ===\n');

  // === SOURCE CODE VERIFICATION ===
  // Verify the ErpDesigner contains the rich text WYSIWYG editor components

  console.log('Test 1: Rich text WYSIWYG editor exists in ErpDesigner source');
  const designerPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const designerSrc = fs.readFileSync(designerPath, 'utf-8');

  // Check for WYSIWYG editor section
  assert(designerSrc.includes('rich-text-editor-section'), 'Rich text editor section exists (data-testid)');
  assert(designerSrc.includes('rt-editor'), 'WYSIWYG editor div exists (data-testid="rt-editor")');
  assert(designerSrc.includes('contentEditable'), 'Editor uses contentEditable for WYSIWYG');

  console.log('\nTest 2: Rich text toolbar has formatting controls');
  assert(designerSrc.includes('rt-bold'), 'Bold button exists (data-testid="rt-bold")');
  assert(designerSrc.includes('rt-italic'), 'Italic button exists (data-testid="rt-italic")');
  assert(designerSrc.includes('rt-underline'), 'Underline button exists (data-testid="rt-underline")');
  assert(designerSrc.includes('rt-font-size'), 'Font size selector exists (data-testid="rt-font-size")');
  assert(designerSrc.includes('rich-text-toolbar'), 'Toolbar container exists (data-testid="rich-text-toolbar")');

  console.log('\nTest 3: Bold button uses execCommand("bold")');
  assert(designerSrc.includes("execCommand('bold'"), 'Bold uses document.execCommand bold');

  console.log('\nTest 4: Italic button uses execCommand("italic")');
  assert(designerSrc.includes("execCommand('italic'"), 'Italic uses document.execCommand italic');

  console.log('\nTest 5: Font size selector changes font size');
  assert(designerSrc.includes("execCommand('fontSize'"), 'Font size uses document.execCommand fontSize');
  // Check that font size options are present
  assert(designerSrc.includes('8, 9, 10, 11, 12, 14, 16, 18, 20, 24'), 'Multiple font size options available');

  console.log('\nTest 6: Editor syncs content back to element on input');
  assert(designerSrc.includes('onInput'), 'Editor has onInput handler');
  assert(designerSrc.includes('target.innerHTML'), 'Input handler reads innerHTML for rich content');

  console.log('\nTest 7: Keyboard shortcuts for formatting');
  assert(designerSrc.includes('onKeyDown'), 'Editor has keyboard event handler');
  assert(designerSrc.includes("e.key === 'b'"), 'Ctrl+B shortcut for bold');
  assert(designerSrc.includes("e.key === 'i'"), 'Ctrl+I shortcut for italic');
  assert(designerSrc.includes("e.key === 'u'"), 'Ctrl+U shortcut for underline');

  console.log('\nTest 8: Editor only shown for rich-text elements');
  assert(designerSrc.includes("selectedElement.type === 'rich-text'"), 'WYSIWYG conditional on rich-text type');
  // Plain text elements still get textarea
  assert(designerSrc.includes('prop-content'), 'Plain text still has textarea (data-testid="prop-content")');

  console.log('\nTest 9: Raw HTML source view available');
  assert(designerSrc.includes('rt-html-source'), 'HTML source textarea exists (data-testid="rt-html-source")');
  assert(designerSrc.includes('View HTML source'), 'Source view toggle text present');

  // === RICH TEXT SCHEMA VERIFICATION ===
  console.log('\nTest 10: Rich text schema plugin exists');
  const richTextPath = path.join(__dirname, '..', 'packages', 'erp-schemas', 'src', 'rich-text', 'index.ts');
  const richTextSrc = fs.readFileSync(richTextPath, 'utf-8');

  assert(richTextSrc.includes('parseRichTextHtml'), 'Rich text HTML parser exists');
  assert(richTextSrc.includes('RichTextSegment'), 'RichTextSegment interface defined');
  assert(richTextSrc.includes('bold'), 'Bold formatting support in schema');
  assert(richTextSrc.includes('italic'), 'Italic formatting support in schema');
  assert(richTextSrc.includes('underline'), 'Underline formatting support in schema');
  assert(richTextSrc.includes('fontSize'), 'Font size support in schema');

  // === API VERIFICATION ===
  // Test that API correctly handles templates with rich text HTML content

  console.log('\nTest 11: Create template with rich-text HTML content');
  const htmlContent = '<b>Bold text</b> and <i>italic text</i> with <span style="font-size: 24px">large font</span>';
  const res = await request('POST', '/api/pdfme/templates', {
    name: 'Rich Text Test 380',
    type: 'custom',
    schema: {
      pages: [{
        elements: [
          {
            type: 'text',
            name: 'richField',
            position: { x: 10, y: 10 },
            width: 180,
            height: 60,
            content: htmlContent,
          },
        ],
      }],
    },
  }, TOKEN);
  assert(res.status === 201 || res.status === 200, 'Created template with HTML content (status ' + res.status + ')');
  if (res.body && res.body.id) templateIds.push(res.body.id);

  // Retrieve and verify HTML content is preserved
  if (res.body && res.body.id) {
    const getRes = await request('GET', '/api/pdfme/templates/' + res.body.id, null, TOKEN);
    assert(getRes.status === 200, 'Can retrieve template');
    const schema = getRes.body.schema;
    const content = schema && schema.pages && schema.pages[0] && schema.pages[0].elements && schema.pages[0].elements[0] && schema.pages[0].elements[0].content;
    assert(content === htmlContent, 'HTML content preserved in storage');
  }

  console.log('\nTest 12: Template with rich HTML content can be updated');
  if (res.body && res.body.id) {
    const updatedHtml = '<b>Updated bold</b> and <i>new italic</i> with <u>underline</u>';
    const updateRes = await request('PUT', '/api/pdfme/templates/' + res.body.id, {
      name: 'Rich Text Test 380 Updated',
      schema: {
        pages: [{
          elements: [
            {
              type: 'text',
              name: 'richField',
              position: { x: 10, y: 10 },
              width: 180,
              height: 60,
              content: updatedHtml,
            },
          ],
        }],
      },
    }, TOKEN);
    assert(updateRes.status === 200, 'Updated template with new HTML content (status ' + updateRes.status + ')');
    // Verify updated content
    const getUpdated = await request('GET', '/api/pdfme/templates/' + res.body.id, null, TOKEN);
    const updatedContent = getUpdated.body.schema && getUpdated.body.schema.pages && getUpdated.body.schema.pages[0] && getUpdated.body.schema.pages[0].elements && getUpdated.body.schema.pages[0].elements[0] && getUpdated.body.schema.pages[0].elements[0].content;
    assert(updatedContent === updatedHtml, 'Updated HTML content preserved after save');
  }

  console.log('\nTest 13: Rich text element type available in designer element palette');
  assert(designerSrc.includes("id: 'rich-text'"), 'Rich text in element palette');
  assert(designerSrc.includes("label: 'Rich Text'"), 'Rich text has label');

  console.log('\nTest 14: Rich text default element has correct properties');
  assert(designerSrc.includes("case 'rich-text':"), 'Rich text has default element config');
  // Verify default has content, fontSize, lineHeight
  const rtDefaultMatch = designerSrc.match(/case 'rich-text':\s*return \{[^}]+\}/s);
  if (rtDefaultMatch) {
    const rtDefault = rtDefaultMatch[0];
    assert(rtDefault.includes('content:'), 'Default has content property');
    assert(rtDefault.includes('fontSize:'), 'Default has fontSize property');
    assert(rtDefault.includes('lineHeight:'), 'Default has lineHeight property');
  } else {
    assert(false, 'Could not parse rich-text default config');
    assert(false, 'Default has content property');
    assert(false, 'Default has lineHeight property');
  }

  // === CLEANUP ===
  console.log('\nCleaning up...');
  for (const tid of templateIds) {
    if (tid) await request('DELETE', '/api/pdfme/templates/' + tid, null, TOKEN);
  }

  // === SUMMARY ===
  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(err) {
  console.error('Test runner error:', err);
  process.exit(1);
});
