import React, { useState, useCallback, useMemo } from 'react';
import { theme, Typography, Input, Tag, Tooltip, Tabs, Collapse } from 'antd';
import { Calculator, ChevronDown, ChevronRight, Play, Zap, Copy, Check } from 'lucide-react';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';
import { useFieldPalette } from '../../../../contexts/FieldPaletteContext.js';

const { Text } = Typography;
const { TextArea } = Input;

// ---- Function catalogue ----

interface FunctionDef {
  name: string;
  signature: string;
  description: string;
  example: string;
}

interface FunctionCategory {
  key: string;
  label: string;
  functions: FunctionDef[];
}

const FUNCTION_CATALOGUE: FunctionCategory[] = [
  {
    key: 'string',
    label: 'String',
    functions: [
      { name: 'CONCAT', signature: 'CONCAT(a, b, ...)', description: 'Join strings together', example: 'CONCAT(firstName, " ", lastName)' },
      { name: 'LEFT', signature: 'LEFT(str, n)', description: 'First n characters', example: 'LEFT(code, 3)' },
      { name: 'RIGHT', signature: 'RIGHT(str, n)', description: 'Last n characters', example: 'RIGHT(phone, 4)' },
      { name: 'MID', signature: 'MID(str, start, len)', description: 'Substring (1-based)', example: 'MID(code, 2, 4)' },
      { name: 'UPPER', signature: 'UPPER(str)', description: 'Convert to uppercase', example: 'UPPER(name)' },
      { name: 'LOWER', signature: 'LOWER(str)', description: 'Convert to lowercase', example: 'LOWER(email)' },
      { name: 'TRIM', signature: 'TRIM(str)', description: 'Remove whitespace', example: 'TRIM(address)' },
      { name: 'LEN', signature: 'LEN(str)', description: 'String length', example: 'LEN(description)' },
    ],
  },
  {
    key: 'math',
    label: 'Math',
    functions: [
      { name: 'ROUND', signature: 'ROUND(val, decimals)', description: 'Round to decimals', example: 'ROUND(total, 2)' },
      { name: 'ABS', signature: 'ABS(val)', description: 'Absolute value', example: 'ABS(balance)' },
      { name: 'FLOOR', signature: 'FLOOR(val)', description: 'Round down', example: 'FLOOR(qty)' },
      { name: 'CEIL', signature: 'CEIL(val)', description: 'Round up', example: 'CEIL(qty)' },
      { name: 'MIN', signature: 'MIN(a, b, ...)', description: 'Smallest value', example: 'MIN(price, maxPrice)' },
      { name: 'MAX', signature: 'MAX(a, b, ...)', description: 'Largest value', example: 'MAX(qty, minQty)' },
      { name: 'SUM', signature: 'SUM(a, b, ...)', description: 'Sum all values', example: 'SUM(line1, line2, line3)' },
    ],
  },
  {
    key: 'date',
    label: 'Date',
    functions: [
      { name: 'TODAY', signature: 'TODAY()', description: 'Current date', example: 'TODAY()' },
      { name: 'FORMAT', signature: 'FORMAT(date, pattern)', description: 'Format date', example: 'FORMAT(invoiceDate, "dd MMM yyyy")' },
      { name: 'DATEDIFF', signature: 'DATEDIFF(d1, d2)', description: 'Days between dates', example: 'DATEDIFF(dueDate, TODAY())' },
    ],
  },
  {
    key: 'logic',
    label: 'Logic',
    functions: [
      { name: 'IF', signature: 'IF(cond, trueVal, falseVal)', description: 'Conditional value', example: 'IF(total > 1000, "Large", "Small")' },
      { name: 'AND', signature: 'AND(a, b, ...)', description: 'All true', example: 'AND(qty > 0, price > 0)' },
      { name: 'OR', signature: 'OR(a, b, ...)', description: 'Any true', example: 'OR(status == "paid", status == "partial")' },
      { name: 'NOT', signature: 'NOT(val)', description: 'Negate', example: 'NOT(isVoid)' },
      { name: 'SWITCH', signature: 'SWITCH(expr, c1, v1, ..., default)', description: 'Multi-way match', example: 'SWITCH(type, "A", 10, "B", 20, 0)' },
    ],
  },
  {
    key: 'format',
    label: 'Format',
    functions: [
      { name: 'FORMAT_CURRENCY', signature: 'FORMAT_CURRENCY(val)', description: 'Currency format (locale-aware)', example: 'FORMAT_CURRENCY(total)' },
      { name: 'FORMAT_DATE', signature: 'FORMAT_DATE(val)', description: 'Date format (locale-aware)', example: 'FORMAT_DATE(invoiceDate)' },
      { name: 'FORMAT_NUMBER', signature: 'FORMAT_NUMBER(val)', description: 'Number format (locale-aware)', example: 'FORMAT_NUMBER(qty)' },
      { name: 'FORMAT', signature: 'FORMAT(val, pattern)', description: 'Custom format pattern', example: 'FORMAT(amount, "#,##0.00")' },
    ],
  },
];

