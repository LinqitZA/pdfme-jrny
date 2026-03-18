#!/bin/bash
# Test Feature #135: Filter order: pageScope then conditions then channel
# Verifies filters are applied in correct sequence: pageScope -> conditions -> channel

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

echo "=== Feature #135: Filter order: pageScope -> conditions -> channel ==="
echo ""

# Create a multi-page template with overlapping pageScope, condition, and outputChannel
# Page 1 has elements with all three filter types
# Page 2 has elements with overlapping filters
# Page 3 has elements to verify sequence

echo "--- Step 1: Create template with overlapping scope, condition, channel ---"

TEMPLATE_BODY='{
  "name": "filter-order-test",
  "type": "invoice",
  "schema": {
    "basePdf": { "width": 210, "height": 297, "padding": [10, 10, 10, 10] },
    "schemas": [
      [
        {
          "name": "header_all",
          "type": "text",
          "pageScope": "all",
          "outputChannel": "both",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 10
        },
        {
          "name": "first_only_email",
          "type": "text",
          "pageScope": "first",
          "outputChannel": "email",
          "position": { "x": 10, "y": 25 },
          "width": 100,
          "height": 10
        },
        {
          "name": "first_only_print",
          "type": "text",
          "pageScope": "first",
          "outputChannel": "print",
          "position": { "x": 10, "y": 40 },
          "width": 100,
          "height": 10
        },
        {
          "name": "conditional_email",
          "type": "text",
          "outputChannel": "email",
          "condition": { "type": "fieldNonEmpty", "field": "showDiscount" },
          "position": { "x": 10, "y": 55 },
          "width": 100,
          "height": 10
        },
        {
          "name": "last_only_both",
          "type": "text",
          "pageScope": "last",
          "outputChannel": "both",
          "position": { "x": 10, "y": 70 },
          "width": 100,
          "height": 10
        }
      ],
      [
        {
          "name": "header_all_p2",
          "type": "text",
          "pageScope": "all",
          "outputChannel": "both",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 10
        },
        {
          "name": "notFirst_email_p2",
          "type": "text",
          "pageScope": "notFirst",
          "outputChannel": "email",
          "position": { "x": 10, "y": 25 },
          "width": 100,
          "height": 10
        },
        {
          "name": "first_only_p2",
          "type": "text",
          "pageScope": "first",
          "position": { "x": 10, "y": 40 },
          "width": 100,
          "height": 10
        },
        {
          "name": "conditional_print_p2",
          "type": "text",
          "outputChannel": "print",
          "condition": { "type": "fieldNonEmpty", "field": "showVAT" },
          "position": { "x": 10, "y": 55 },
          "width": 100,
          "height": 10
        }
      ],
      [
        {
          "name": "header_all_p3",
          "type": "text",
          "pageScope": "all",
          "outputChannel": "both",
          "position": { "x": 10, "y": 10 },
          "width": 100,
          "height": 10
        },
        {
          "name": "last_email_conditional_p3",
          "type": "text",
          "pageScope": "last",
          "outputChannel": "email",
          "condition": { "type": "fieldNonEmpty", "field": "showFooter" },
          "position": { "x": 10, "y": 25 },
          "width": 100,
          "height": 10
        },
        {
          "name": "notFirst_print_p3",
          "type": "text",
          "pageScope": "notFirst",
          "outputChannel": "print",
          "position": { "x": 10, "y": 40 },
          "width": 100,
          "height": 10
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

# Publish
PUB=$(curl -s -X POST "$BASE/templates/$TMPL_ID/publish" -H "$AUTH" -H "$CT")
check "Template published" "$PUB" '"published"'

# Test 1: Render with email channel + showDiscount set + showFooter set
echo ""
echo "--- Test 1: Email channel, conditional fields present ---"

RENDER1=$(curl -s -X POST "$BASE/render/now" \
  -H "$AUTH" -H "$CT" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityId\": \"order-1\",
    \"channel\": \"email\",
    \"inputs\": [{
      \"header_all\": \"Header\",
      \"first_only_email\": \"Email Logo\",
      \"first_only_print\": \"Print Logo\",
      \"conditional_email\": \"10% OFF\",
      \"last_only_both\": \"Footer\",
      \"header_all_p2\": \"Header P2\",
      \"notFirst_email_p2\": \"Email P2 Banner\",
      \"first_only_p2\": \"SHOULD NOT APPEAR\",
      \"conditional_print_p2\": \"VAT Info\",
      \"header_all_p3\": \"Header P3\",
      \"last_email_conditional_p3\": \"Email Footer\",
      \"notFirst_print_p3\": \"Print P3 Banner\",
      \"showDiscount\": \"yes\",
      \"showVAT\": \"yes\",
      \"showFooter\": \"yes\"
    }]
  }")

check "Email render with conditions succeeds" "$RENDER1" '"status":"done"'

# Test 2: Render with print channel + same conditions
echo ""
echo "--- Test 2: Print channel, conditional fields present ---"

RENDER2=$(curl -s -X POST "$BASE/render/now" \
  -H "$AUTH" -H "$CT" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityId\": \"order-2\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"header_all\": \"Header\",
      \"first_only_email\": \"Email Logo\",
      \"first_only_print\": \"Print Logo\",
      \"conditional_email\": \"10% OFF\",
      \"last_only_both\": \"Footer\",
      \"header_all_p2\": \"Header P2\",
      \"notFirst_email_p2\": \"Email P2 Banner\",
      \"first_only_p2\": \"SHOULD NOT APPEAR\",
      \"conditional_print_p2\": \"VAT Info\",
      \"header_all_p3\": \"Header P3\",
      \"last_email_conditional_p3\": \"Email Footer\",
      \"notFirst_print_p3\": \"Print P3 Banner\",
      \"showDiscount\": \"yes\",
      \"showVAT\": \"yes\",
      \"showFooter\": \"yes\"
    }]
  }")

