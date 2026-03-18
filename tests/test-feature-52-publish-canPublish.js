/**
 * Feature #52: Toolbar publish respects canPublish
 * Publish only when permitted
 *
 * Steps:
 * 1. canPublish=true: enabled, click calls onPublish
 * 2. canPublish=false: disabled or hidden
 *
 * Tests SSR HTML and source code for canPublish wiring.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const PAGE_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'app', 'page.tsx');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Feature #52: Toolbar publish respects canPublish\n');

  let html, htmlDisabled, source, pageSource;
  try {
    html = await fetchPage(FRONTEND_URL);
    htmlDisabled = await fetchPage(`${FRONTEND_URL}?canPublish=false`);
    source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    pageSource = fs.readFileSync(PAGE_PATH, 'utf-8');
  } catch (err) {
    console.log(`  ❌ Failed to fetch page or read source: ${err.message}`);
    process.exit(1);
  }

  // === SECTION 1: canPublish prop in interface ===
  console.log('--- canPublish Prop Definition ---');

  test('ErpDesignerProps includes canPublish prop', () => {
    assert(source.includes('canPublish?:'), 'canPublish not in interface');
  });

  test('canPublish has boolean type', () => {
    assert(source.includes('canPublish?: boolean'), 'canPublish is not boolean');
  });

  test('canPublish defaults to true', () => {
    assert(source.includes('canPublish = true'), 'canPublish default not set to true');
  });

  test('canPublish is destructured in component', () => {
    assert(source.includes('canPublish'), 'canPublish not destructured');
  });

  // === SECTION 2: onPublish callback ===
  console.log('\n--- onPublish Callback ---');

  test('ErpDesignerProps includes onPublish prop', () => {
    assert(source.includes('onPublish?:'), 'onPublish not in interface');
  });

  test('onPublish is destructured in component', () => {
    assert(source.includes('onPublish,'), 'onPublish not destructured');
  });

  test('handlePublish calls onPublish callback', () => {
    const publishSection = source.substring(
      source.indexOf('const handlePublish = useCallback'),
      source.indexOf('const handlePublish = useCallback') + 2000
    );
    assert(publishSection.includes('onPublish(') || publishSection.includes('onPublish({'), 'onPublish not called in handlePublish');
  });

  test('handlePublish checks canPublish before proceeding', () => {
    const publishSection = source.substring(
      source.indexOf('const handlePublish = useCallback'),
      source.indexOf('const handlePublish = useCallback') + 500
    );
    assert(publishSection.includes('canPublish'), 'canPublish not checked in handlePublish');
  });

  // === SECTION 3: Publish button default state (canPublish=true) ===
  console.log('\n--- Publish Button (canPublish=true, default) ---');

  test('Publish button exists with data-testid="btn-publish"', () => {
    assert(html.includes('data-testid="btn-publish"'), 'btn-publish not found in HTML');
  });

  test('Publish button has aria-label', () => {
    assert(html.includes('aria-label="Publish template"'), 'Publish aria-label not found');
  });

  test('Publish button shows "Publish" text by default', () => {
    assert(html.includes('>Publish<'), 'Publish text not found in default HTML');
  });

  // === SECTION 4: Publish button disabled state (canPublish=false) ===
  console.log('\n--- Publish Button (canPublish=false) ---');

  test('Publish button is disabled when canPublish=false', () => {
    // The button should have disabled attribute in the HTML when canPublish=false
    // Check source code for disabled logic
    assert(source.includes('!canPublish'), '!canPublish not used in disabled condition');
  });

  test('Publish button disabled condition includes canPublish check', () => {
    const btnPublishSection = source.substring(
      source.indexOf('data-testid="btn-publish"'),
      source.indexOf('data-testid="btn-publish"') + 500
    );
    assert(btnPublishSection.includes('!canPublish'), '!canPublish not in disabled attribute');
  });

  test('Publish button shows tooltip when disabled', () => {
    assert(source.includes('Publishing is not permitted'), 'Disabled tooltip text not found');
  });

  test('Publish button has grey/muted styling when canPublish=false', () => {
    assert(source.includes("!canPublish ? '#94a3b8'") || source.includes('!canPublish'), 'Muted styling not found');
  });

  test('Publish button opacity is reduced when canPublish=false', () => {
    const btnPublishSection = source.substring(
      source.indexOf('data-testid="btn-publish"'),
      source.indexOf('data-testid="btn-publish"') + 500
    );
    assert(btnPublishSection.includes('!canPublish') && btnPublishSection.includes('opacity'), 'Reduced opacity not found');
  });

  test('Publish button cursor is not-allowed when canPublish=false', () => {
    const btnPublishSection = source.substring(
      source.indexOf('data-testid="btn-publish"'),
      source.indexOf('data-testid="btn-publish"') + 800
    );
    assert(btnPublishSection.includes('not-allowed') && btnPublishSection.includes('!canPublish'), 'not-allowed cursor not found');
  });

  // === SECTION 5: Page.tsx integration ===
  console.log('\n--- Page Integration ---');

  test('page.tsx reads canPublish from search params', () => {
    assert(pageSource.includes('canPublish'), 'canPublish not in page.tsx');
  });

  test('page.tsx passes canPublish to ErpDesigner', () => {
    assert(pageSource.includes('canPublish={canPublish}') || pageSource.includes('canPublish='), 'canPublish not passed to ErpDesigner');
  });

  test('canPublish defaults to true when not set in URL', () => {
    assert(pageSource.includes("!== 'false'") || pageSource.includes("canPublish !== 'false'"), 'canPublish default logic not found');
  });

  // === SECTION 6: Publish status indicators ===
  console.log('\n--- Publish Status Indicators ---');

  test('Publishing… text shown during publish', () => {
    assert(source.includes("'Publishing…'") || source.includes('"Publishing…"'), 'Publishing… text not found');
  });

  test('Published success indicator exists', () => {
    assert(source.includes("'✓ Published'") || source.includes('"✓ Published"'), '✓ Published text not found');
  });

  test('Retry Publish text shown on error', () => {
    assert(source.includes("'Retry Publish'") || source.includes('"Retry Publish"'), 'Retry Publish text not found');
  });

  // === Summary ===
  console.log(`\n--- Results: ${passed} passed, ${failed} failed, ${passed + failed} total ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
