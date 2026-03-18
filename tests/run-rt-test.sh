#!/bin/bash
set -e

BASE_URL="http://localhost:3000/api/pdfme"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
AUTH="Authorization: Bearer $JWT"

TEMPLATE=$(curl -s -X POST "$BASE_URL/templates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "RT Quick Test",
    "type": "invoice",
    "schema": {
      "basePdf": {"width": 210, "height": 297, "padding": [10,10,10,10]},
      "schemas": [[
        {"name": "title", "type": "text", "position": {"x": 10, "y": 10}, "width": 190, "height": 20, "fontSize": 24},
        {"name": "richContent", "type": "richText", "position": {"x": 10, "y": 40}, "width": 190, "height": 100, "fontSize": 12}
      ]]
    }
  }')

echo "CREATE: $TEMPLATE"

TID=$(echo "$TEMPLATE" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{console.log(JSON.parse(d).id)}catch(e){console.log('ERROR: '+d)}})")
echo "TEMPLATE_ID: $TID"

PUB=$(curl -s -X POST "$BASE_URL/templates/$TID/publish" -H "$AUTH")
echo "PUBLISH: $PUB"

RENDER=$(curl -s -X POST "$BASE_URL/render/now" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TID\",
    \"entityId\": \"rt-quick-1\",
    \"channel\": \"print\",
    \"inputs\": [{
      \"title\": \"Rich Text Test\",
      \"richContent\": \"<b>Bold text</b> and <i>italic text</i> and <u>underlined</u>\"
    }]
  }")

echo "RENDER: $RENDER"