check "Print render with conditions succeeds" "$RENDER2" '"status":"done"'

# Test 3: Different PDFs for email vs print (different elements included)
HASH1=$(echo "$RENDER1" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")
HASH2=$(echo "$RENDER2" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")

if [ "$HASH1" != "$HASH2" ] && [ "$HASH1" != "PARSE_ERROR" ]; then
  echo "  PASS: Email and print PDFs differ with overlapping filters"
  PASS=$((PASS+1))
else
  echo "  FAIL: Email and print PDFs should differ"
  FAIL=$((FAIL+1))
fi

# Test 4: Render with email channel + conditions NOT met
echo ""
echo "--- Test 3: Email channel, conditions NOT met ---"

RENDER3=$(curl -s -X POST "$BASE/render/now" \
  -H "$AUTH" -H "$CT" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityId\": \"order-3\",
    \"channel\": \"email\",
    \"inputs\": [{
      \"header_all\": \"Header\",
      \"first_only_email\": \"Email Logo\",
      \"first_only_print\": \"Print Logo\",
      \"conditional_email\": \"10% OFF\",
      \"last_only_both\": \"Footer\",
      \"header_all_p2\": \"Header P2\",
      \"notFirst_email_p2\": \"Email P2 Banner\",
      \"first_only_p2\": \"SHOULD NOT APPEAR\",
      \"conditional_print_p2\": \"VAT Info\",
      \"header_all_p3\": \"Header P3\",
      \"last_email_conditional_p3\": \"Email Footer\",
      \"notFirst_print_p3\": \"Print P3 Banner\",
      \"showDiscount\": \"\",
      \"showVAT\": \"\",
      \"showFooter\": \"\"
    }]
  }")

check "Email render with conditions NOT met succeeds" "$RENDER3" '"status":"done"'

# The conditional_email should be filtered out (condition not met), so different hash
HASH3=$(echo "$RENDER3" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).document.pdfHash)}catch{console.log('PARSE_ERROR')}})")

if [ "$HASH1" != "$HASH3" ] && [ "$HASH3" != "PARSE_ERROR" ]; then
  echo "  PASS: Email with conditions met vs not met produce different PDFs"
  PASS=$((PASS+1))
else
  echo "  FAIL: Condition filter should change output"
  FAIL=$((FAIL+1))
fi

# Test 5: Verify the pipeline code order is correct by reading the source
echo ""
echo "--- Test 4: Verify code order in render.service.ts ---"

# Check that resolvePageScopes comes before resolveConditions,
# and resolveConditions comes before resolveOutputChannels
PIPE_ORDER=$(grep -n 'resolvePageScopes\|resolveConditions\|resolveOutputChannels' nest-module/src/render.service.ts | head -6)
echo "  Pipeline order in source:"
echo "$PIPE_ORDER" | while IFS= read -r line; do echo "    $line"; done

# Extract line numbers
LINE_PS=$(echo "$PIPE_ORDER" | grep 'this.resolvePageScopes' | head -1 | cut -d: -f1)
LINE_RC=$(echo "$PIPE_ORDER" | grep 'this.resolveConditions' | head -1 | cut -d: -f1)
LINE_OC=$(echo "$PIPE_ORDER" | grep 'this.resolveOutputChannels' | head -1 | cut -d: -f1)

if [ -n "$LINE_PS" ] && [ -n "$LINE_RC" ] && [ -n "$LINE_OC" ]; then
  if [ "$LINE_PS" -lt "$LINE_RC" ] && [ "$LINE_RC" -lt "$LINE_OC" ]; then
    echo "  PASS: resolvePageScopes (L$LINE_PS) < resolveConditions (L$LINE_RC) < resolveOutputChannels (L$LINE_OC)"
    PASS=$((PASS+1))
  else
    echo "  FAIL: Wrong order - PS:$LINE_PS RC:$LINE_RC OC:$LINE_OC"
    FAIL=$((FAIL+1))
  fi
else
  echo "  FAIL: Could not find all three filter methods"
  FAIL=$((FAIL+1))
fi

# Test 6: Verify all three methods exist as private methods
echo ""
echo "--- Test 5: Verify all three filter methods exist ---"

check "resolvePageScopes method exists" "$(grep 'private resolvePageScopes' nest-module/src/render.service.ts)" "resolvePageScopes"
check "resolveConditions method exists" "$(grep 'private resolveConditions' nest-module/src/render.service.ts)" "resolveConditions"
check "resolveOutputChannels method exists" "$(grep 'private resolveOutputChannels' nest-module/src/render.service.ts)" "resolveOutputChannels"

echo ""
echo "==============================="
echo "Results: $PASS passed, $FAIL failed"
echo "==============================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
