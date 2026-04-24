import React, { useState, useCallback, useMemo } from 'react';
import { theme, Typography, Select, Input, Tag, Tooltip } from 'antd';
import { Eye, EyeOff } from 'lucide-react';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';

const { Text } = Typography;

type VisibilityMode = 'always' | 'conditional';

interface Condition {
  type: 'fieldNonEmpty' | 'expression';
  field?: string;
  expression?: string;
}

interface ConditionalVisibilityWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

/**
 * ConditionalVisibilityWidget - provides a toggle and expression input to
 * control whether an element is conditionally hidden based on data values.
 *
 * Storage format matches the backend's resolveConditions():
 *   condition: { type: 'expression', expression: '...' }
 *   condition: { type: 'fieldNonEmpty', field: '...' }
 *
 * Expression syntax (evaluated by the backend):
 *   - Simple field check: "fieldName" (visible if non-empty)
 *   - Comparison: "fieldName == value", "fieldName != value"
 *   - Numeric: "total > 0", "discount >= 10"
 *   - String: "status != 'draft'"
 */
const ConditionalVisibilityWidget: React.FC<ConditionalVisibilityWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);

  // Read current condition from the schema
  const condition = (activeSchema as Record<string, unknown>).condition as Condition | undefined;

  const visibilityMode: VisibilityMode = condition ? 'conditional' : 'always';
  const isConditional = visibilityMode === 'conditional';

  // Derive the expression string from the condition
  const expressionValue = useMemo(() => {
    if (!condition) return '';
    if (condition.type === 'expression') return condition.expression || '';
    if (condition.type === 'fieldNonEmpty') return condition.field || '';
    return '';
  }, [condition]);

  /** Switch between always visible and conditional */
  const handleModeChange = useCallback(
    (value: VisibilityMode) => {
      if (value === 'always') {
        // Remove condition entirely by setting to undefined
        changeSchemas([
          { key: 'condition', value: undefined as unknown, schemaId: activeSchema.id },
        ]);
      } else {
        // Set default condition with empty expression
        changeSchemas([
          {
            key: 'condition',
            value: { type: 'expression', expression: '' },
            schemaId: activeSchema.id,
          },
        ]);
      }
    },
    [changeSchemas, activeSchema.id],
  );

  /** Update the expression */
  const handleExpressionChange = useCallback(
    (newExpression: string) => {
      const trimmed = newExpression.trim();

      // Detect if it's a simple field reference (no operators)
      const isSimpleField = trimmed && !/[=!<>]/.test(trimmed) && /^[a-zA-Z0-9_.]+$/.test(trimmed);

      if (isSimpleField) {
        changeSchemas([
          {
            key: 'condition',
            value: { type: 'fieldNonEmpty', field: trimmed },
            schemaId: activeSchema.id,
          },
        ]);
      } else {
        changeSchemas([
          {
            key: 'condition',
            value: { type: 'expression', expression: trimmed },
            schemaId: activeSchema.id,
          },
        ]);
      }
    },
    [changeSchemas, activeSchema.id],
  );

  // Format display label for the condition
  const conditionLabel = useMemo(() => {
    if (!condition) return '';
    if (condition.type === 'fieldNonEmpty') return `if ${condition.field}`;
    if (condition.type === 'expression' && condition.expression) {
      const expr = condition.expression;
      return expr.length > 18 ? expr.slice(0, 16) + '…' : expr;
    }
    return 'conditional';
  }, [condition]);

  return (
    <div
      style={{
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 4,
      }}
    >
      {/* Collapsible Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px 6px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {isConditional ? (
          <EyeOff size={14} color={token.colorWarning} />
        ) : (
          <Eye size={14} color={token.colorTextTertiary} />
        )}
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Visibility
        </Text>
        {isConditional && (
          <Tooltip title={condition?.expression || condition?.field || 'Conditional'}>
            <Tag
              color="volcano"
              style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}
            >
              {conditionLabel || 'Conditional'}
            </Tag>
          </Tooltip>
        )}
        <span
          style={{
            fontSize: 10,
            transition: 'transform 0.15s',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            color: token.colorTextQuaternary,
          }}
        >
          &#9654;
        </span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ padding: '0 12px 8px' }}>
          <Select
            style={{ width: '100%', marginBottom: isConditional ? 6 : 0 }}
            size="small"
            value={visibilityMode}
            onChange={handleModeChange}
            options={[
              { label: 'Always Visible', value: 'always' },
              { label: 'Conditional', value: 'conditional' },
            ]}
          />

          {/* Expression input when conditional */}
          {isConditional && (
            <>
              <Input
                size="small"
                placeholder="e.g., discount > 0"
                value={expressionValue}
                onChange={(e) => handleExpressionChange(e.target.value)}
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
              />
              <Text
                type="secondary"
                style={{ fontSize: 10, display: 'block', marginTop: 3, lineHeight: '14px' }}
              >
                Field name → visible if non-empty.{' '}
                Operators: == != {'>'} {'<'} {'>'}= {'<'}=
              </Text>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ConditionalVisibilityWidget;
