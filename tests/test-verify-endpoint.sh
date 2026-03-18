#!/bin/bash
# Test script for Feature #146: Render verify endpoint checks hash
set -e

BASE_URL="http://localhost:3001/api/pdfme"
PASS=0
FAIL=0

# Generate JWT token (dev mode - base64 decode only, no signature verification)
HEADER=$(node -p "Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')")
PAYLOAD=$(node -p "Buffer.from(JSON.stringify({sub:'user-verify-test',orgId:'org-verify-test',roles:['template:edit','template:publish','render:trigger']})).toString('base64url')")
TOKEN="${HEADER}.${PAYLOAD}.devsig"

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1))
    echo "  PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "  FAIL: $desc (expected=$expected, actual=$actual)"
  fi
}

assert_contains() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    PASS=$((PASS+1))
    echo "  PASS: $desc"
  else
    FAIL=$((FAIL+1))
    echo "  FAIL: $desc (expected to contain '$expected', got '$actual')"
  fi
}

echo "=== Feature #146: Render verify endpoint checks hash ==="
echo ""

# Step 1: Create a template
echo "Step 1: Create template..."
TEMPLATE_RESP=$(curl -s -X POST "$BASE_URL/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "name": "Verify Test Template",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[{"name": "title", "type": "text", "position": {"x": 20, "y": 20}, "width": 100, "height": 10}]]
    }
  }')
TEMPLATE_ID=$(node -p "JSON.parse(process.argv[1]).id" "$TEMPLATE_RESP")
echo "  Template ID: $TEMPLATE_ID"

# Step 2: Publish template
echo "Step 2: Publish template..."
curl -s -X PUT "$BASE_URL/templates/$TEMPLATE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# Step 3: Render a document
echo "Step 3: Render document..."
RENDER_RESP=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TEMPLATE_ID\",
    \"entityId\": \"entity-verify-001\",
    \"channel\": \"email\",
    \"inputs\": [{\"title\": \"Verify Test Document\"}]
  }")
DOC_ID=$(node -p "JSON.parse(process.argv[1]).document.id" "$RENDER_RESP")
DOC_HASH=$(node -p "JSON.parse(process.argv[1]).document.pdfHash" "$RENDER_RESP")
DOC_PATH=$(node -p "JSON.parse(process.argv[1]).document.filePath" "$RENDER_RESP")
echo "  Document ID: $DOC_ID"
echo "  Document hash: ${DOC_HASH:0:16}..."
echo "  File path: $DOC_PATH"

# Step 4: Verify integrity (should pass)
echo ""
echo "Step 4: GET verify/:documentId — integrity should be confirmed..."
VERIFY_RESP=$(curl -s "$BASE_URL/render/verify/$DOC_ID" \
  -H "Authorization: Bearer $TOKEN")
echo "  Response: $VERIFY_RESP"

VERIFIED=$(node -p "JSON.parse(process.argv[1]).verified" "$VERIFY_RESP")
STATUS=$(node -p "JSON.parse(process.argv[1]).status" "$VERIFY_RESP")
assert_eq "verified=true" "true" "$VERIFIED"
assert_eq "status=intact" "intact" "$STATUS"
assert_contains "message confirms integrity" "integrity confirmed" "$VERIFY_RESP"
assert_contains "storedHash present" "storedHash" "$VERIFY_RESP"
assert_contains "currentHash present" "currentHash" "$VERIFY_RESP"

# Step 5: Tamper with PDF on disk
echo ""
echo "Step 5: Modify PDF on disk (tamper)..."
STORAGE_ROOT="storage"
FULL_PATH="$STORAGE_ROOT/$DOC_PATH"
echo "  Tampering with: $FULL_PATH"
# Append some bytes to the PDF to change its hash
echo "TAMPERED_DATA" >> "$FULL_PATH"

# Step 6: Verify integrity again (should detect tamper)
echo ""
echo "Step 6: GET verify/:documentId — should detect tamper..."
VERIFY_RESP2=$(curl -s "$BASE_URL/render/verify/$DOC_ID" \
  -H "Authorization: Bearer $TOKEN")
echo "  Response: $VERIFY_RESP2"

VERIFIED2=$(node -p "JSON.parse(process.argv[1]).verified" "$VERIFY_RESP2")
STATUS2=$(node -p "JSON.parse(process.argv[1]).status" "$VERIFY_RESP2")
assert_eq "verified=false after tamper" "false" "$VERIFIED2"
assert_eq "status=tampered" "tampered" "$STATUS2"
assert_contains "message detects tamper" "tamper detected" "$VERIFY_RESP2"

# Step 7: Verify non-existent document returns 404
echo ""
echo "Step 7: GET verify with non-existent ID — should return 404..."
VERIFY_404=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/render/verify/non-existent-id" \
  -H "Authorization: Bearer $TOKEN")
assert_eq "404 for non-existent document" "404" "$VERIFY_404"

# Step 8: Verify storedHash != currentHash after tamper
echo ""
echo "Step 8: Hashes differ after tamper..."
STORED_HASH=$(node -p "JSON.parse(process.argv[1]).storedHash" "$VERIFY_RESP2")
CURRENT_HASH=$(node -p "JSON.parse(process.argv[1]).currentHash" "$VERIFY_RESP2")
if [ "$STORED_HASH" != "$CURRENT_HASH" ]; then
  PASS=$((PASS+1))
  echo "  PASS: storedHash != currentHash"
else
  FAIL=$((FAIL+1))
  echo "  FAIL: storedHash == currentHash (both: $STORED_HASH)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
exit $FAIL
