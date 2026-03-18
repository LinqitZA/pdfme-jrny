#!/bin/bash
# Test script for grouped table features #121, #122, #123
# Tests: groupBy rendering, subtotals, multi-level nesting

BASE_URL="http://localhost:3001/api/pdfme"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJvcmdJZCI6InRlc3Qtb3JnIiwicm9sZXMiOlsiYWRtaW4iXX0.fakesig"
PASS=0
FAIL=0

check() {
  local desc="$1" result="$2" expected="$3"
  if echo "$result" | grep -q "$expected"; then
    echo "  ✅ $desc"
    PASS=$((PASS+1))
  else
    echo "  ❌ $desc (expected: $expected)"
    echo "     Got: $(echo "$result" | head -5)"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Feature #121: Grouped table renders with groupBy ==="

# Test 1: Basic groupBy with single level
echo "Test 1: Basic groupBy with single level (category)"
RESULT=$(curl -s -X POST "$BASE_URL/grouped-table/render" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [
      {"key": "description", "header": "Description", "width": 60, "align": "left"},
      {"key": "quantity", "header": "Qty", "width": 20, "align": "right"},
      {"key": "amount", "header": "Amount", "width": 30, "align": "right", "aggregation": "SUM", "format": "#,##0.00"}
    ],
    "groupBy": ["category"],
    "data": [
      {"category": "Electronics", "description": "Laptop", "quantity": 2, "amount": 20000},
      {"category": "Electronics", "description": "Mouse", "quantity": 5, "amount": 500},
      {"category": "Furniture", "description": "Desk", "quantity": 1, "amount": 5000},
      {"category": "Furniture", "description": "Chair", "quantity": 3, "amount": 4500},
      {"category": "Stationery", "description": "Pens", "quantity": 100, "amount": 200}
    ]
  }')

check "Returns rows array" "$RESULT" '"rows"'
check "Has column header row" "$RESULT" '"columnHeader"'
check "Has group header for Electronics" "$RESULT" '"Electronics"'
check "Has group header for Furniture" "$RESULT" '"Furniture"'
check "Has group header for Stationery" "$RESULT" '"Stationery"'
check "Has data rows" "$RESULT" '"data"'
check "Has groupFooter rows" "$RESULT" '"groupFooter"'
check "Summary shows 3 groups" "$RESULT" '"category":3'
check "Summary shows 5 total rows" "$RESULT" '"totalRows":5'

echo ""
echo "Test 2: Verify group headers shown"
check "Group header type present" "$RESULT" '"groupHeader"'

echo ""
echo "Test 3: Verify rows grouped under correct headers"
# The tree structure should show correct grouping
check "Tree has Electronics group" "$RESULT" '"value":"Electronics"'
check "Tree has Furniture group" "$RESULT" '"value":"Furniture"'
check "Tree has Stationery group" "$RESULT" '"value":"Stationery"'

echo ""
echo "=== Feature #122: Grouped table subtotals per group ==="

echo "Test 4: Group footer with SUM subtotals"
check "Has subtotal rows" "$RESULT" '"groupFooter"'
check "Electronics subtotal 20500" "$RESULT" '20,500.00'
check "Furniture subtotal 9500" "$RESULT" '9,500.00'
check "Stationery subtotal 200" "$RESULT" '200.00'

echo ""
echo "Test 5: Grand total at bottom"
check "Has grand total row" "$RESULT" '"grandTotal"'
check "Grand total label" "$RESULT" '"Grand Total"'
check "Grand total 30200" "$RESULT" '30,200.00'

echo ""
echo "Test 6: Multiple aggregation types"
RESULT2=$(curl -s -X POST "$BASE_URL/grouped-table/render" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [
      {"key": "name", "header": "Name", "width": 40, "align": "left"},
      {"key": "score", "header": "Score", "width": 20, "align": "right", "aggregation": "AVG"},
      {"key": "count", "header": "Count", "width": 20, "align": "right", "aggregation": "COUNT"},
      {"key": "value", "header": "Max Value", "width": 20, "align": "right", "aggregation": "MAX"}
    ],
    "groupBy": ["region"],
    "data": [
      {"region": "North", "name": "A", "score": 80, "count": 10, "value": 100},
      {"region": "North", "name": "B", "score": 90, "count": 20, "value": 200},
      {"region": "South", "name": "C", "score": 70, "count": 15, "value": 150}
    ]
  }')

check "AVG aggregation works" "$RESULT2" '"rows"'
check "Has subtotal per group" "$RESULT2" '"groupFooter"'

echo ""
echo "=== Feature #123: Grouped table multi-level nesting ==="

echo "Test 7: 2-level nesting (region -> category)"
RESULT3=$(curl -s -X POST "$BASE_URL/grouped-table/render" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [
      {"key": "product", "header": "Product", "width": 40, "align": "left"},
      {"key": "qty", "header": "Qty", "width": 20, "align": "right", "aggregation": "SUM"},
      {"key": "revenue", "header": "Revenue", "width": 30, "align": "right", "aggregation": "SUM", "format": "#,##0.00"}
    ],
    "groupBy": ["region", "category"],
    "data": [
      {"region": "North", "category": "Electronics", "product": "Laptop", "qty": 5, "revenue": 50000},
      {"region": "North", "category": "Electronics", "product": "Phone", "qty": 10, "revenue": 30000},
      {"region": "North", "category": "Furniture", "product": "Desk", "qty": 3, "revenue": 9000},
      {"region": "South", "category": "Electronics", "product": "Tablet", "qty": 7, "revenue": 21000},
      {"region": "South", "category": "Stationery", "product": "Pens", "qty": 100, "revenue": 500}
    ]
  }')

check "2-level grouping works" "$RESULT3" '"rows"'
check "Level 0 group (North)" "$RESULT3" '"value":"North"'
check "Level 0 group (South)" "$RESULT3" '"value":"South"'
check "Level 1 group (Electronics)" "$RESULT3" '"value":"Electronics"'
check "Level 1 group (Furniture)" "$RESULT3" '"value":"Furniture"'
check "Has 2 group levels" "$RESULT3" '"groupLevels":2'
check "Subtotals at each level" "$RESULT3" '"groupFooter"'

echo ""
echo "Test 8: 3-level nesting (region -> category -> brand)"
RESULT4=$(curl -s -X POST "$BASE_URL/grouped-table/render" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [
      {"key": "product", "header": "Product", "width": 40, "align": "left"},
      {"key": "qty", "header": "Qty", "width": 20, "align": "right", "aggregation": "SUM"},
      {"key": "revenue", "header": "Revenue", "width": 30, "align": "right", "aggregation": "SUM", "format": "#,##0.00"}
    ],
    "groupBy": ["region", "category", "brand"],
    "data": [
      {"region": "North", "category": "Electronics", "brand": "Apple", "product": "MacBook", "qty": 3, "revenue": 45000},
      {"region": "North", "category": "Electronics", "brand": "Apple", "product": "iPad", "qty": 5, "revenue": 15000},
      {"region": "North", "category": "Electronics", "brand": "Dell", "product": "XPS", "qty": 2, "revenue": 20000},
      {"region": "North", "category": "Furniture", "brand": "IKEA", "product": "Desk", "qty": 3, "revenue": 9000},
      {"region": "South", "category": "Electronics", "brand": "Apple", "product": "iPhone", "qty": 10, "revenue": 30000},
      {"region": "South", "category": "Electronics", "brand": "Samsung", "product": "Galaxy", "qty": 8, "revenue": 24000},
      {"region": "South", "category": "Furniture", "brand": "Herman Miller", "product": "Chair", "qty": 2, "revenue": 16000}
    ]
  }')

check "3-level grouping works" "$RESULT4" '"rows"'
check "Has 3 group levels" "$RESULT4" '"groupLevels":3'
check "Level 0: region groups" "$RESULT4" '"value":"North"'
check "Level 1: category groups" "$RESULT4" '"value":"Electronics"'
check "Level 2: brand groups" "$RESULT4" '"value":"Apple"'
check "Level 2: brand Dell" "$RESULT4" '"value":"Dell"'
check "Level 2: brand Samsung" "$RESULT4" '"value":"Samsung"'
check "Subtotals at level 2" "$RESULT4" '"groupFooter"'

echo ""
echo "Test 9: Validate 4-level grouping rejected"
RESULT5=$(curl -s -X POST "$BASE_URL/grouped-table/render" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [{"key": "x", "header": "X", "width": 50}],
    "groupBy": ["a", "b", "c", "d"],
    "data": [{"a": 1, "b": 2, "c": 3, "d": 4, "x": "test"}]
  }')

check "4-level grouping rejected" "$RESULT5" 'Maximum 3 levels'

echo ""
echo "Test 10: PDF render works"
RESULT6=$(curl -s -X POST "$BASE_URL/grouped-table/pdf" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "columns": [
      {"key": "description", "header": "Description", "width": 60, "align": "left"},
      {"key": "amount", "header": "Amount", "width": 30, "align": "right", "aggregation": "SUM", "format": "#,##0.00"}
    ],
    "groupBy": ["category"],
    "data": [
      {"category": "Electronics", "description": "Laptop", "amount": 20000},
      {"category": "Furniture", "description": "Desk", "amount": 5000}
    ],
    "title": "Sales Report - Grouped"
  }')

check "PDF document created" "$RESULT6" '"document"'
check "PDF status is done" "$RESULT6" '"status":"done"'

echo ""
echo "=== RESULTS ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS+FAIL))"
