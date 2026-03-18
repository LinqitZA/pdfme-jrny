#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
TMPL_ID="zchyjhvtltr46gfi3y62w8uw"

# Start a bulk render
BULK=$(curl -s -X POST http://localhost:3001/api/pdfme/render/bulk \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"templateId\": \"$TMPL_ID\",
    \"entityIds\": [\"sse-test-1\", \"sse-test-2\", \"sse-test-3\"],
    \"channel\": \"print\",
    \"entityType\": \"invoice\"
  }")
echo "Bulk response: $BULK"
BATCH_ID=$(echo "$BULK" | python3 -c "import sys,json; print(json.load(sys.stdin)['batchId'])")
echo "Batch ID: $BATCH_ID"

# Wait for completion
sleep 3

# Test SSE on completed batch
echo ""
echo "=== SSE on completed batch ==="
curl -s -N --max-time 5 \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: text/event-stream" \
  "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID/progress" 2>&1 || true

echo ""
echo ""
echo "=== Batch status ==="
curl -s "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID" \
  -H "Authorization: Bearer $JWT"
echo ""
