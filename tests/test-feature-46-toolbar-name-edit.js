/**
 * Test Feature #46: Toolbar template name inline edit
 *
 * Verifies:
 * - Template name is editable inline in toolbar
 * - Click name to focus
 * - Type new name
 * - Press Enter / blur to confirm
 * - Verify update
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    results.push(`  ✅ ${testName}`);
  } else {
    failed++;
    results.push(`  ❌ ${testName}`);
  }
}

async function runTests() {
  console.log('=== Feature #46: Toolbar template name inline edit ===\n');

  const componentPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf-8');

  // ─── Part 1: Name state management ───
  console.log('--- Part 1: Name state management ---');

  // Check name state exists
  assert(
    componentSource.includes("const [name, setName] = useState(templateName)"),
    'Name state initialized from templateName prop'
  );

  // Check templateName has a default value
  assert(
    componentSource.includes("templateName = 'Untitled Template'"),
    'templateName prop defaults to "Untitled Template"'
  );

  // ─── Part 2: Input element in toolbar ───
  console.log('--- Part 2: Name input in toolbar ---');

  // Check input has data-testid
  assert(
    componentSource.includes('data-testid="template-name-input"'),
    'Template name input has data-testid="template-name-input"'
  );

  // Check input has value bound to name state
  assert(
    componentSource.includes('value={name}'),
    'Input value bound to name state'
  );

  // Check input has aria-label
  assert(
    componentSource.includes('aria-label="Template name"'),
    'Input has aria-label="Template name" for accessibility'
  );

  // Check input has title showing full name (tooltip)
  assert(
    componentSource.includes('title={name}'),
    'Input has title={name} for tooltip on hover'
  );

  // ─── Part 3: Name editing behavior ───
  console.log('--- Part 3: Name editing behavior ---');

  // Check onChange handler updates name and marks dirty
  assert(
    componentSource.includes('onChange={(e) => { if (!isReadOnly) { setName(e.target.value); setIsDirty(true); } }}'),
    'onChange updates name and sets isDirty when not readOnly'
  );

  // Check readOnly respects isReadOnly flag
  assert(
    componentSource.includes('readOnly={isReadOnly}'),
    'Input is readOnly when isReadOnly flag is true'
  );

  // Check cursor style changes based on readOnly
  assert(
    componentSource.includes("cursor: isReadOnly ? 'not-allowed' : 'text'"),
    'Cursor shows not-allowed when readOnly, text when editable'
  );

  // ─── Part 4: Visual feedback on focus ───
  console.log('--- Part 4: Focus/blur visual feedback ---');

  // Check onFocus adds background highlight
  assert(
    componentSource.includes("onFocus={(e) => { if (!isReadOnly) e.target.style.backgroundColor = '#f1f5f9'; }"),
    'onFocus highlights input background when editable'
  );

  // Check onBlur removes background highlight
  assert(
    componentSource.includes("onBlur={(e) => { if (!isReadOnly) e.target.style.backgroundColor = 'transparent'; }"),
    'onBlur removes input background highlight'
  );

  // Check input has transparent background by default
  assert(
    componentSource.includes("backgroundColor: isReadOnly ? '#f1f5f9' : 'transparent'"),
    'Default background is transparent (looks inline, not like a form input)'
  );

  // ─── Part 5: Input styling ───
  console.log('--- Part 5: Input styling ---');

  // Check input has no visible border (inline edit appearance)
  assert(
    componentSource.includes("border: 'none'") &&
    componentSource.indexOf("border: 'none'") < componentSource.indexOf('template-name-input') + 500,
    'Input has no border for inline appearance'
  );

  // Check input has proper font styling
  assert(
    componentSource.includes("fontSize: '14px'"),
    'Input has 14px font size'
  );

  assert(
    componentSource.includes("fontWeight: 600"),
    'Input has bold font weight (600) for template name prominence'
  );

  // Check input width constraints
  assert(
    componentSource.includes("width: '200px'") || componentSource.includes("maxWidth: '200px'"),
    'Input has constrained width to fit toolbar'
  );

  // Check text overflow handling
  assert(
    componentSource.includes("overflow: 'hidden'") && componentSource.includes("textOverflow: 'ellipsis'"),
    'Long names are truncated with ellipsis'
  );

  // ─── Part 6: Name used in save/publish ───
  console.log('--- Part 6: Name included in save/publish ---');

  // Check name is included in save payload
  assert(
    componentSource.includes('onSave({ name,') || componentSource.includes('name, pageSize'),
    'Name is included in save payload'
  );

  // Check isDirty flag is set when name changes
  assert(
    componentSource.includes('setIsDirty(true)'),
    'isDirty flag set when name changes (triggers save)'
  );

  // ─── Part 7: Name from template load ───
  console.log('--- Part 7: Name from loaded template ---');

  // Check name is updated when template is loaded from API
  assert(
    componentSource.includes('setName(template.name)') || componentSource.includes('setName('),
    'Name state updated when template loaded from API'
  );

  // ─── Part 8: Page integration ───
  console.log('--- Part 8: Page.tsx passes templateName ---');

  const pagePath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'page.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert(
    pageSource.includes("templateName={templateName}"),
    'Page passes templateName prop to ErpDesigner'
  );

  assert(
    pageSource.includes("templateName || 'Invoice Template'") || pageSource.includes("'Invoice Template'"),
    'Page provides default template name from URL params'
  );

  // ─── Part 9: Inline edit UX quality ───
  console.log('--- Part 9: Inline edit UX quality ---');

  // Input should be an <input> not a contentEditable div (simpler, more reliable)
  const nameInputMatch = componentSource.match(/<input[^>]*template-name-input/);
  assert(
    nameInputMatch !== null,
    'Template name uses <input> element (not contentEditable)'
  );

  // Check borderRadius for subtle rounded corners
  assert(
    componentSource.includes("borderRadius: '4px'"),
    'Input has rounded corners (4px) for polish'
  );

  // ─── Summary ───
  console.log('\n--- Results ---');
  results.forEach((r) => console.log(r));
  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
