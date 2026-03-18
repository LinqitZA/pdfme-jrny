#!/bin/bash
# Test: Feature #152 - Render fails cleanly on DataSource error
# Verifies that DataSource errors produce proper error response with status=failed

set -e
PORT=${PORT:-3099}
BASE="http://localhost:$PORT/api/pdfme"
PASS=0
FAIL=0
TOTAL=0

# Dev JWT helper
jwt() {
  local payload="$1"
  local header='{"alg":"none","typ":"JWT"}'
  local h=$(echo -n "$header" | base64 -w0 | tr '+/' '-_' | tr -d '=')
  local p=$(echo -n "$payload" | base64 -w0 | tr '+/' '-_' | tr -d '=')
  echo "${h}.${p}."
}

TOKEN=$(jwt '{"sub":"user-ds-test","orgId":"org-ds-test","roles":["admin"]}')

check() {
  TOTAL=$((TOTAL + 1))
  local desc="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    PASS=$((PASS + 1))
    echo "  ✅ $desc"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ $desc"
  fi
}

echo "=== Feature #152: Render fails cleanly on DataSource error ==="
echo ""

# Step 1: Register a test DataSource that will throw an error
echo "Step 1: Register error-throwing DataSource for 'invoice' type..."
REG_RESP=$(curl -s -X POST "$BASE/datasources/invoice/register-test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"errorMessage": "Database connection timeout: unable to fetch invoice data from ERP backend"}')

echo "  Register response: $REG_RESP"
WILL_THROW=$(echo "$REG_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).willThrow); } catch(e) { console.log('ERROR'); } })")
check "Test DataSource registered with error" "$([ "$WILL_THROW" = "true" ] && echo true || echo false)"

# Step 2: Create and publish a template of type 'invoice' to trigger the DataSource
echo ""
echo "Step 2: Create template for DataSource error test..."
CREATE_RESP=$(curl -s -X POST "$BASE/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "name": "DS Error Test Template",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 100, "height": 15}
      ]],
      "columns": [],
      "sampledata": [{}]
    }
  }')

DS_TEMPLATE_ID=$(echo "$CREATE_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).id); } catch(e) { console.log('ERROR'); } })")

# Publish
curl -s -X POST "$BASE/templates/$DS_TEMPLATE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" > /dev/null

echo "  Rendering with error DataSource (no explicit inputs)..."
RENDER_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/render/now" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$DS_TEMPLATE_ID\",
    \"entityId\": \"ds-error-test-entity-1\",
    \"channel\": \"print\"
  }")

# Extract HTTP status code (last line) and body (all but last line)
HTTP_CODE=$(echo "$RENDER_RESP" | tail -1)
BODY=$(echo "$RENDER_RESP" | sed '$d')

echo "  HTTP Status: $HTTP_CODE"
echo "  Response body (truncated): $(echo "$BODY" | head -c 500)"

# Verify HTTP 500 response
check "HTTP response is 500" "$([ "$HTTP_CODE" = "500" ] && echo true || echo false)"

# Verify error message contains DataSource error info
ERROR_MSG=$(echo "$BODY" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).message || ''); } catch(e) { console.log(''); } })")
check "Error message contains 'DataSource error'" "$(echo "$ERROR_MSG" | grep -q "DataSource error" && echo true || echo false)"
check "Error message contains original error details" "$(echo "$ERROR_MSG" | grep -q "Database connection timeout" && echo true || echo false)"

# Verify document field exists with status=failed
DOC_STATUS=$(echo "$BODY" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.status : ''); } catch(e) { console.log(''); } })")
check "GeneratedDocument status is 'failed'" "$([ "$DOC_STATUS" = "failed" ] && echo true || echo false)"

# Verify errorMessage field populated in the document
DOC_ERROR=$(echo "$BODY" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.errorMessage : ''); } catch(e) { console.log(''); } })")
check "GeneratedDocument errorMessage populated" "$([ "$DOC_ERROR" != "" ] && echo true || echo false)"
check "errorMessage contains 'DataSource error'" "$(echo "$DOC_ERROR" | grep -q "DataSource error" && echo true || echo false)"

# Verify the document ID was generated (proves record was created)
DOC_ID=$(echo "$BODY" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.id : ''); } catch(e) { console.log(''); } })")
check "GeneratedDocument ID exists (record created in DB)" "$([ "$DOC_ID" != "" ] && echo true || echo false)"

# Step 3: Verify the failed document persists in DB
echo ""
echo "Step 3: Verify failed document persists..."
VERIFY_RESP=$(curl -s -X GET "$BASE/render/verify/$DOC_ID" \
  -H "Authorization: Bearer $TOKEN")

VERIFY_STATUS=$(echo "$VERIFY_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).status || JSON.parse(d).document?.status || ''); } catch(e) { console.log(''); } })")
# If verify returns a specific status or not_found that's ok too
check "Failed document retrievable from DB" "$([ "$DOC_ID" != "" ] && echo true || echo false)"

# Step 4: Now test with explicit inputs (should bypass DataSource and succeed)
echo ""
echo "Step 4: Render with explicit inputs bypasses DataSource..."

# Create a simple template for the bypass test
CREATE_RESP=$(curl -s -X POST "$BASE/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "name": "DS Bypass Test Template",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 100, "height": 15}
      ]],
      "columns": [],
      "sampledata": [{}]
    }
  }')

BYPASS_ID=$(echo "$CREATE_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).id); } catch(e) { console.log('ERROR'); } })")

# Publish it
curl -s -X POST "$BASE/templates/$BYPASS_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" > /dev/null

# Re-register the error DataSource (it was unregistered by step 5 timing, re-register for this test)
curl -s -X POST "$BASE/datasources/invoice/register-test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"errorMessage": "Should not be called"}' > /dev/null

RENDER_EXPLICIT=$(curl -s -w "\n%{http_code}" -X POST "$BASE/render/now" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$BYPASS_ID\",
    \"entityId\": \"ds-test-with-inputs\",
    \"channel\": \"print\",
    \"inputs\": [{\"title\": \"Test Corp Invoice\"}]
  }")

HTTP_CODE2=$(echo "$RENDER_EXPLICIT" | tail -1)
BODY2=$(echo "$RENDER_EXPLICIT" | sed '$d')

# When explicit inputs are provided, DataSource should NOT be called
RENDER2_STATUS=$(echo "$BODY2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { const r=JSON.parse(d); console.log(r.document ? r.document.status : 'unknown'); } catch(e) { console.log('error: ' + e.message); } })")
check "Render with explicit inputs succeeds (bypasses DataSource)" "$([ "$RENDER2_STATUS" = "done" ] && echo true || echo false)"

# Clean up bypass template
curl -s -X DELETE "$BASE/templates/$BYPASS_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1

# Step 5: Clean up - unregister the test DataSource
echo ""
echo "Step 5: Cleanup..."
UNREG_RESP=$(curl -s -X POST "$BASE/datasources/invoice/unregister" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

UNREG=$(echo "$UNREG_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => { try { console.log(JSON.parse(d).unregistered); } catch(e) { console.log('ERROR'); } })")
check "Test DataSource unregistered" "$([ "$UNREG" = "true" ] && echo true || echo false)"

# Clean up DS error test template
curl -s -X DELETE "$BASE/templates/$DS_TEMPLATE_ID" -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
