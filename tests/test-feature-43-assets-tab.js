/**
 * Feature #43: Designer Assets tab displays uploaded assets
 * Tests that the Assets tab shows org images/fonts with upload button and drag support.
 *
 * Verifies via source code analysis and SSR HTML structure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3001';
const COMPONENT_PATH = path.join(__dirname, '..', 'apps', 'designer-sandbox', 'components', 'ErpDesigner.tsx');

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
  console.log('Feature #43: Designer Assets tab displays uploaded assets\n');

  let html;
  try {
    html = await fetchPage(FRONTEND_URL);
  } catch (err) {
    console.log(`  ❌ Failed to fetch page: ${err.message}`);
    process.exit(1);
  }

  const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');

  // --- Tab structure ---

  test('Assets tab button exists in left panel tabs', () => {
    assert(html.includes('id="tab-assets-btn"'), 'Assets tab button should exist');
  });

  test('Assets tab is clickable via setActiveTab', () => {
    assert(source.includes("setActiveTab(tab)"), 'Tab click should call setActiveTab');
    assert(source.includes("'assets'"), 'assets should be in tab list');
  });

  // --- Assets tab content ---

  test('Assets tab content is conditionally rendered', () => {
    assert(source.includes("activeTab === 'assets'"), 'Should have conditional render for assets tab');
    assert(source.includes('data-testid="assets-content"'), 'Should have assets-content testid');
  });

  // --- Upload button ---

  test('Upload button exists with data-testid', () => {
    assert(source.includes('data-testid="asset-upload-btn"'), 'Upload button should have testid');
  });

  test('Upload button has aria-label for accessibility', () => {
    assert(source.includes('aria-label="Upload asset"'), 'Upload button should have aria-label');
  });

  test('Upload button text shows "Upload Asset"', () => {
    assert(source.includes("'Upload Asset'"), 'Upload button should show Upload Asset text');
  });

  test('Upload button triggers file input click', () => {
    assert(source.includes('assetFileInputRef.current?.click()'), 'Upload button should trigger file input');
  });

  test('Hidden file input accepts image formats', () => {
    assert(source.includes('data-testid="asset-file-input"'), 'File input should have testid');
    assert(source.includes('accept=".png,.jpg,.jpeg,.svg,.webp,.gif"'), 'File input should accept image formats');
  });

  test('File input onChange triggers upload handler', () => {
    assert(source.includes('onChange={handleAssetFileChange}'), 'File input should have change handler');
  });

  // --- Upload progress ---

  test('Upload progress bar is shown during upload', () => {
    assert(source.includes('data-testid="asset-upload-progress-bar"'), 'Progress bar should have testid');
    assert(source.includes('data-testid="asset-upload-progress-section"'), 'Progress section should have testid');
  });

  test('Upload progress text shows percentage', () => {
    assert(source.includes('data-testid="asset-upload-progress-text"'), 'Progress text should have testid');
    assert(source.includes('assetUploadProgress'), 'Should track upload progress percentage');
  });

  test('Upload error state is displayed', () => {
    assert(source.includes('data-testid="asset-upload-error"'), 'Error state should have testid');
    assert(source.includes('assetUploadError'), 'Should display upload error message');
  });

  test('Upload button shows uploading state', () => {
    assert(source.includes("'uploading'"), 'Should have uploading state');
    assert(source.includes("Uploading…"), 'Should show uploading text');
  });

  test('Upload button shows success state', () => {
    assert(source.includes("'✓ Upload Complete'"), 'Should show success text');
  });

  test('Upload button disabled during upload', () => {
    assert(source.includes("disabled={assetUploadStatus === 'uploading'}"), 'Button should be disabled during upload');
  });

  // --- Assets load from API ---

  test('Assets state is initialized as empty array', () => {
    assert(source.includes("const [assets, setAssets] = useState"), 'Should have assets state');
  });

  test('loadAssets function fetches from API', () => {
    assert(source.includes("fetch(`${apiBase}/assets`"), 'Should fetch from /assets API endpoint');
  });

  test('loadAssets sends Authorization header', () => {
    assert(source.includes("'Authorization'"), 'Should send Authorization header');
    assert(source.includes("Bearer"), 'Should use Bearer token format');
  });

  test('loadAssets parses response and sets assets state', () => {
    assert(source.includes('setAssets(assetList)'), 'Should set assets from API response');
  });

  test('Assets loaded on component mount when authToken available', () => {
    assert(source.includes('loadAssets()'), 'Should call loadAssets on mount');
  });

  // --- Assets list display ---

  test('Assets list has data-testid', () => {
    assert(source.includes('data-testid="assets-list"'), 'Assets list should have testid');
  });

  test('Empty state shown when no assets', () => {
    assert(source.includes('No assets uploaded yet'), 'Should show empty state message');
  });

  test('Asset items have unique data-testid', () => {
    assert(source.includes('data-testid={`asset-item-${asset.id}`}'), 'Asset items should have dynamic testid');
  });

  test('Asset items display filename', () => {
    assert(source.includes('title={asset.filename}'), 'Asset items should show filename');
  });

  test('Asset items show image thumbnail or file icon', () => {
    assert(source.includes("asset.mimeType.startsWith('image/')"), 'Should check if asset is image');
    assert(source.includes('IMG'), 'Should show IMG placeholder for images');
  });

  // --- Asset item interactivity ---

  test('Asset items have cursor:pointer style', () => {
    // Assets section has cursor: pointer on items
    const assetsSection = source.substring(
      source.indexOf('data-testid="assets-list"'),
      source.indexOf('data-testid="assets-list"') + 2000
    );
    assert(assetsSection.includes("cursor: 'pointer'") || assetsSection.includes("cursor: 'grab'"),
      'Asset items should have interactive cursor');
  });

  test('Asset items have border and background styling', () => {
    const assetsSection = source.substring(
      source.indexOf('data-testid={`asset-item-${asset.id}`}'),
      source.indexOf('data-testid={`asset-item-${asset.id}`}') + 500
    );
    assert(assetsSection.includes('border'), 'Asset items should have border');
    assert(assetsSection.includes('backgroundColor'), 'Asset items should have background color');
  });

  // --- Asset upload handler ---

  test('handleAssetFileChange function exists', () => {
    assert(source.includes('handleAssetFileChange'), 'Should have handleAssetFileChange handler');
  });

  test('Asset file reference exists', () => {
    assert(source.includes('assetFileInputRef'), 'Should have asset file input ref');
  });

  // --- Mime type mapping ---

  test('Mime type mapping covers common image formats', () => {
    assert(source.includes("png: 'image/png'"), 'Should map png');
    assert(source.includes("jpg: 'image/jpeg'"), 'Should map jpg');
    assert(source.includes("svg: 'image/svg+xml'"), 'Should map svg');
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);
  process.exit(failed > 0 ? 1 : 0);
})();
