import React, { useState, useMemo, useCallback } from 'react';
import { theme, Typography, Button, Select, Tag, Tooltip } from 'antd';
import { Link2, Link2Off, Plus } from 'lucide-react';
import {
  useFieldPalette,
  type FieldEntry,
  type FieldGroup,
} from '../../../../contexts/FieldPaletteContext.js';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';

const { Text } = Typography;

interface FieldBindingWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

/** Extract all {{field.key}} bindings from content */
const extractBindings = (content: string): string[] => {
  const matches = content.match(/\{\{([^}]+)\}\}/g);
  return matches ? matches.map((m) => m.slice(2, -2)) : [];
};

/** Check if content is a single pure binding e.g. exactly "{{customer.name}}" */
const isPureBinding = (content: string): boolean => {
  return /^\{\{[^}]+\}\}$/.test(content.trim());
};

/**
 * Recursively flatten field groups into Select optgroup structures.
 * Handles nested children groups by prefixing labels.
 */
const buildSelectOptions = (
  groups: FieldGroup[],
  prefix = '',
): Array<{ label: string; options: Array<{ label: string; value: string; title: string }> }> => {
  const result: Array<{
    label: string;
    options: Array<{ label: string; value: string; title: string }>;
  }> = [];

  for (const group of groups) {
    const groupLabel = prefix ? `${prefix} > ${group.label}` : group.label;

    if (group.fields.length > 0) {
      result.push({
        label: groupLabel,
        options: group.fields.map((field) => ({
          label: field.label,
          value: field.key,
          title: field.example ? `${field.key} (e.g. ${field.example})` : field.key,
        })),
      });
    }

    if (group.children) {
      result.push(...buildSelectOptions(group.children, groupLabel));
    }
  }

  return result;
};

/**
 * Recursively flatten all fields across all groups for lookup by key.
 */
const flattenAllFields = (groups: FieldGroup[]): FieldEntry[] => {
  const result: FieldEntry[] = [];
  for (const group of groups) {
    result.push(...group.fields);
    if (group.children) {
      result.push(...flattenAllFields(group.children));
    }
  }
  return result;
};

/**
 * FieldBindingWidget - provides a searchable dropdown to bind schema elements
 * to ERP data fields. Sits at the top of the RightSidebar DetailView properties panel.
 *
 * - For text schemas: sets content to "{{fieldKey}}"
 * - Shows current binding status when content matches {{...}} pattern
 * - Supports clearing the binding
 * - For multi-variable text, allows inserting additional field references
 */
const FieldBindingWidget: React.FC<FieldBindingWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const { fieldGroups, hasFields } = useFieldPalette();
  const [collapsed, setCollapsed] = useState(false);
  const [insertMode, setInsertMode] = useState(false);

  const content = String((activeSchema as Record<string, unknown>).content ?? '');
  const bindings = useMemo(() => extractBindings(content), [content]);
  const isSingleBinding = useMemo(() => isPureBinding(content), [content]);
  const hasExistingContent = content.length > 0;

  // Build select options grouped by field group
  const selectOptions = useMemo(() => buildSelectOptions(fieldGroups), [fieldGroups]);

  // Flat list of all fields for label lookups
  const allFields = useMemo(() => flattenAllFields(fieldGroups), [fieldGroups]);

  // Find the currently bound field key (only for pure single bindings)
  const boundFieldKey = isSingleBinding ? bindings[0] : null;

  /** Replace content with a single binding */
  const handleBind = useCallback(
    (fieldKey: string) => {
      changeSchemas([
        { key: 'content', value: `{{${fieldKey}}}`, schemaId: activeSchema.id },
      ]);
      setInsertMode(false);
    },
    [changeSchemas, activeSchema.id],
  );

  /** Insert a field binding at the end of existing content */
  const handleInsert = useCallback(
    (fieldKey: string) => {
      const separator = content.length > 0 && !content.endsWith(' ') ? ' ' : '';
      const newContent = content + separator + `{{${fieldKey}}}`;
      changeSchemas([{ key: 'content', value: newContent, schemaId: activeSchema.id }]);
      setInsertMode(false);
    },
    [content, changeSchemas, activeSchema.id],
  );

  /** Clear all bindings from content */
  const handleClear = useCallback(() => {
    changeSchemas([{ key: 'content', value: '', schemaId: activeSchema.id }]);
    setInsertMode(false);
  }, [changeSchemas, activeSchema.id]);

  /** Look up a field label from its key */
  const getFieldLabel = useCallback(
    (key: string): string => {
      const field = allFields.find((f) => f.key === key);
      return field ? field.label : key;
    },
    [allFields],
  );

  // Don't render if no field groups are available
  if (!hasFields) return null;

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
        <Link2
          size={14}
          color={bindings.length > 0 ? token.colorPrimary : token.colorTextTertiary}
        />
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Field Binding
        </Text>
        {bindings.length > 0 && (
          <Tag
            color="blue"
            style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}
          >
            {bindings.length}
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
          {/* Current Binding Status */}
          {bindings.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Text
                type="secondary"
                style={{ fontSize: 11, display: 'block', marginBottom: 3 }}
              >
                {isSingleBinding ? 'Bound to:' : 'Contains bindings:'}
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {bindings.map((key, i) => (
                  <Tooltip key={i} title={`{{${key}}}`}>
                    <Tag
                      color="blue"
                      style={{ fontSize: 11, margin: 0, cursor: 'default' }}
                    >
                      {getFieldLabel(key)}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Primary selector: Bind or Replace */}
          {(!hasExistingContent || isSingleBinding) && !insertMode && (
            <Select
              showSearch
              allowClear={false}
              style={{ width: '100%', marginBottom: 6 }}
              size="small"
              placeholder="Select a field to bind..."
              value={boundFieldKey || undefined}
              options={selectOptions}
              filterOption={(input, option) => {
                const label = String(option?.label ?? '');
                const value = String(option?.value ?? '');
                const search = input.toLowerCase();
                return (
                  label.toLowerCase().includes(search) ||
                  value.toLowerCase().includes(search)
                );
              }}
              onChange={(value) => {
                if (value) handleBind(value);
              }}
            />
          )}

          {/* Insert mode selector (for multi-variable text) */}
          {insertMode && (
            <Select
              showSearch
              autoFocus
              style={{ width: '100%', marginBottom: 6 }}
              size="small"
              placeholder="Select a field to insert..."
              options={selectOptions}
              filterOption={(input, option) => {
                const label = String(option?.label ?? '');
                const value = String(option?.value ?? '');
                const search = input.toLowerCase();
                return (
                  label.toLowerCase().includes(search) ||
                  value.toLowerCase().includes(search)
                );
              }}
              onChange={(value) => {
                if (value) handleInsert(value);
              }}
              onBlur={() => setInsertMode(false)}
            />
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {/* Insert field button: shown when content already has text/bindings */}
            {hasExistingContent && !insertMode && (
              <Button
                size="small"
                type="default"
                icon={<Plus size={12} />}
                onClick={() => setInsertMode(true)}
                style={{ fontSize: 11 }}
              >
                Insert field
              </Button>
            )}

            {/* Clear binding button */}
            {bindings.length > 0 && (
              <Button
                size="small"
                danger
                icon={<Link2Off size={12} />}
                onClick={handleClear}
                style={{ fontSize: 11 }}
              >
                Clear binding
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldBindingWidget;
