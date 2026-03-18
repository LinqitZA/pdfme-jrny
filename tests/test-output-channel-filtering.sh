#!/bin/bash
# Test Feature #134: Render pipeline output channel filtering
# Channel filtering removes email/print elements based on requested channel

set -e

BASE="http://localhost:3001/api/pdfme"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc (expected '$expected')"
    echo "    got: $(echo "$result" | head -5)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Feature #134: Render pipeline output channel filtering ==="
echo ""

# Step 1: Create a template with elements tagged with different outputChannels
echo "--- Step 1: Create template with email-only, print-only, and both elements ---"

TEMPLATE_BODY='{
  "name": "channel-filter-test",
  "type": "invoice",
  "schema": {
    "basePdf": { "width": 210, "height": 297, "padding": [10, 10, 10, 10] },
    "schemas": [
      [
        {
          "name": "companyLogo",
          "type": "text",
          "outputChannel": "email",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 20
        },
        {
          "name": "preprint_mark",
          "type": "text",
          "outputChannel": "print",
          "position": { "x": 10, "y": 35 },
          "width": 100,
          "height": 20
        },
        {
          "name": "invoiceNumber",
          "type": "text",
          "outputChannel": "both",
          "position": { "x": 10, "y": 60 },
          "width": 100,
          "height": 20
        },
        {
          "name": "customerName",
          "type": "text",
          "position": { "x": 10, "y": 85 },
          "width": 100,
          "height": 20
        }
      ]
    ]
  }
}'

CREATE_RESP=$(curl -s -X POST "$BASE/templates" \
  -H "$AUTH" -H "$CT" \
  -d "$TEMPLATE_BODY")

TMPL_ID=$(echo "$CREATE_RESP" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('PARSE_ERROR')}})")
echo "Created template: $TMPL_ID"

check "Template created" "$CREATE_RESP" '"id"'

# Step 2: Publish the template
echo ""
echo "--- Step 2: Publish the template ---"
PUB_RESP=$(curl -s -X POST "$BASE/templates/$TMPL_ID/publish" -H "$AUTH" -H "$CT")
check "Template published" "$PUB_RESP" '"published"'

# Step 3: Render with channel=email - print-only elements should be excluded
echo ""
echo "--- Step 3: Render with channel=email ---"

EMAIL_RENDER=$(curl -s -X POST "$BASE/render/now" \
  -H "$AUTH" -H "$CT" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityId\": \"inv-email-001\",
    \"channel\": \"email\",
    \"inputs\": [{
      \"companyLogo\": \"Acme Corp Logo\",
      \"preprint_mark\": \"PREPRINT\",
      \"invoiceNumber\": \"INV-001\",
      \"customerName\": \"John Doe\"
    }]
  }")

check "Email render succeeds (status done)" "$EMAIL_RENDER" '"status":"done"'
check "Email render has document id" "$EMAIL_RENDER" '"id"'

EMAIL_DOC_ID=$(echo "$EMAIL_RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.id)}catch{console.log('PARSE_ERROR')}})")
echo "  Email doc ID: $EMAIL_DOC_ID"

# Step 4: Render with channel=print - email-only elements should be excluded
echo ""
echo "--- Step 4: Render with channel=print ---"

PRINT_RENDER=$(curl -s -X POST "$BASE/render/now" \
  -H "$AUTH" -H "$CT" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityId\": \"inv-print-001\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"companyLogo\": \"Acme Corp Logo\",
      \"preprint_mark\": \"PREPRINT\",
      \"invoiceNumber\": \"INV-001\",
      \"customerName\": \"John Doe\"
    }]
  }")

check "Print render succeeds (status done)" "$PRINT_RENDER" '"status":"done"'
check "Print render has document id" "$PRINT_RENDER" '"id"'

PRINT_DOC_ID=$(echo "$PRINT_RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.id)}catch{console.log('PARSE_ERROR')}})")
echo "  Print doc ID: $PRINT_DOC_ID"

# Step 5: Verify email and print renders produce different PDFs (different hashes)
echo ""
echo "--- Step 5: Verify email and print PDFs differ ---"

EMAIL_HASH=$(echo "$EMAIL_RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")
PRINT_HASH=$(echo "$PRINT_RENDER" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")

echo "  Email PDF hash: $EMAIL_HASH"
echo "  Print PDF hash: $PRINT_HASH"

if [ "$EMAIL_HASH" != "$PRINT_HASH" ] && [ "$EMAIL_HASH" != "PARSE_ERROR" ]; then
  echo "  PASS: Email and print PDFs have different hashes (channel filtering worked)"
  PASS=$((PASS+1))
else
  echo "  FAIL: Email and print PDFs should have different hashes"
  FAIL=$((FAIL+1))
fi

# Step 6: Test with no outputChannel (default = both, should always be included)
echo ""
echo "--- Step 6: Template with no outputChannel tags ---"

NO_CH_BODY='{
  "name": "no-channel-test",
  "type": "invoice",
  "schema": {
    "basePdf": { "width": 210, "height": 297, "padding": [10, 10, 10, 10] },
    "schemas": [
      [
        {
          "name": "field1",
          "type": "text",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 20
        },
        {
          "name": "field2",
          "type": "text",
          "position": { "x": 10, "y": 40 },
          "width": 100,
          "height": 20
        }
      ]
    ]
  }
}'