// ---- Common expression templates ----

interface ExpressionTemplate {
  name: string;
  expression: string;
  format?: string;
  description: string;
}

const EXPRESSION_TEMPLATES: ExpressionTemplate[] = [
  {
    name: 'Total with VAT',
    expression: 'subtotal * 1.15',
    format: '#,##0.00',
    description: 'Adds 15% VAT to subtotal',
  },
  {
    name: 'VAT Amount',
    expression: 'subtotal * 0.15',
    format: '#,##0.00',
    description: 'Calculates 15% VAT',
  },
  {
    name: 'Discount Amount',
    expression: 'total * (discountPercent / 100)',
    format: '#,##0.00',
    description: 'Percentage-based discount',
  },
  {
    name: 'Full Address',
    expression: 'CONCAT(addressLine1, ", ", city, " ", postalCode)',
    description: 'Concatenate address fields',
  },
  {
    name: 'Full Name',
    expression: 'CONCAT(firstName, " ", lastName)',
    description: 'First and last name',
  },
  {
    name: 'Date Formatted',
    expression: 'FORMAT(invoiceDate, "dd MMM yyyy")',
    description: 'Format as "01 Jan 2026"',
  },
  {
    name: 'Conditional Label',
    expression: 'IF(balance > 0, "Amount Due", "Paid in Full")',
    description: 'Show label based on balance',
  },
  {
    name: 'Days Overdue',
    expression: 'DATEDIFF(TODAY(), dueDate)',
    description: 'Days since due date',
  },
];

// ---- Component ----

interface ExpressionBuilderWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

