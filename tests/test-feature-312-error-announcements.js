/**
 * Feature #312: Error announcements for screen readers
 *
 * Verifies that validation errors are announced via ARIA live regions.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    results.push(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// Read the source file
const srcPath = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');
const src = fs.readFileSync(srcPath, 'utf8');

console.log('\n=== Feature #312: Error announcements for screen readers ===\n');

// ─── Hidden ARIA live region exists ───

test('Error announcer div exists with aria-live="assertive"', () => {
  assert(src.includes('data-testid="error-announcer"'), 'Missing error-announcer element');
  assert(src.includes('aria-live="assertive"'), 'Missing aria-live="assertive"');
});

test('Error announcer has role="alert"', () => {
  // Find the error announcer section
  const idx = src.indexOf('data-testid="error-announcer"');
  assert(idx > -1, 'error-announcer not found');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('role="alert"'), 'error-announcer missing role="alert"');
});

test('Error announcer has aria-atomic="true"', () => {
  const idx = src.indexOf('data-testid="error-announcer"');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('aria-atomic="true"'), 'Missing aria-atomic="true"');
});

test('Error announcer is visually hidden (sr-only)', () => {
  const idx = src.indexOf('data-testid="error-announcer"');
  const surrounding = src.slice(idx, idx + 500);
  assert(surrounding.includes("clip: 'rect(0, 0, 0, 0)'") || surrounding.includes('clip:'), 'Not visually hidden');
  assert(surrounding.includes("width: '1px'") || surrounding.includes("position: 'absolute'"), 'Not sr-only');
});

test('Error announcer renders errorAnnouncement state', () => {
  const idx = src.indexOf('data-testid="error-announcer"');
  const surrounding = src.slice(idx, idx + 500);
  assert(surrounding.includes('errorAnnouncement'), 'Does not render errorAnnouncement');
});

// ─── Status announcer exists ───

test('Status announcer exists with aria-live="polite"', () => {
  assert(src.includes('aria-live="polite"'), 'Missing aria-live="polite" status region');
});

test('Status announcer has role="status"', () => {
  assert(src.includes('role="status"'), 'Missing role="status"');
});

// ─── announceError function is called for errors ───

test('announceError called on save errors', () => {
  const saveErrorCalls = (src.match(/announceError\(`Save error/g) || []).length;
  assert(saveErrorCalls >= 1, `Expected announceError for save errors, found ${saveErrorCalls}`);
});

test('announceError called on publish errors', () => {
  const pubErrorCalls = (src.match(/announceError\(`Publish/g) || []).length;
  assert(pubErrorCalls >= 1, `Expected announceError for publish errors, found ${pubErrorCalls}`);
});

test('announceError called on auto-save errors', () => {
  const autoSaveCalls = (src.match(/announceError\('Auto-save failed'\)/g) || []).length;
  assert(autoSaveCalls >= 1, `Expected announceError for auto-save, found ${autoSaveCalls}`);
});

test('announceError called on render errors', () => {
  const renderCalls = (src.match(/announceError\(`(?:Render|Preview) failed/g) || []).length;
  assert(renderCalls >= 1, `Expected announceError for render errors, found ${renderCalls}`);
});

// ─── Visible error elements have ARIA attributes ───

test('Save error banner has role="alert"', () => {
  const idx = src.indexOf('data-testid="save-error-banner"');
  assert(idx > -1, 'save-error-banner not found');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('role="alert"'), 'save-error-banner missing role="alert"');
});

test('Save error banner has aria-live="assertive"', () => {
  const idx = src.indexOf('data-testid="save-error-banner"');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('aria-live="assertive"'), 'save-error-banner missing aria-live');
});

test('Publish error banner has role="alert"', () => {
  const idx = src.indexOf('data-testid="publish-error-banner"');
  assert(idx > -1, 'publish-error-banner not found');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('role="alert"'), 'publish-error-banner missing role="alert"');
});

test('Publish error banner has aria-live="assertive"', () => {
  const idx = src.indexOf('data-testid="publish-error-banner"');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('aria-live="assertive"'), 'publish-error-banner missing aria-live');
});

test('Validation errors list has aria-label', () => {
  const idx = src.indexOf('data-testid="publish-validation-errors"');
  assert(idx > -1, 'publish-validation-errors not found');
  const surrounding = src.slice(idx - 50, idx + 200);
  assert(surrounding.includes('aria-label="Validation errors"'), 'Missing aria-label on validation errors list');
});

// ─── Toast notifications have proper ARIA ───

test('Error toast has role="alert"', () => {
  // The toast component should use role="alert" for error type
  assert(src.includes("role={toast.type === 'error' ? 'alert' : 'status'}"),
    'Toast missing conditional role (alert for errors, status for others)');
});

test('Error toast has aria-live="assertive"', () => {
  assert(src.includes("aria-live={toast.type === 'error' ? 'assertive' : 'polite'}"),
    'Toast missing conditional aria-live (assertive for errors, polite for others)');
});

// ─── Render overlay has ARIA ───

test('Render overlay has role="alertdialog"', () => {
  const idx = src.indexOf('data-testid="render-overlay"');
  assert(idx > -1, 'render-overlay not found');
  const surrounding = src.slice(idx, idx + 300);
  assert(surrounding.includes('role="alertdialog"'), 'render-overlay missing role="alertdialog"');
});

test('Render overlay has aria-label for error state', () => {
  const idx = src.indexOf('data-testid="render-overlay"');
  const surrounding = src.slice(idx, idx + 300);
  assert(surrounding.includes("aria-label={renderStatus === 'error'"), 'render-overlay missing conditional aria-label');
});

// ─── Loading overlay has ARIA ───

test('Loading overlay has role="status" and aria-live', () => {
  const idx = src.indexOf('data-testid="operation-loading-overlay"');
  assert(idx > -1, 'operation-loading-overlay not found');
  const surrounding = src.slice(idx, idx + 300);
  assert(surrounding.includes('role="status"'), 'loading overlay missing role="status"');
  assert(surrounding.includes('aria-live="polite"'), 'loading overlay missing aria-live="polite"');
});

// ─── Error text is readable ───

test('Error messages use descriptive text (not just codes)', () => {
  // Check that error messages include human-readable descriptions
  assert(src.includes('Save error:'), 'Save errors should have descriptive prefix');
  assert(src.includes('Publish error:') || src.includes('Publish failed:'), 'Publish errors should have descriptive prefix');
});

test('announceError clears and re-sets for repeated announcements', () => {
  // Pattern: clear first, then set via requestAnimationFrame
  assert(src.includes("setErrorAnnouncement('')"), 'Should clear errorAnnouncement first');
  assert(src.includes('requestAnimationFrame(() => setErrorAnnouncement(message))'), 'Should re-set via rAF');
});

// Print results
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
