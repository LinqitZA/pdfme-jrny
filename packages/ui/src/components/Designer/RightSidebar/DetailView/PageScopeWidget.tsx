import React, { useState, useCallback } from 'react';
import { theme, Typography, Select, Tag } from 'antd';
import { Layers } from 'lucide-react';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';

const { Text } = Typography;

type PageScope = 'all' | 'first' | 'last' | 'notFirst';

interface PageScopeWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

const PAGE_SCOPE_OPTIONS: Array<{ label: string; value: PageScope; description: string }> = [
  { label: 'All Pages', value: 'all', description: 'Element appears on every page' },
  { label: 'First Page Only', value: 'first', description: 'Element only on the first page' },
  { label: 'Last Page Only', value: 'last', description: 'Element only on the last page' },
  { label: 'Not First Page', value: 'notFirst', description: 'Element on all pages except first' },
];

const SCOPE_BADGE_COLORS: Record<PageScope, string> = {
  all: '',
  first: 'blue',
  last: 'orange',
  notFirst: 'green',
};

/**
 * PageScopeWidget - provides a dropdown to control which pages an element
 * appears on in multi-page documents. Sits in the RightSidebar DetailView
 * properties panel.
 *
 * Page scopes:
 * - 'all' (default): element appears on every page
 * - 'first': element only on the first page
 * - 'last': element only on the last page
 * - 'notFirst': element on all pages except first
 *
 * The pageScope value is stored as a custom property on the schema object.
 * The backend render pipeline's resolvePageScopes() reads this property
 * to filter elements per page during PDF generation.
 */
const PageScopeWidget: React.FC<PageScopeWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);

  // Read current pageScope from the schema (default to 'all')
  const currentScope = ((activeSchema as Record<string, unknown>).pageScope as PageScope) || 'all';
  const isNonDefault = currentScope !== 'all';

  /** Update the pageScope on the schema */
  const handleScopeChange = useCallback(
    (value: PageScope) => {
      changeSchemas([
        { key: 'pageScope', value, schemaId: activeSchema.id },
      ]);
    },
    [changeSchemas, activeSchema.id],
  );

  // Find the label for the current scope
  const currentLabel = PAGE_SCOPE_OPTIONS.find((o) => o.value === currentScope)?.label || 'All Pages';

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
        <Layers
          size={14}
          color={isNonDefault ? token.colorPrimary : token.colorTextTertiary}
        />
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Page Visibility
        </Text>
        {isNonDefault && (
          <Tag
            color={SCOPE_BADGE_COLORS[currentScope] || 'blue'}
            style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}
          >
            {currentLabel}
          </Tag>
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
            style={{ width: '100%' }}
            size="small"
            value={currentScope}
            onChange={handleScopeChange}
            options={PAGE_SCOPE_OPTIONS.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
          />
          {isNonDefault && (
            <Text
              type="secondary"
              style={{ fontSize: 11, display: 'block', marginTop: 4 }}
            >
              {PAGE_SCOPE_OPTIONS.find((o) => o.value === currentScope)?.description}
            </Text>
          )}
        </div>
      )}
    </div>
  );
};

export default PageScopeWidget;
