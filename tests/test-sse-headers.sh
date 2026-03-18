#!/bin/bash
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"

# Use the existing completed batch
BATCH_ID="pa21dczsytrbq48rf18vwm8j"

echo "=== SSE Response Headers ==="
curl -s -D - --max-time 5 \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: text/event-stream" \
  "http://localhost:3001/api/pdfme/render/batch/$BATCH_ID/progress" 2>&1
echo ""
