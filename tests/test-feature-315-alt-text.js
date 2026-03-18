/**
 * Test Feature #315: Canvas elements have alt text capability
 * Image elements can have alt text for accessibility
 */

const http = require('http');
const fs = require('fs');
const { makeJwt, API_BASE } = require('./test-helpers');

const ORG_ID = 'test-org-315';
const USER_ID = 'test-user-315';
const TOKEN = makeJwt(USER_ID, ORG_ID);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: () => data, json: () => JSON.parse(data), headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runTests() {
  console.log('=== Feature #315: Canvas elements have alt text capability ===\n');

  const srcPath = 'apps/designer-sandbox/components/ErpDesigner.tsx';
  const src = fs.readFileSync(srcPath, 'utf8');

  // === Section 1: DesignElement interface has altText ===
  console.log('--- DesignElement Interface ---');

  assert(
    src.includes('altText?: string;'),
    'DesignElement interface has altText optional string property'
  );

  assert(
    src.includes('// Accessibility') && src.includes('altText?: string;'),
    'altText property is documented under Accessibility comment'
  );

  // === Section 2: Alt text input in Properties panel ===
  console.log('\n--- Properties Panel Alt Text Input ---');

  assert(
    src.includes('data-testid="prop-alt-text"'),
    'Alt text input has data-testid for testing'
  );

  assert(
    src.includes('aria-label="Alternative text for accessibility"'),
    'Alt text input has accessible label'
  );

  assert(
    src.includes('placeholder="Describe this image for screen readers"'),
    'Alt text input has descriptive placeholder'
  );

  assert(
    src.includes("onChange={(e) => updateElement(selectedElement.id, { altText: e.target.value })"),
    'Alt text changes update the element via updateElement'
  );

  assert(
    src.includes("value={selectedElement.altText || ''}"),
    'Alt text input reads from selectedElement.altText'
  );

  assert(
    src.includes('Alt Text (Accessibility)'),
    'Alt text field has a descriptive label'
  );

  assert(
    src.includes('Used in PDF/UA output for accessibility compliance'),
    'Help text explains the purpose of alt text'
  );

  // === Section 3: Alt text stored in template schema ===
  console.log('\n--- Template Schema Storage ---');

  assert(
    src.includes('altText: el.altText,'),
    'altText is included in template element serialization'
  );

  // Check that the image section renders alt text from the element
  assert(
    src.includes("alt={el.altText || ''}"),
    'Canvas img elements use altText property for alt attribute'
  );

  // Verify altText appears within the image properties section (near objectFit/opacity)
  const imagePropsIndex = src.indexOf('data-testid="prop-object-fit"');
  const altTextIndex = src.indexOf('data-testid="prop-alt-text"');
  assert(
    imagePropsIndex > 0 && altTextIndex > 0 && altTextIndex > imagePropsIndex,
    'Alt text input appears in the image properties section (after object fit)'
  );

  // === Section 4: Alt text only shown for image elements ===
  console.log('\n--- Image-Only Property ---');

  // The alt text field is inside the image properties section
  const imagePropsSection = src.indexOf('properties-image');
  const tablePropsSection = src.indexOf('properties-table');
  assert(
    imagePropsSection > 0 && altTextIndex > imagePropsSection && altTextIndex < tablePropsSection,
    'Alt text input is within the image category properties section (not shown for text/table)'
  );

  // === Section 5: All image-type elements support alt text ===
  console.log('\n--- Image Element Types ---');

  // Verify that all image types go through the same properties section
  assert(
    src.includes("case 'image':") &&
    src.includes("case 'erp-image':") &&
    src.includes("case 'signature':") &&
    src.includes("case 'drawn-signature':") &&
    src.includes("return 'image';"),
    'All image-type elements (image, erp-image, signature, drawn-signature) categorized as image'
  );

  // === Section 6: Backend persistence ===
  console.log('\n--- Backend Persistence ---');

  // The backend stores template schema as JSON blob, so altText is automatically persisted
  // Verify the API endpoint works
  try {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        name: 'Alt Text Test Template 315',
        type: 'invoice',
        schema: {
          pages: [{
            elements: [{
              type: 'image',
              x: 50,
              y: 50,
              w: 150,
              h: 100,
              src: 'logo.png',
              altText: 'Company logo for accessibility',
            }],
          }],
        },
      }),
    });

    assert(res.status === 201 || res.status === 200, 'Template with altText in schema creates successfully (' + res.status + ')');

    const body = res.json();
    const templateId = body.id;

    if (templateId) {
      // Fetch the template back and verify altText is persisted
      const getRes = await fetch(`${API_BASE}/templates/${templateId}`, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
        },
      });

      assert(getRes.status === 200, 'Template retrieved successfully');

      const templateData = getRes.json();
      const schema = templateData.schema;
      const firstElement = schema?.pages?.[0]?.elements?.[0];

      assert(
        firstElement && firstElement.altText === 'Company logo for accessibility',
        'altText persists in template schema after save/retrieve'
      );

      assert(
        firstElement && firstElement.type === 'image',
        'Element type persists correctly alongside altText'
      );

      // Update the altText
      const updateRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          schema: {
            pages: [{
              elements: [{
                type: 'image',
                x: 50,
                y: 50,
                w: 150,
                h: 100,
                src: 'logo.png',
                altText: 'Updated company logo description',
              }],
            }],
          },
        }),
      });

      assert(updateRes.status === 200, 'Template with updated altText saves successfully');

      // Verify updated altText
      const getRes2 = await fetch(`${API_BASE}/templates/${templateId}`, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
        },
      });
      const updatedData = getRes2.json();
      const updatedElement = updatedData.schema?.pages?.[0]?.elements?.[0];

      assert(
        updatedElement && updatedElement.altText === 'Updated company logo description',
        'Updated altText persists after draft save'
      );

      // Test with empty altText
      const emptyAltRes = await fetch(`${API_BASE}/templates/${templateId}/draft`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          schema: {
            pages: [{
              elements: [{
                type: 'image',
                x: 50,
                y: 50,
                w: 150,
                h: 100,
                src: 'logo.png',
                altText: '',
              }],
            }],
          },
        }),
      });

      assert(emptyAltRes.status === 200, 'Template with empty altText saves successfully');
    }
  } catch (e) {
    assert(false, 'API test error: ' + e.message);
  }

  // === Section 7: PDF/UA output considerations ===
  console.log('\n--- PDF/UA Output Compliance ---');

  assert(
    src.includes('PDF/UA'),
    'Component references PDF/UA compliance'
  );

  assert(
    src.includes("alt={el.altText || ''}"),
    'Images render with alt attribute from altText property'
  );

  // The alt attribute on img elements in the canvas provides visual indication
  // that altText is being used. For PDF output, pdfme generator processes the
  // template schema which includes the altText field.
  assert(
    src.includes('altText: el.altText') && src.includes("altText?: string"),
    'altText is both serialized in schema and typed in interface'
  );

  // Summary
  console.log(`\n=== Results: ${passed}/${passed + failed} tests passing ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
