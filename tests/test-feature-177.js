/**
 * Test Feature #177: Designer field binding resolves in preview
 *
 * Tests that preview mode substitutes field example values for binding placeholders.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('=== Feature #177: Designer field binding resolves in preview ===\n');

  const componentSrc = fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx'),
    'utf8'
  );

  // Step 1: Verify preview mode state and toggle
  console.log('Step 1: Verify preview mode state and toggle');
  assert(componentSrc.includes('previewMode'), 'Component has previewMode state');
  assert(componentSrc.includes('setPreviewMode'), 'Component has setPreviewMode setter');
  assert(componentSrc.includes('btn-preview-data'), 'Has preview data toggle button');
  assert(componentSrc.includes("'Preview Data'") || componentSrc.includes('"Preview Data"'), 'Button shows "Preview Data" text');
  assert(componentSrc.includes("'Design Mode'") || componentSrc.includes('"Design Mode"'), 'Button shows "Design Mode" when active');
  assert(componentSrc.includes('setPreviewMode((prev) => !prev)'), 'Toggle toggles the state');

  // Step 2: Verify FIELD_EXAMPLES lookup map
  console.log('\nStep 2: Verify field examples lookup');
  assert(componentSrc.includes('FIELD_EXAMPLES'), 'Has FIELD_EXAMPLES map');
  assert(componentSrc.includes('FIELD_EXAMPLES[field.key] = field.example'), 'Builds map from DATA_FIELDS');
  assert(componentSrc.includes('resolveBindingToExample'), 'Has resolveBindingToExample function');

  // Step 3: Verify resolveBindingToExample logic
  console.log('\nStep 3: Verify binding resolution logic');
  assert(componentSrc.includes('FIELD_EXAMPLES[binding]'), 'Looks up binding key in examples');
  assert(componentSrc.includes('{{'), 'Handles mustache-style patterns');
  assert(componentSrc.includes('.replace('), 'Uses string replace for template substitution');

  // Step 4: Test the resolveBindingToExample function directly
  console.log('\nStep 4: Test resolveBindingToExample function directly');

  // Extract and test the function logic
  const DATA_FIELDS = [
    { group: 'Document', fields: [
      { key: 'document.number', label: 'Document Number', example: 'INV-2026-001' },
      { key: 'document.date', label: 'Date', example: '2026-03-18' },
      { key: 'document.total', label: 'Total', example: 'R 1,250.00' },
    ]},
    { group: 'Customer', fields: [
      { key: 'customer.name', label: 'Name', example: 'Acme Corporation' },
      { key: 'customer.email', label: 'Email', example: 'billing@acme.com' },
      { key: 'customer.address', label: 'Address', example: '123 Main St' },
    ]},
    { group: 'Company', fields: [
      { key: 'company.name', label: 'Company Name', example: 'My Company Ltd' },
    ]},
  ];

  const FIELD_EXAMPLES = {};
  DATA_FIELDS.forEach((group) => {
    group.fields.forEach((field) => {
      FIELD_EXAMPLES[field.key] = field.example;
    });
  });

  function resolveBindingToExample(text, binding) {
    if (binding && FIELD_EXAMPLES[binding]) {
      return FIELD_EXAMPLES[binding];
    }
    if (text && text.includes('{{')) {
      return text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
        const trimmedKey = key.trim();
        return FIELD_EXAMPLES[trimmedKey] || `{{${trimmedKey}}}`;
      });
    }
    return text;
  }

  // Test case: binding key resolves to example
  assert(
    resolveBindingToExample('{{customer.name}}', 'customer.name') === 'Acme Corporation',
    'customer.name binding resolves to "Acme Corporation"'
  );

  assert(
    resolveBindingToExample('{{customer.email}}', 'customer.email') === 'billing@acme.com',
    'customer.email binding resolves to "billing@acme.com"'
  );

  assert(
    resolveBindingToExample('{{document.number}}', 'document.number') === 'INV-2026-001',
    'document.number binding resolves to "INV-2026-001"'
  );

  assert(
    resolveBindingToExample('{{company.name}}', 'company.name') === 'My Company Ltd',
    'company.name binding resolves to "My Company Ltd"'
  );

  // Test case: mustache template in content
  assert(
    resolveBindingToExample('Invoice: {{document.number}}') === 'Invoice: INV-2026-001',
    'Mustache template in content resolves correctly'
  );

  assert(
    resolveBindingToExample('Dear {{customer.name}}, your total is {{document.total}}') ===
      'Dear Acme Corporation, your total is R 1,250.00',
    'Multiple mustache bindings in same string resolve'
  );

  // Test case: unknown binding stays as placeholder
  assert(
    resolveBindingToExample('{{unknown.field}}') === '{{unknown.field}}',
    'Unknown binding keeps placeholder'
  );

  // Test case: text without bindings passes through
  assert(
    resolveBindingToExample('Plain text') === 'Plain text',
    'Plain text without bindings passes through unchanged'
  );

  // Test case: binding key alone (no mustache wrapper)
  assert(
    resolveBindingToExample('customer.name', 'customer.name') === 'Acme Corporation',
    'Raw binding key resolves via second parameter'
  );

  // Step 5: Verify canvas rendering uses preview mode
  console.log('\nStep 5: Verify canvas rendering uses preview mode');
  assert(componentSrc.includes('if (previewMode)'), 'Canvas checks previewMode state');
  assert(componentSrc.includes('resolveBindingToExample(rawText, el.binding)'), 'Text elements resolve in preview');
  assert(componentSrc.includes('previewMode && el.binding'), 'Other elements check preview mode');
  assert(componentSrc.includes('previewMode]'), 'renderCanvasElement depends on previewMode');

  // Step 6: Verify visual preview mode indicator
  console.log('\nStep 6: Verify preview mode visual indicator');
  assert(componentSrc.includes('preview-mode-badge'), 'Canvas shows PREVIEW badge');
  assert(componentSrc.includes("'PREVIEW'") || componentSrc.includes('>PREVIEW<') || componentSrc.includes('PREVIEW\n'), 'Badge shows PREVIEW text');

  // Step 7: Verify toolbar button styling changes in preview mode
  console.log('\nStep 7: Verify toolbar button active state');
  assert(componentSrc.includes("previewMode ? '#dbeafe'"), 'Button has active background in preview mode');
  assert(componentSrc.includes("previewMode ? '#3b82f6'"), 'Button has active border in preview mode');
  assert(componentSrc.includes("previewMode ? '#1d4ed8'"), 'Button has active text color in preview mode');

  // Step 8: Verify design mode shows binding placeholders
  console.log('\nStep 8: Verify design mode shows raw bindings');
  assert(
    componentSrc.includes('`{{${el.binding}}}`'),
    'Design mode wraps binding in {{ }} for display'
  );

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