const ExpressionBuilderWidget: React.FC<ExpressionBuilderWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [copiedFn, setCopiedFn] = useState<string | null>(null);

  const { fieldGroups, hasFields } = useFieldPalette();

  // Only show for calculatedField or currencyField schema types
  const schemaType = activeSchema.type;
  const isExpressionType = schemaType === 'calculatedField' || schemaType === 'currencyField';
  if (!isExpressionType) return null;

  // Read current expression from schema
  const expression = String(
    (activeSchema as Record<string, unknown>).expression ?? '',
  );
  const format = String(
    (activeSchema as Record<string, unknown>).format ?? '',
  );

  /** Update expression on schema */
  const handleExpressionChange = useCallback(
    (newExpr: string) => {
      changeSchemas([
        { key: 'expression', value: newExpr, schemaId: activeSchema.id },
      ]);
    },
    [changeSchemas, activeSchema.id],
  );

  /** Insert function name into expression at cursor (append) */
  const insertFunction = useCallback(
    (fn: FunctionDef) => {
      const toInsert = fn.name + '(';
      const newExpr = expression ? expression + ' ' + toInsert : toInsert;
      handleExpressionChange(newExpr);
      // Brief visual feedback
      setCopiedFn(fn.name);
      setTimeout(() => setCopiedFn(null), 1200);
    },
    [expression, handleExpressionChange],
  );

  /** Insert field reference {{field.key}} into expression */
  const insertFieldRef = useCallback(
    (fieldKey: string) => {
      const newExpr = expression ? expression + ' ' + fieldKey : fieldKey;
      handleExpressionChange(newExpr);
    },
    [expression, handleExpressionChange],
  );

  /** Apply a template expression */
  const applyTemplate = useCallback(
    (template: ExpressionTemplate) => {
      handleExpressionChange(template.expression);
      if (template.format) {
        changeSchemas([
          { key: 'expression', value: template.expression, schemaId: activeSchema.id },
          { key: 'format', value: template.format, schemaId: activeSchema.id },
        ]);
      }
    },
    [handleExpressionChange, changeSchemas, activeSchema.id],
  );

  /** Test the expression with sample data */
  const testExpression = useCallback(() => {
    if (!expression.trim()) {
      setTestResult(null);
      setTestError('No expression to evaluate');
      return;
    }

    try {
      // Dynamic import of ExpressionEngine for testing
      import('@pdfme-erp/schemas').then(({ ExpressionEngine }) => {
        const engine = new ExpressionEngine({
          locale: 'en-ZA',
          currency: 'ZAR',
          onError: '#ERROR',
        });

        // Build sample context from field groups
        const sampleData: Record<string, unknown> = {};
        if (fieldGroups) {
          const collectSampleData = (groups: typeof fieldGroups) => {
            for (const group of groups) {
              for (const field of group.fields) {
                // Use example value or generate sample based on type
                if (field.example) {
                  sampleData[field.key] = field.example;
                } else if (field.type === 'number') {
                  sampleData[field.key] = 100;
                } else if (field.type === 'date') {
                  sampleData[field.key] = new Date().toISOString();
                } else {
                  sampleData[field.key] = `Sample ${field.label}`;
                }
              }
              if (group.children) collectSampleData(group.children);
            }
          };
          collectSampleData(fieldGroups);
        }

        const result = engine.evaluate(expression, sampleData);
        let displayResult = String(result);
        // Apply format if present
        if (format && typeof result === 'number') {
          const formatted = engine.evaluate(
            `FORMAT(${result}, "${format}")`,
            {},
          );
          displayResult = String(formatted);
        }
        setTestResult(displayResult);
        setTestError(null);
      }).catch((err: Error) => {
        setTestResult(null);
        setTestError('Expression engine not available');
      });
    } catch (err: unknown) {
      setTestResult(null);
      setTestError(err instanceof Error ? err.message : 'Evaluation failed');
    }
  }, [expression, format, fieldGroups]);

  // Flatten all fields for the field picker
  const allFields = useMemo(() => {
    const fields: Array<{ key: string; label: string; group: string }> = [];
    if (!fieldGroups) return fields;
    const collect = (groups: typeof fieldGroups, parentLabel?: string) => {
      for (const group of groups) {
        const groupLabel = parentLabel ? `${parentLabel} > ${group.label}` : group.label;
        for (const field of group.fields) {
          fields.push({ key: field.key, label: field.label, group: groupLabel });
        }
        if (group.children) collect(group.children, groupLabel);
      }
    };
    collect(fieldGroups);
    return fields;
  }, [fieldGroups]);

  return (
    <div
      style={{
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      {/* Collapsible Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Calculator size={14} style={{ color: token.colorPrimary, flexShrink: 0 }} />
        <Text strong style={{ fontSize: 12, flex: 1 }}>
          Expression Builder
        </Text>
        {expression && (
          <Tag
            color="purple"
            style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
          >
            active
          </Tag>
        )}
        {collapsed ? (
          <ChevronRight size={12} style={{ color: token.colorTextSecondary }} />
        ) : (
          <ChevronDown size={12} style={{ color: token.colorTextSecondary }} />
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '0 12px 10px' }}>
          {/* Expression Input */}
          <div style={{ marginBottom: 8 }}>
            <Text
              type="secondary"
              style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
            >
              Expression
            </Text>
            <TextArea
              value={expression}
              onChange={(e) => handleExpressionChange(e.target.value)}
              placeholder="e.g., qty * unitPrice"
              autoSize={{ minRows: 2, maxRows: 5 }}
              style={{ fontSize: 12, fontFamily: 'monospace' }}
            />
          </div>

          {/* Test Runner */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
            <div
              onClick={testExpression}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 4,
                border: `1px solid ${token.colorBorder}`,
                cursor: 'pointer',
                fontSize: 11,
                color: token.colorPrimary,
                background: token.colorBgTextHover,
              }}
            >
              <Play size={11} />
              Test
            </div>
            {testResult !== null && (
              <Tag color="green" style={{ fontSize: 10, margin: 0 }}>
                = {testResult}
              </Tag>
            )}
            {testError !== null && (
              <Tag color="red" style={{ fontSize: 10, margin: 0 }}>
                {testError}
              </Tag>
            )}
          </div>

          {/* Tabbed sections: Functions, Fields, Templates */}
          <Tabs
            size="small"
            defaultActiveKey="functions"
            style={{ marginTop: 0 }}
            items={[
              {
                key: 'functions',
                label: (
                  <span style={{ fontSize: 11 }}>
                    <Zap size={11} style={{ marginRight: 3 }} />
                    Functions
                  </span>
                ),
                children: (
                  <div
                    style={{
                      maxHeight: 200,
                      overflowY: 'auto',
                      fontSize: 11,
                    }}
                  >
                    {FUNCTION_CATALOGUE.map((cat) => (
                      <Collapse
                        key={cat.key}
                        size="small"
                        ghost
                        style={{ marginBottom: 2 }}
                        items={[
                          {
                            key: cat.key,
                            label: (
                              <span style={{ fontSize: 11, fontWeight: 600 }}>
                                {cat.label}{' '}
                                <span style={{ color: token.colorTextTertiary, fontWeight: 400 }}>
                                  ({cat.functions.length})
                                </span>
                              </span>
                            ),
                            children: (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {cat.functions.map((fn) => (
                                  <Tooltip
                                    key={fn.name}
                                    title={
                                      <div>
                                        <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                          {fn.signature}
                                        </div>
                                        <div style={{ marginTop: 4 }}>{fn.description}</div>
                                        <div
                                          style={{
                                            marginTop: 4,
                                            fontFamily: 'monospace',
                                            color: '#a0d0ff',
                                          }}
                                        >
                                          {fn.example}
                                        </div>
                                      </div>
                                    }
                                    placement="left"
                                  >
                                    <div
                                      onClick={() => insertFunction(fn)}
                                      style={{
                                        padding: '2px 6px',
                                        borderRadius: 3,
                                        border: `1px solid ${token.colorBorder}`,
                                        cursor: 'pointer',
                                        fontSize: 10,
                                        fontFamily: 'monospace',
                                        color:
                                          copiedFn === fn.name
                                            ? token.colorSuccess
                                            : token.colorText,
                                        background:
                                          copiedFn === fn.name
                                            ? token.colorSuccessBg
                                            : token.colorBgTextHover,
                                        transition: 'all 0.15s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                      }}
                                    >
                                      {copiedFn === fn.name ? (
                                        <Check size={9} />
                                      ) : null}
                                      {fn.name}
                                    </div>
                                  </Tooltip>
                                ))}
                              </div>
                            ),
                          },
                        ]}
                      />
                    ))}
                  </div>
                ),
              },
              {
                key: 'fields',
                label: (
                  <span style={{ fontSize: 11 }}>
                    Fields
                    {hasFields && (
                      <span
                        style={{
                          marginLeft: 3,
                          color: token.colorTextTertiary,
                          fontSize: 10,
                        }}
                      >
                        ({allFields.length})
                      </span>
                    )}
                  </span>
                ),
                children: hasFields ? (
                  <div
                    style={{
                      maxHeight: 200,
                      overflowY: 'auto',
                      fontSize: 11,
                    }}
                  >
                    {fieldGroups!.map((group) => (
                      <Collapse
                        key={group.key}
                        size="small"
                        ghost
                        style={{ marginBottom: 2 }}
                        items={[
                          {
                            key: group.key,
                            label: (
                              <span style={{ fontSize: 11, fontWeight: 600 }}>
                                {group.label}{' '}
                                <span
                                  style={{
                                    color: token.colorTextTertiary,
                                    fontWeight: 400,
                                  }}
                                >
                                  ({group.fields.length})
                                </span>
                              </span>
                            ),
                            children: (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 2,
                                }}
                              >
                                {group.fields.map((field) => (
                                  <div
                                    key={field.key}
                                    onClick={() => insertFieldRef(field.key)}
                                    style={{
                                      padding: '3px 6px',
                                      borderRadius: 3,
                                      border: `1px solid ${token.colorBorder}`,
                                      cursor: 'pointer',
                                      fontSize: 10,
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      background: token.colorBgTextHover,
                                    }}
                                  >
                                    <span>{field.label}</span>
                                    <span
                                      style={{
                                        fontFamily: 'monospace',
                                        color: token.colorTextTertiary,
                                        fontSize: 9,
                                      }}
                                    >
                                      {field.key}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ),
                          },
                        ]}
                      />
                    ))}
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    No field schema loaded for this template type.
                  </Text>
                ),
              },
              {
                key: 'templates',
                label: (
                  <span style={{ fontSize: 11 }}>
                    <Copy size={11} style={{ marginRight: 3 }} />
                    Templates
                  </span>
                ),
                children: (
                  <div
                    style={{
                      maxHeight: 200,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {EXPRESSION_TEMPLATES.map((tpl) => (
                      <div
                        key={tpl.name}
                        onClick={() => applyTemplate(tpl)}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: `1px solid ${token.colorBorder}`,
                          cursor: 'pointer',
                          background: token.colorBgTextHover,
                          transition: 'border-color 0.15s',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            marginBottom: 2,
                          }}
                        >
                          {tpl.name}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: 'monospace',
                            color: token.colorPrimary,
                            marginBottom: 2,
                          }}
                        >
                          {tpl.expression}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: token.colorTextTertiary,
                          }}
                        >
                          {tpl.description}
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
};

export default ExpressionBuilderWidget;