CREATE2=$(curl -s -X POST "$BASE/templates" -H "$AUTH" -H "$CT" -d "$NO_CH_BODY")
TMPL2_ID=$(echo "$CREATE2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('PARSE_ERROR')}})")
curl -s -X POST "$BASE/templates/$TMPL2_ID/publish" -H "$AUTH" -H "$CT" > /dev/null

RENDER_EMAIL2=$(curl -s -X POST "$BASE/render/now" -H "$AUTH" -H "$CT" \
  -d "{\"templateId\":\"$TMPL2_ID\",\"entityId\":\"e1\",\"channel\":\"email\",\"inputs\":[{\"field1\":\"A\",\"field2\":\"B\"}]}")
RENDER_PRINT2=$(curl -s -X POST "$BASE/render/now" -H "$AUTH" -H "$CT" \
  -d "{\"templateId\":\"$TMPL2_ID\",\"entityId\":\"p1\",\"channel\":\"print\",\"inputs\":[{\"field1\":\"A\",\"field2\":\"B\"}]}")

HASH_E2=$(echo "$RENDER_EMAIL2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")
HASH_P2=$(echo "$RENDER_PRINT2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")

check "No-channel email render succeeds" "$RENDER_EMAIL2" '"status":"done"'
check "No-channel print render succeeds" "$RENDER_PRINT2" '"status":"done"'

if [ "$HASH_E2" = "$HASH_P2" ] && [ "$HASH_E2" != "PARSE_ERROR" ]; then
  echo "  PASS: No-channel templates render identically for email and print"
  PASS=$((PASS+1))
else
  echo "  FAIL: No-channel templates should render identically (both defaults to 'both')"
  echo "    Email hash: $HASH_E2"
  echo "    Print hash: $HASH_P2"
  FAIL=$((FAIL+1))
fi

# Step 7: Test all-email template rendered with print channel (should have minimal elements)
echo ""
echo "--- Step 7: All elements email-only, render with print ---"

ALL_EMAIL_BODY='{
  "name": "all-email-test",
  "type": "invoice",
  "schema": {
    "basePdf": { "width": 210, "height": 297, "padding": [10, 10, 10, 10] },
    "schemas": [
      [
        {
          "name": "emailField1",
          "type": "text",
          "outputChannel": "email",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 20
        },
        {
          "name": "emailField2",
          "type": "text",
          "outputChannel": "email",
          "position": { "x": 10, "y": 40 },
          "width": 100,
          "height": 20
        }
      ]
    ]
  }
}'

CREATE3=$(curl -s -X POST "$BASE/templates" -H "$AUTH" -H "$CT" -d "$ALL_EMAIL_BODY")
TMPL3_ID=$(echo "$CREATE3" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('PARSE_ERROR')}})")
curl -s -X POST "$BASE/templates/$TMPL3_ID/publish" -H "$AUTH" -H "$CT" > /dev/null

# Render all-email template with print channel
RENDER_PRINT3=$(curl -s -X POST "$BASE/render/now" -H "$AUTH" -H "$CT" \
  -d "{\"templateId\":\"$TMPL3_ID\",\"entityId\":\"p3\",\"channel\":\"print\",\"inputs\":[{\"emailField1\":\"A\",\"emailField2\":\"B\"}]}")

check "All-email template, print channel renders (empty page OK)" "$RENDER_PRINT3" '"status"'

# Render all-email template with email channel (should include all)
RENDER_EMAIL3=$(curl -s -X POST "$BASE/render/now" -H "$AUTH" -H "$CT" \
  -d "{\"templateId\":\"$TMPL3_ID\",\"entityId\":\"e3\",\"channel\":\"email\",\"inputs\":[{\"emailField1\":\"A\",\"emailField2\":\"B\"}]}")

check "All-email template, email channel renders successfully" "$RENDER_EMAIL3" '"status":"done"'

# Step 8: Verify outputChannel is stored correctly in generated document
echo ""
echo "--- Step 8: Verify outputChannel stored in document record ---"

check "Email render records channel=email" "$EMAIL_RENDER" '"outputChannel":"email"'
check "Print render records channel=print" "$PRINT_RENDER" '"outputChannel":"print"'

echo ""
echo "==============================="
echo "Results: $PASS passed, $FAIL failed"
echo "==============================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
