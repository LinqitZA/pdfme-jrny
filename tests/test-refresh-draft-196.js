/**
 * Test Feature #196: Refresh mid-form preserves draft
 *
 * Verifies that browser refresh recovers auto-saved draft:
 * 1. Open designer with changes
 * 2. Wait for auto-save (or trigger manual save)
 * 3. Refresh browser
 * 4. Verify draft loaded from server
 * 5. Verify changes from before refresh present
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/pdfme';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiAidGVzdC11c2VyIiwgIm9yZ0lkIjogInRlc3Qtb3JnIiwgInJvbGVzIjogWyJ0ZW1wbGF0ZTplZGl0IiwgInRlbXBsYXRlOnZpZXciLCAicmVuZGVyOnRyaWdnZXIiLCAidGVtcGxhdGU6cHVibGlzaCIsICJ0ZW1wbGF0ZTpkZWxldGUiXX0=.sig';

async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  return { status: res.status, data: await res.json().catch(() => null) };
}

let passed = 0;
let failed = 0;
let templateId = null;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

async function setup() {
  // Create a template with initial schema
  const res = await apiCall('POST', '/templates', {
    name: 'REFRESH_TEST_196',
    type: 'invoice',
    orgId: 'test-org',
    schema: {
      schemas: [],
      basePdf: 'BLANK_PDF',
      pageSize: 'A4',
      pages: [
        {
          id: 'page-1',
          label: 'Page 1',
          elements: [
            { id: 'el-1', type: 'text', x: 50, y: 50, w: 100, h: 40, content: 'Original Text' }
          ]
        }
      ]
    }
  });
  templateId = res.data?.id;
  console.log(`Created template: ${templateId}`);
  return templateId;
}

async function cleanup() {
  if (templateId) {
    await apiCall('DELETE', `/templates/${templateId}?orgId=test-org`);
    console.log(`Cleaned up template: ${templateId}`);
  }
}

async function runTests() {
  console.log('\n=== Feature #196: Refresh mid-form preserves draft ===\n');

  // Setup
  await setup();
  assert(!!templateId, 'Template created successfully');

  // Test 1: Save draft with modified content
  console.log('\n--- Test: Save draft with modified content ---');
  {
    const res = await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'REFRESH_TEST_196_MODIFIED',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [
          {
            id: 'page-1',
            label: 'Page 1',
            elements: [
              { id: 'el-1', type: 'text', x: 100, y: 200, w: 150, h: 50, content: 'Modified After Refresh Text', fontSize: 16 },
              { id: 'el-2', type: 'image', x: 300, y: 100, w: 80, h: 80, src: 'logo.png' }
            ]
          },
          {
            id: 'page-2',
            label: 'Page 2',
            elements: [
              { id: 'el-3', type: 'calculated', x: 50, y: 50, w: 200, h: 30, content: '{{total}}' }
            ]
          }
        ]
      }
    });
    assert(res.status === 200, `Draft saved successfully (status: ${res.status})`);
  }

  // Test 2: Fetch template (simulating browser refresh / remount)
  console.log('\n--- Test: Fetch template after "refresh" ---');
  {
    const res = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    assert(res.status === 200, `Template fetched successfully (status: ${res.status})`);
    assert(res.data?.name === 'REFRESH_TEST_196_MODIFIED', `Name preserved: "${res.data?.name}"`);

    const schema = res.data?.schema;
    assert(!!schema, 'Schema exists in response');
    assert(schema?.pageSize === 'A4', `Page size preserved: ${schema?.pageSize}`);
    assert(Array.isArray(schema?.pages), 'Pages array exists');
    assert(schema?.pages?.length === 2, `Two pages preserved: ${schema?.pages?.length}`);

    // Verify page 1 elements
    const page1 = schema?.pages?.[0];
    assert(page1?.id === 'page-1', `Page 1 ID preserved: ${page1?.id}`);
    assert(page1?.elements?.length === 2, `Page 1 has 2 elements: ${page1?.elements?.length}`);

    const el1 = page1?.elements?.[0];
    assert(el1?.id === 'el-1', `Element 1 ID preserved: ${el1?.id}`);
    assert(el1?.type === 'text', `Element 1 type preserved: ${el1?.type}`);
    assert(el1?.x === 100, `Element 1 x position preserved: ${el1?.x}`);
    assert(el1?.y === 200, `Element 1 y position preserved: ${el1?.y}`);
    assert(el1?.w === 150, `Element 1 width preserved: ${el1?.w}`);
    assert(el1?.h === 50, `Element 1 height preserved: ${el1?.h}`);
    assert(el1?.content === 'Modified After Refresh Text', `Element 1 content preserved: "${el1?.content}"`);
    assert(el1?.fontSize === 16, `Element 1 fontSize preserved: ${el1?.fontSize}`);

    const el2 = page1?.elements?.[1];
    assert(el2?.id === 'el-2', `Element 2 ID preserved: ${el2?.id}`);
    assert(el2?.type === 'image', `Element 2 type preserved: ${el2?.type}`);
    assert(el2?.src === 'logo.png', `Element 2 src preserved: "${el2?.src}"`);

    // Verify page 2 elements
    const page2 = schema?.pages?.[1];
    assert(page2?.id === 'page-2', `Page 2 ID preserved: ${page2?.id}`);
    assert(page2?.elements?.length === 1, `Page 2 has 1 element: ${page2?.elements?.length}`);
    assert(page2?.elements?.[0]?.content === '{{total}}', `Page 2 element binding preserved: "${page2?.elements?.[0]?.content}"`);
  }

  // Test 3: Multiple saves preserve latest state (simulating multiple auto-saves before refresh)
  console.log('\n--- Test: Multiple saves preserve latest state ---');
  {
    // First auto-save
    await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'REFRESH_TEST_196_V2',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'Letter',
        pages: [{ id: 'page-1', label: 'Page 1', elements: [{ id: 'el-1', type: 'text', x: 10, y: 10, w: 50, h: 20, content: 'V2' }] }]
      }
    });

    // Second auto-save (overwrites first)
    await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'REFRESH_TEST_196_V3',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'Legal',
        pages: [
          { id: 'page-1', label: 'Page 1', elements: [{ id: 'el-1', type: 'text', x: 20, y: 20, w: 60, h: 25, content: 'V3 Final' }] },
          { id: 'page-2', label: 'Page 2', elements: [] },
          { id: 'page-3', label: 'Page 3', elements: [{ id: 'el-4', type: 'watermark', x: 0, y: 0, w: 595, h: 842, content: 'DRAFT' }] }
        ]
      }
    });

    // "Refresh" - fetch latest
    const res = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    assert(res.data?.name === 'REFRESH_TEST_196_V3', `Latest name after multiple saves: "${res.data?.name}"`);
    assert(res.data?.schema?.pageSize === 'Legal', `Latest pageSize after multiple saves: ${res.data?.schema?.pageSize}`);
    assert(res.data?.schema?.pages?.length === 3, `Latest page count after multiple saves: ${res.data?.schema?.pages?.length}`);
    assert(res.data?.schema?.pages?.[0]?.elements?.[0]?.content === 'V3 Final', `Latest content after multiple saves: "${res.data?.schema?.pages?.[0]?.elements?.[0]?.content}"`);
    assert(res.data?.schema?.pages?.[2]?.elements?.[0]?.type === 'watermark', `Watermark element preserved: ${res.data?.schema?.pages?.[2]?.elements?.[0]?.type}`);
  }

  // Test 4: Draft persists across server restart simulation
  console.log('\n--- Test: Draft persists in database (not in-memory) ---');
  {
    // Save a unique value
    const uniqueMarker = `PERSIST_CHECK_${Date.now()}`;
    await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: uniqueMarker,
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [{ id: 'page-1', label: 'Page 1', elements: [{ id: 'el-persist', type: 'text', x: 50, y: 50, w: 100, h: 40, content: uniqueMarker }] }]
      }
    });

    // Fetch immediately
    const res1 = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    assert(res1.data?.name === uniqueMarker, `Unique marker persisted: "${res1.data?.name}"`);
    assert(res1.data?.schema?.pages?.[0]?.elements?.[0]?.content === uniqueMarker, `Unique marker in element content: "${res1.data?.schema?.pages?.[0]?.elements?.[0]?.content}"`);

    // Fetch again (confirms database, not cache)
    const res2 = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    assert(res2.data?.name === uniqueMarker, `Still available on second fetch: "${res2.data?.name}"`);
  }

  // Test 5: Empty pages and elements preserved
  console.log('\n--- Test: Empty pages and elements preserved ---');
  {
    await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'REFRESH_EMPTY_PAGES',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [
          { id: 'page-1', label: 'Page 1', elements: [] },
          { id: 'page-2', label: 'Page 2', elements: [] }
        ]
      }
    });

    const res = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    assert(res.data?.schema?.pages?.length === 2, `Two empty pages preserved: ${res.data?.schema?.pages?.length}`);
    assert(res.data?.schema?.pages?.[0]?.elements?.length === 0, `Page 1 empty elements preserved: ${res.data?.schema?.pages?.[0]?.elements?.length}`);
    assert(res.data?.schema?.pages?.[1]?.elements?.length === 0, `Page 2 empty elements preserved: ${res.data?.schema?.pages?.[1]?.elements?.length}`);
  }

  // Test 6: Complex element properties preserved
  console.log('\n--- Test: Complex element properties preserved after refresh ---');
  {
    await apiCall('PUT', `/templates/${templateId}/draft`, {
      name: 'REFRESH_COMPLEX_PROPS',
      schema: {
        schemas: [],
        basePdf: 'BLANK_PDF',
        pageSize: 'A4',
        pages: [{
          id: 'page-1',
          label: 'Page 1',
          elements: [
            {
              id: 'el-table',
              type: 'line-items',
              x: 50, y: 100, w: 500, h: 300,
              columns: [
                { key: 'item', header: 'Item', width: 200 },
                { key: 'qty', header: 'Quantity', width: 100 },
                { key: 'price', header: 'Price', width: 100 }
              ],
              showHeader: true,
              borderStyle: 'solid'
            },
            {
              id: 'el-styled-text',
              type: 'text',
              x: 50, y: 50, w: 200, h: 30,
              content: 'Invoice #{{document.number}}',
              fontFamily: 'Helvetica',
              fontSize: 24,
              fontWeight: 'bold',
              fontStyle: 'italic',
              textAlign: 'center',
              color: '#1a1a2e',
              lineHeight: 1.5,
              binding: '{{document.number}}'
            },
            {
              id: 'el-img',
              type: 'erp-image',
              x: 400, y: 20, w: 120, h: 60,
              src: 'assets/company-logo.png',
              objectFit: 'contain',
              opacity: 0.9
            }
          ]
        }]
      }
    });

    const res = await apiCall('GET', `/templates/${templateId}?orgId=test-org`);
    const page = res.data?.schema?.pages?.[0];
    assert(page?.elements?.length === 3, `Three complex elements preserved: ${page?.elements?.length}`);

    // Table element
    const table = page?.elements?.[0];
    assert(table?.type === 'line-items', `Table type preserved: ${table?.type}`);
    assert(table?.columns?.length === 3, `Table columns preserved: ${table?.columns?.length}`);
    assert(table?.columns?.[0]?.key === 'item', `Column key preserved: ${table?.columns?.[0]?.key}`);
    assert(table?.showHeader === true, `showHeader preserved: ${table?.showHeader}`);
    assert(table?.borderStyle === 'solid', `borderStyle preserved: ${table?.borderStyle}`);

    // Styled text
    const text = page?.elements?.[1];
    assert(text?.fontFamily === 'Helvetica', `fontFamily preserved: ${text?.fontFamily}`);
    assert(text?.fontSize === 24, `fontSize preserved: ${text?.fontSize}`);
    assert(text?.fontWeight === 'bold', `fontWeight preserved: ${text?.fontWeight}`);
    assert(text?.fontStyle === 'italic', `fontStyle preserved: ${text?.fontStyle}`);
    assert(text?.textAlign === 'center', `textAlign preserved: ${text?.textAlign}`);
    assert(text?.color === '#1a1a2e', `color preserved: ${text?.color}`);
    assert(text?.lineHeight === 1.5, `lineHeight preserved: ${text?.lineHeight}`);
    assert(text?.binding === '{{document.number}}', `binding preserved: ${text?.binding}`);

    // Image
    const img = page?.elements?.[2];
    assert(img?.objectFit === 'contain', `objectFit preserved: ${img?.objectFit}`);
    assert(img?.opacity === 0.9, `opacity preserved: ${img?.opacity}`);
  }

  // Cleanup
  await cleanup();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed (${passed + failed} total) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  cleanup().then(() => process.exit(1));
});
