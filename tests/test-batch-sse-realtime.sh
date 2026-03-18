#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
TMPL_ID="zchyjhvtltr46gfi3y62w8uw"

# Start a bulk render with more entities to give us time to connect SSE
BULK=$(curl -s -X POST http://localhost:3001/api/pdfme/render/bulk \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityIds\": [\"rt-1\", \"rt-2\", \"rt-3\", \"rt-4\", \"rt-5\"],
    \"channel\": \"email\",
    \"entityType\": \"invoice\"
  }")
echo "Bulk response: $BULK"
BATCH_ID=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
echo "Batch ID: $BATCH_ID"

# Connect SSE immediately (batch may still be running)
echo ""
echo "=== SSE real-time events ==="
timeout 15 curl -s -N \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: text/event-stream" \
  "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID/progress" 2>&1

echo ""
echo "=== Final batch status ==="
curl -s "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID" \
  -H "Authorization: Bearer $JWT"
echo ""
