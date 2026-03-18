#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
PORT="${1:-3005}"
BASE="http://localhost:$PORT/api/pdfme"
TEMPLATE_ID="gowr8vszbk3f3ph33hmtxbyj"

LINE_ITEMS_JSON='[{"description":"Widget A","qty":10,"unitPrice":100.00,"total":1000.00},{"description":"Widget B","qty":5,"unitPrice":200.00,"total":1000.00},{"description":"Gadget C","qty":3,"unitPrice":50.00,"total":150.00},{"description":"Service D","qty":1,"unitPrice":500.00,"total":500.00},{"description":"Part E","qty":20,"unitPrice":25.00,"total":500.00}]'

ESCAPED_LINE_ITEMS=$(echo "$LINE_ITEMS_JSON" | sed 's/"/\\"/g')

echo "Rendering PDF with 5 line items..."
RESULT=$(curl -s -X POST "$BASE/render/now" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"templateId\":\"$TEMPLATE_ID\",\"entityId\":\"test-entity-116\",\"channel\":\"download\",\"inputs\":[{\"lineItems\":\"$ESCAPED_LINE_ITEMS\"}]}")

echo "$RESULT"
