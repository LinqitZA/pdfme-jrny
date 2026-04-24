import React, { useState, useCallback, useMemo, useContext } from 'react';
import { theme, Typography, Button, Select, InputNumber, Tag, Tooltip, Popconfirm, Segmented } from 'antd';
import {
  Columns3,
  Plus,
  X,
  GripVertical,
  ChevronDown,
  ChevronRight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Calculator,
  Type,
  Link2,
  HelpCircle,
  Bold,
  Italic,
  Paintbrush,
} from 'lucide-react';
import FormatPickerWidget from './FormatPickerWidget.js';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';
import {
  useFieldPalette,
  type FieldEntry,
  type FieldGroup,
} from '../../../../contexts/FieldPaletteContext.js';
import { FontContext } from '../../../../contexts.js';

const { Text } = Typography;

// ─── Types ───────────────────────────────────────────────────────────

interface ColumnFontStyle {
  fontName?: string;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
}

interface ColumnDefinition {
  key: string;
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  format?: string;
  colSpan?: number;
  columnType?: 'field' | 'calculated' | 'static';
  expression?: string;
  columnStyle?: ColumnFontStyle;
  headerColumnStyle?: ColumnFontStyle;
  overflow?: 'wrap' | 'truncate' | 'clip';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  headerAlign?: 'left' | 'center' | 'right';
  headerVerticalAlign?: 'top' | 'middle' | 'bottom';
}

interface ColumnConfigWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const ALIGN_OPTIONS: Array<{ label: string; value: 'left' | 'center' | 'right'; icon: React.ReactNode }> = [
  { label: 'Left', value: 'left', icon: <AlignLeft size={12} /> },
  { label: 'Center', value: 'center', icon: <AlignCenter size={12} /> },
  { label: 'Right', value: 'right', icon: <AlignRight size={12} /> },
];

const VALIGN_OPTIONS: Array<{ label: string; value: 'top' | 'middle' | 'bottom'; icon: React.ReactNode }> = [
  { label: 'Top', value: 'top', icon: <AlignVerticalJustifyStart size={12} /> },
  { label: 'Middle', value: 'middle', icon: <AlignVerticalJustifyCenter size={12} /> },
  { label: 'Bottom', value: 'bottom', icon: <AlignVerticalJustifyEnd size={12} /> },
];

/** Column type options for the type selector */
const COLUMN_TYPE_OPTIONS: Array<{
  label: string;
  value: 'field' | 'calculated' | 'static';
  icon: React.ReactNode;
  description: string;
  color: string;
}> = [
  { label: 'Field', value: 'field', icon: <Link2 size={11} />, description: 'Bind to a data field', color: '#1677ff' },
  { label: 'Calculated', value: 'calculated', icon: <Calculator size={11} />, description: 'Evaluate an expression', color: '#faad14' },
  { label: 'Static', value: 'static', icon: <Type size={11} />, description: 'Fixed text content', color: '#52c41a' },
];

const DEFAULT_COLUMN: ColumnDefinition = {
  key: '',
  header: 'New Column',
  width: 30,
  align: 'left',
  format: '',
  columnType: 'field',
};

/** Field type to display color mapping */
const FIELD_TYPE_COLORS: Record<string, string> = {
  string: '#52c41a',
  number: '#1677ff',
  currency: '#faad14',
  date: '#722ed1',
  boolean: '#eb2f96',
  image: '#13c2c2',
  array: '#fa541c',
};

/** Field type abbreviation for badges */
const FIELD_TYPE_ABBR: Record<string, string> = {
  string: 'Abc',
  number: '#',
  currency: '$',
  date: 'Date',
  boolean: 'T/F',
  image: 'Img',
  array: '[]',
};

interface FieldOptionData {
  label: React.ReactNode;
  value: string;
  searchLabel: string;
  fieldType?: string;
  groupPath: string;
}

/** Flatten FieldGroups into Select options with type badges and group paths */
const buildFieldOptions = (
  groups: FieldGroup[],
  prefix = '',
  filterLineItemFields = false,
): Array<{ label: string; options: FieldOptionData[] }> => {
  const result: Array<{ label: string; options: FieldOptionData[] }> = [];
  for (const group of groups) {
    const groupLabel = prefix ? `${prefix} > ${group.label}` : group.label;

    // If filtering for line-item fields, prioritise groups with "line" in the key
    if (filterLineItemFields) {
      const isLineGroup =
        group.key.toLowerCase().includes('line') ||
        group.key.toLowerCase().includes('detail') ||
        group.label.toLowerCase().includes('line');
      if (!isLineGroup && !prefix) {
        // Still include non-line groups but at the end
        // (we'll still process them below)
      }
    }

    if (group.fields.length > 0) {
      result.push({
        label: groupLabel,
        options: group.fields.map((field) => ({
          label: field.label,
          value: field.key,
          searchLabel: `${field.label} ${field.key} ${groupLabel}`,
          fieldType: field.type,
          groupPath: groupLabel,
        })),
      });
    }
    if (group.children) {
      result.push(...buildFieldOptions(group.children, groupLabel, filterLineItemFields));
    }
  }
  return result;
};

/** Flatten all fields for lookup with group path */
interface FieldWithGroup extends FieldEntry {
  groupPath: string;
}

const flattenFieldsWithGroups = (
  groups: FieldGroup[],
  prefix = '',
): FieldWithGroup[] => {
  const result: FieldWithGroup[] = [];
  for (const group of groups) {
    const groupLabel = prefix ? `${prefix} > ${group.label}` : group.label;
    for (const field of group.fields) {
      result.push({ ...field, groupPath: groupLabel });
    }
    if (group.children) {
      result.push(...flattenFieldsWithGroups(group.children, groupLabel));
    }
  }
  return result;
};

// ─── SortableColumnCard ──────────────────────────────────────────────

// ─── ColumnFontSettings ─────────────────────────────────────────────

interface ColumnFontSettingsProps {
  label: string;
  style: ColumnFontStyle | undefined;
  onChange: (style: ColumnFontStyle | undefined) => void;
  fontNames: string[];
  token: ReturnType<typeof theme.useToken>['token'];
}

/**
 * Reusable font settings sub-section for a column.
 * Shows font family, size, color, bold, italic toggles.
 * When no overrides are set, shows "Inherited" placeholders.
 */
const ColumnFontSettings: React.FC<ColumnFontSettingsProps> = ({
  label,
  style,
  onChange,
  fontNames,
  token,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasOverrides = style && (
    style.fontName || style.fontSize != null || style.fontColor || style.bold || style.italic
  );

  const updateStyle = (patch: Partial<ColumnFontStyle>) => {
    const next = { ...(style || {}), ...patch };
    // Remove undefined/null values
    const cleaned: ColumnFontStyle = {};
    if (next.fontName) cleaned.fontName = next.fontName;
    if (next.fontSize != null) cleaned.fontSize = next.fontSize;
    if (next.fontColor) cleaned.fontColor = next.fontColor;
    if (next.bold) cleaned.bold = next.bold;
    if (next.italic) cleaned.italic = next.italic;
    onChange(Object.keys(cleaned).length > 0 ? cleaned : undefined);
  };

  const clearAll = () => onChange(undefined);

  return (
    <div
      style={{
        border: `1px solid ${hasOverrides ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusSM,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          cursor: 'pointer',
          background: hasOverrides ? token.colorPrimaryBg : 'transparent',
          userSelect: 'none',
        }}
      >
        <Paintbrush size={10} color={hasOverrides ? token.colorPrimary : token.colorTextQuaternary} />
        <Text style={{ fontSize: 10, flex: 1, color: hasOverrides ? token.colorPrimary : token.colorTextSecondary }}>
          {label}
        </Text>
        {hasOverrides && (
          <Tag
            color="blue"
            style={{ fontSize: 8, lineHeight: '12px', margin: 0, padding: '0 3px' }}
          >
            Custom
          </Tag>
        )}
        {!hasOverrides && (
          <Text type="secondary" style={{ fontSize: 9 }}>Inherited</Text>
        )}
        <span style={{ color: token.colorTextQuaternary, fontSize: 8, display: 'flex' }}>
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '4px 6px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Font Family */}
          <div>
            <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 1 }}>
              Font Family
            </Text>
            <Select
              size="small"
              style={{ width: '100%' }}
              allowClear
              placeholder="Inherited"
              value={style?.fontName || undefined}
              onChange={(val) => updateStyle({ fontName: val || undefined })}
              options={fontNames.map((name) => ({ label: name, value: name }))}
              showSearch
              filterOption={(input, option) =>
                (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          {/* Font Size + Color row */}
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 1 }}>
                Size
              </Text>
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                min={6}
                max={72}
                step={0.5}
                placeholder="Inherited"
                value={style?.fontSize ?? null}
                onChange={(val) => updateStyle({ fontSize: val != null ? val : undefined })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 1 }}>
                Color
              </Text>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="color"
                  value={style?.fontColor || '#000000'}
                  onChange={(e) => updateStyle({ fontColor: e.target.value })}
                  style={{
                    width: 24,
                    height: 24,
                    padding: 0,
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadiusSM,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
                <input
                  type="text"
                  value={style?.fontColor || ''}
                  placeholder="Inherited"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === '') {
                      updateStyle({ fontColor: val || undefined });
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '2px 5px',
                    fontSize: 11,
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadiusSM,
                    background: token.colorBgContainer,
                    color: token.colorText,
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Bold + Italic toggles */}
          <div style={{ display: 'flex', gap: 4 }}>
            <Button
              size="small"
              type={style?.bold ? 'primary' : 'default'}
              icon={<Bold size={12} />}
              onClick={() => updateStyle({ bold: !style?.bold })}
              style={{ flex: 1, fontSize: 11 }}
            >
              Bold
            </Button>
            <Button
              size="small"
              type={style?.italic ? 'primary' : 'default'}
              icon={<Italic size={12} />}
              onClick={() => updateStyle({ italic: !style?.italic })}
              style={{ flex: 1, fontSize: 11 }}
            >
              Italic
            </Button>
          </div>

          {/* Clear overrides */}
          {hasOverrides && (
            <Button
              size="small"
              type="link"
              danger
              onClick={clearAll}
              style={{ fontSize: 10, padding: 0, height: 'auto' }}
            >
              Reset to inherited
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── SortableColumnCard ──────────────────────────────────────────────

interface SortableColumnCardProps {
  column: ColumnDefinition;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (index: number, updated: ColumnDefinition) => void;
  onRemove: (index: number) => void;
  fieldOptions: Array<{ label: string; options: FieldOptionData[] }>;
  allFields: FieldWithGroup[];
  allColumnKeys: string[];
  fontNames: string[];
  schemaWidth: number;
  totalColumnWidth: number;
  token: ReturnType<typeof theme.useToken>['token'];
}

const SortableColumnCard: React.FC<SortableColumnCardProps> = ({
  column,
  index,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  fieldOptions,
  allFields,
  allColumnKeys,
  fontNames,
  schemaWidth,
  totalColumnWidth,
  token,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `col-${index}` });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadiusSM,
    marginBottom: 4,
    background: isDragging ? token.colorBgTextHover : token.colorBgContainer,
  };

  const colType = column.columnType || 'field';
  const colTypeInfo = COLUMN_TYPE_OPTIONS.find((t) => t.value === colType);
  const alignIcon = ALIGN_OPTIONS.find((a) => a.value === (column.align || 'left'))?.icon;
  const boundField = allFields.find((f) => f.key === column.key);
  const fieldLabel = boundField?.label;
  const fieldType = boundField?.type;
  const fieldGroupPath = boundField?.groupPath;

  /** Build expression help text from available column keys */
  const expressionHelpText = useMemo(() => {
    const vars = allColumnKeys.filter((k) => k && k !== column.key);
    const lines = [
      'Enter an expression using column keys as variables.',
      '',
      'Available variables:',
      ...vars.map((k) => `  • ${k}`),
      '',
      'Examples:',
      '  qty * unitPrice',
      '  amount * 0.15',
      '  IF(taxable, amount * taxRate, 0)',
      '  ROUND(qty * unitPrice, 2)',
      '',
      'Functions: IF, AND, OR, NOT, ROUND, ABS,',
      '  FLOOR, CEIL, MIN, MAX, SUM, CONCAT,',
      '  UPPER, LOWER, LEFT, RIGHT, FORMAT',
    ];
    return lines.join('\n');
  }, [allColumnKeys, column.key]);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Summary Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          cursor: 'pointer',
          minHeight: 32,
        }}
        onClick={onToggleExpand}
      >
        {/* Drag handle */}
        <div
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{
            cursor: 'grab',
            color: token.colorTextQuaternary,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <GripVertical size={14} />
        </div>

        {/* Column index badge */}
        <Tag
          style={{
            fontSize: 10,
            lineHeight: '16px',
            margin: 0,
            padding: '0 4px',
            minWidth: 20,
            textAlign: 'center',
          }}
        >
          {index + 1}
        </Tag>

        {/* Column type icon (only show for non-default types) */}
        {colType !== 'field' && colTypeInfo && (
          <Tooltip title={`${colTypeInfo.label} column`}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                color: colTypeInfo.color,
                flexShrink: 0,
              }}
            >
              {colTypeInfo.icon}
            </span>
          </Tooltip>
        )}

        {/* Header name */}
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={column.header}
        >
          {column.header || '(untitled)'}
        </Text>

        {/* Column type indicator for calculated/static */}
        {colType === 'calculated' && column.expression && (
          <Tooltip title={`Expression: ${column.expression}`}>
            <Tag
              color="gold"
              style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 3px', maxWidth: 65, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              fx
            </Tag>
          </Tooltip>
        )}
        {colType === 'static' && column.key && (
          <Tooltip title={`Static: ${column.key}`}>
            <Tag
              color="green"
              style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 3px', maxWidth: 65, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {column.key}
            </Tag>
          </Tooltip>
        )}

        {/* Bound field indicator (only for 'field' type) */}
        {colType === 'field' && column.key && (
          <Tooltip title={fieldGroupPath ? `${fieldGroupPath} > ${fieldLabel || column.key}` : column.key}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, maxWidth: 80, overflow: 'hidden' }}>
              {fieldType && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    color: FIELD_TYPE_COLORS[fieldType] || token.colorTextSecondary,
                    flexShrink: 0,
                  }}
                >
                  {FIELD_TYPE_ABBR[fieldType] || fieldType}
                </span>
              )}
              <Tag
                color="blue"
                style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 3px', maxWidth: 65, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {fieldLabel || column.key}
              </Tag>
            </span>
          </Tooltip>
        )}

        {/* Width indicator */}
        <Text
          type="secondary"
          style={{ fontSize: 10, flexShrink: 0 }}
        >
          {column.width}mm
        </Text>

        {/* Align icon */}
        <span style={{ color: token.colorTextTertiary, display: 'flex', flexShrink: 0 }}>
          {alignIcon}
        </span>

        {/* Expand chevron */}
        <span style={{ color: token.colorTextQuaternary, display: 'flex', flexShrink: 0 }}>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div
          style={{
            padding: '4px 8px 8px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {/* Column Type Selector */}
          <div>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
              Column Type
            </Text>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={colType}
              onChange={(val) => {
                const updates: Partial<ColumnDefinition> = { columnType: val };
                // Clear type-specific fields when switching
                if (val === 'field') {
                  updates.expression = undefined;
                } else if (val === 'calculated') {
                  updates.key = column.key || `calc_${index + 1}`;
                  updates.expression = column.expression || '';
                } else if (val === 'static') {
                  updates.expression = undefined;
                  if (!column.key) updates.key = '';
                }
                onUpdate(index, { ...column, ...updates });
              }}
              options={COLUMN_TYPE_OPTIONS.map((opt) => ({
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ color: opt.color, display: 'flex' }}>{opt.icon}</span>
                    <span>{opt.label}</span>
                    <Text type="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>{opt.description}</Text>
                  </span>
                ),
                value: opt.value,
              }))}
            />
          </div>

          {/* Header name */}
          <div>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
              Header Text
            </Text>
            <input
              type="text"
              value={column.header}
              onChange={(e) => onUpdate(index, { ...column, header: e.target.value })}
              style={{
                width: '100%',
                padding: '3px 7px',
                fontSize: 12,
                border: `1px solid ${token.colorBorder}`,
                borderRadius: token.borderRadiusSM,
                background: token.colorBgContainer,
                color: token.colorText,
                outline: 'none',
              }}
            />
          </div>

          {/* === FIELD TYPE: Data Field binding === */}
          {colType === 'field' && (
            <div>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Data Field
              </Text>
              {fieldOptions.length > 0 ? (
                <>
                  <Select
                    showSearch
                    allowClear
                    style={{ width: '100%' }}
                    size="small"
                    placeholder="Select field to bind..."
                    value={column.key || undefined}
                    optionLabelProp="label"
                    filterOption={(input, option) => {
                      const searchLabel = (option as unknown as FieldOptionData)?.searchLabel || '';
                      const value = String(option?.value ?? '');
                      const search = input.toLowerCase();
                      return searchLabel.toLowerCase().includes(search) || value.toLowerCase().includes(search);
                    }}
                    onChange={(value) => {
                      const updates: Partial<ColumnDefinition> = { key: value || '' };
                      // Auto-populate header from field label when header is empty or default
                      if (value && (!column.header || column.header.startsWith('Column '))) {
                        const matchedField = allFields.find((f) => f.key === value);
                        if (matchedField) {
                          updates.header = matchedField.label;
                          // Auto-set alignment based on field type
                          if (matchedField.type === 'number' || matchedField.type === 'currency') {
                            updates.align = 'right';
                          }
                          // Auto-set format for currency fields
                          if (matchedField.type === 'currency' && !column.format) {
                            updates.format = '#,##0.00';
                          }
                        }
                      }
                      onUpdate(index, { ...column, ...updates });
                    }}
                    onClear={() => onUpdate(index, { ...column, key: '' })}
                  >
                    {fieldOptions.map((group) => (
                      <Select.OptGroup key={group.label} label={group.label}>
                        {group.options.map((opt) => (
                          <Select.Option
                            key={opt.value}
                            value={opt.value}
                            label={typeof opt.label === 'string' ? opt.label : opt.value}
                            searchLabel={opt.searchLabel}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                              {opt.fieldType && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: FIELD_TYPE_COLORS[opt.fieldType] || token.colorTextSecondary,
                                    minWidth: 22,
                                    textAlign: 'center',
                                  }}
                                >
                                  {FIELD_TYPE_ABBR[opt.fieldType] || opt.fieldType}
                                </span>
                              )}
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {typeof opt.label === 'string' ? opt.label : opt.value}
                              </span>
                            </span>
                          </Select.Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Select>
                  {/* Show bound field group path */}
                  {column.key && fieldGroupPath && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 10, display: 'block', marginTop: 2 }}
                      title={column.key}
                    >
                      {fieldGroupPath} &gt; {fieldLabel || column.key}
                    </Text>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={column.key}
                  onChange={(e) => onUpdate(index, { ...column, key: e.target.value })}
                  placeholder="e.g. description"
                  style={{
                    width: '100%',
                    padding: '3px 7px',
                    fontSize: 12,
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadiusSM,
                    background: token.colorBgContainer,
                    color: token.colorText,
                    outline: 'none',
                  }}
                />
              )}
            </div>
          )}

          {/* === CALCULATED TYPE: Expression input === */}
          {colType === 'calculated' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  Expression
                </Text>
                <Tooltip
                  title={<pre style={{ margin: 0, fontSize: 10, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{expressionHelpText}</pre>}
                  placement="left"
                  overlayStyle={{ maxWidth: 320 }}
                >
                  <HelpCircle size={11} style={{ color: token.colorTextTertiary, cursor: 'help' }} />
                </Tooltip>
              </div>
              <textarea
                value={column.expression || ''}
                onChange={(e) => onUpdate(index, { ...column, expression: e.target.value })}
                placeholder="e.g. qty * unitPrice"
                rows={2}
                style={{
                  width: '100%',
                  padding: '4px 7px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: token.borderRadiusSM,
                  background: token.colorBgContainer,
                  color: token.colorText,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 40,
                }}
              />
              {/* Column key (auto-generated, editable) */}
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                  Column Key
                </Text>
                <input
                  type="text"
                  value={column.key}
                  onChange={(e) => onUpdate(index, { ...column, key: e.target.value })}
                  placeholder={`calc_${index + 1}`}
                  style={{
                    width: '100%',
                    padding: '3px 7px',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    border: `1px solid ${token.colorBorder}`,
                    borderRadius: token.borderRadiusSM,
                    background: token.colorBgContainer,
                    color: token.colorText,
                    outline: 'none',
                  }}
                />
                <Text type="secondary" style={{ fontSize: 9, display: 'block', marginTop: 1 }}>
                  Other columns can reference this value via its key
                </Text>
              </div>
              {/* Available variables quick reference */}
              {allColumnKeys.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                    Available Variables
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {allColumnKeys
                      .filter((k) => k && k !== column.key)
                      .map((k) => (
                        <Tag
                          key={k}
                          style={{
                            fontSize: 9,
                            lineHeight: '14px',
                            margin: 0,
                            padding: '0 4px',
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                          }}
                          color="default"
                          onClick={() => {
                            // Insert variable at end of expression
                            const expr = column.expression || '';
                            const newExpr = expr ? `${expr} ${k}` : k;
                            onUpdate(index, { ...column, expression: newExpr });
                          }}
                        >
                          {k}
                        </Tag>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === STATIC TYPE: Fixed text content === */}
          {colType === 'static' && (
            <div>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Static Content
              </Text>
              <input
                type="text"
                value={column.key}
                onChange={(e) => onUpdate(index, { ...column, key: e.target.value })}
                placeholder="e.g. ✓ or fixed text"
                style={{
                  width: '100%',
                  padding: '3px 7px',
                  fontSize: 12,
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: token.borderRadiusSM,
                  background: token.colorBgContainer,
                  color: token.colorText,
                  outline: 'none',
                }}
              />
              <Text type="secondary" style={{ fontSize: 9, display: 'block', marginTop: 1 }}>
                This text will appear in every row of this column
              </Text>
            </div>
          )}

          {/* Width */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Text type="secondary" style={{ fontSize: 10 }}>
                Width (mm)
              </Text>
              <Tag
                color="default"
                style={{ fontSize: 8, lineHeight: '12px', margin: 0, padding: '0 3px' }}
              >
                {totalColumnWidth > 0 ? Math.round((column.width / totalColumnWidth) * 100) : 0}%
              </Tag>
            </div>
            <InputNumber
              size="small"
              style={{ width: '100%' }}
              min={10}
              max={schemaWidth}
              step={1}
              precision={1}
              value={column.width}
              onChange={(val) => onUpdate(index, { ...column, width: val ?? 30 })}
            />
          </div>

          {/* Body Alignment */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Horizontal
              </Text>
              <Segmented
                size="small"
                block
                value={column.align || 'left'}
                options={ALIGN_OPTIONS.map((a) => ({
                  label: (
                    <Tooltip title={a.label}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {a.icon}
                      </span>
                    </Tooltip>
                  ),
                  value: a.value,
                }))}
                onChange={(val) => onUpdate(index, { ...column, align: val as 'left' | 'center' | 'right' })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Vertical
              </Text>
              <Segmented
                size="small"
                block
                value={column.verticalAlign || 'middle'}
                options={VALIGN_OPTIONS.map((a) => ({
                  label: (
                    <Tooltip title={a.label}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {a.icon}
                      </span>
                    </Tooltip>
                  ),
                  value: a.value,
                }))}
                onChange={(val) => onUpdate(index, { ...column, verticalAlign: val as 'top' | 'middle' | 'bottom' })}
              />
            </div>
          </div>

          {/* Header Alignment Override */}
          <div
            style={{
              border: `1px solid ${(column.headerAlign || column.headerVerticalAlign) ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
              borderRadius: token.borderRadiusSM,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                background: (column.headerAlign || column.headerVerticalAlign) ? token.colorPrimaryBg : 'transparent',
              }}
            >
              <Text style={{ fontSize: 10, flex: 1, color: (column.headerAlign || column.headerVerticalAlign) ? token.colorPrimary : token.colorTextSecondary }}>
                Header Alignment
              </Text>
              {!(column.headerAlign || column.headerVerticalAlign) && (
                <Text type="secondary" style={{ fontSize: 9 }}>Inherited</Text>
              )}
              {(column.headerAlign || column.headerVerticalAlign) && (
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => onUpdate(index, { ...column, headerAlign: undefined, headerVerticalAlign: undefined })}
                  style={{ fontSize: 9, padding: 0, height: 'auto', lineHeight: 1 }}
                >
                  Reset
                </Button>
              )}
            </div>
            <div style={{ padding: '4px 6px 6px', display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 1 }}>
                  H-Align
                </Text>
                <Segmented
                  size="small"
                  block
                  value={column.headerAlign || column.align || 'left'}
                  options={ALIGN_OPTIONS.map((a) => ({
                    label: (
                      <Tooltip title={a.label}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {a.icon}
                        </span>
                      </Tooltip>
                    ),
                    value: a.value,
                  }))}
                  onChange={(val) => onUpdate(index, { ...column, headerAlign: val as 'left' | 'center' | 'right' })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 1 }}>
                  V-Align
                </Text>
                <Segmented
                  size="small"
                  block
                  value={column.headerVerticalAlign || 'middle'}
                  options={VALIGN_OPTIONS.map((a) => ({
                    label: (
                      <Tooltip title={a.label}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {a.icon}
                        </span>
                      </Tooltip>
                    ),
                    value: a.value,
                  }))}
                  onChange={(val) => onUpdate(index, { ...column, headerVerticalAlign: val as 'top' | 'middle' | 'bottom' })}
                />
              </div>
            </div>
          </div>

          {/* Text Overflow */}
          <div>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
              Text Overflow
            </Text>
            <Segmented
              size="small"
              block
              value={column.overflow || 'wrap'}
              options={[
                { label: 'Wrap', value: 'wrap' },
                { label: 'Truncate', value: 'truncate' },
                { label: 'Clip', value: 'clip' },
              ]}
              onChange={(val) => onUpdate(index, { ...column, overflow: val as 'wrap' | 'truncate' | 'clip' })}
            />
          </div>

          {/* Format (for field and calculated types) */}
          {colType !== 'static' && (
            <FormatPickerWidget
              value={column.format}
              onChange={(fmt) => onUpdate(index, { ...column, format: fmt })}
            />
          )}

          {/* Body Font Settings */}
          <ColumnFontSettings
            label="Body Font"
            style={column.columnStyle}
            onChange={(s) => onUpdate(index, { ...column, columnStyle: s })}
            fontNames={fontNames}
            token={token}
          />

          {/* Header Font Settings */}
          <ColumnFontSettings
            label="Header Font"
            style={column.headerColumnStyle}
            onChange={(s) => onUpdate(index, { ...column, headerColumnStyle: s })}
            fontNames={fontNames}
            token={token}
          />

          {/* Remove button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <Popconfirm
              title="Remove column?"
              description={`Remove "${column.header || 'this column'}" from the table?`}
              onConfirm={() => onRemove(index)}
              okText="Remove"
              cancelText="Cancel"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                icon={<X size={12} />}
                style={{ fontSize: 11 }}
              >
                Remove
              </Button>
            </Popconfirm>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Widget ─────────────────────────────────────────────────────

/**
 * ColumnConfigWidget — provides a sortable, expandable list of column
 * definitions for lineItemsTable schema elements. Each column card shows
 * a summary row (header, field, width, align) that expands to show full
 * editing controls. Columns can be added, removed, and reordered via
 * drag-and-drop. Supports three column types: Field (data binding),
 * Calculated (expression evaluation), and Static (fixed text).
 *
 * Only renders when activeSchema.type === 'lineItemsTable'.
 */
const ColumnConfigWidget: React.FC<ColumnConfigWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const { fieldGroups, hasFields } = useFieldPalette();
  const font = useContext(FontContext);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());

  // Extract font names from the designer's font context
  const fontNames = useMemo(() => Object.keys(font).sort(), [font]);

  // Read columns from schema (always called — hooks must be unconditional)
  const columnsRaw = (activeSchema as Record<string, unknown>).columns;
  const columns: ColumnDefinition[] = useMemo(() => {
    if (Array.isArray(columnsRaw)) return columnsRaw as ColumnDefinition[];
    return [];
  }, [columnsRaw]);

  // Field binding options
  const fieldOptions = useMemo(
    () => (hasFields ? buildFieldOptions(fieldGroups) : []),
    [fieldGroups, hasFields],
  );
  const allFields = useMemo(
    () => (hasFields ? flattenFieldsWithGroups(fieldGroups) : []),
    [fieldGroups, hasFields],
  );

  // All column keys — used for expression variable hints
  const allColumnKeys = useMemo(
    () => columns.map((c) => c.key).filter(Boolean),
    [columns],
  );

  // Schema width for column width constraints
  const schemaWidth = (activeSchema as Record<string, unknown>).width as number || 190;
  const totalColumnWidth = useMemo(
    () => columns.reduce((sum, c) => sum + (c.width || 0), 0),
    [columns],
  );

  // Sortable item IDs
  const sortableIds = useMemo(
    () => columns.map((_, i) => `col-${i}`),
    [columns.length],
  );

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Commit updated columns array to the schema */
  const commitColumns = useCallback(
    (newColumns: ColumnDefinition[]) => {
      changeSchemas([
        { key: 'columns', value: newColumns, schemaId: activeSchema.id },
      ]);
    },
    [changeSchemas, activeSchema.id],
  );

  /** Update a single column */
  const handleUpdateColumn = useCallback(
    (index: number, updated: ColumnDefinition) => {
      const newColumns = [...columns];
      newColumns[index] = updated;
      commitColumns(newColumns);
    },
    [columns, commitColumns],
  );

  /** Remove a column and redistribute its width among remaining columns */
  const handleRemoveColumn = useCallback(
    (index: number) => {
      const removedWidth = columns[index]?.width || 0;
      const remaining = columns.filter((_, i) => i !== index);
      const remainingTotal = remaining.reduce((s, c) => s + c.width, 0);
      // Distribute the removed column's width proportionally among remaining
      const newColumns = remaining.map((c) => ({
        ...c,
        width: remainingTotal > 0
          ? Math.max(10, Math.round((c.width + (c.width / remainingTotal) * removedWidth) * 10) / 10)
          : schemaWidth / remaining.length,
      }));
      // Adjust expanded indices
      setExpandedIndices((prev) => {
        const next = new Set<number>();
        for (const idx of prev) {
          if (idx < index) next.add(idx);
          else if (idx > index) next.add(idx - 1);
        }
        return next;
      });
      commitColumns(newColumns);
    },
    [columns, commitColumns],
  );

  /** Add a new column */
  const handleAddColumn = useCallback(() => {
    const newIndex = columns.length;
    const newColumn: ColumnDefinition = {
      ...DEFAULT_COLUMN,
      key: `column${newIndex + 1}`,
      header: `Column ${newIndex + 1}`,
      width: Math.round(schemaWidth / (columns.length + 1)),
    };
    // Redistribute existing columns proportionally
    const oldTotal = totalColumnWidth || schemaWidth;
    const targetTotal = schemaWidth;
    const newColWidth = newColumn.width;
    const remainingWidth = targetTotal - newColWidth;
    const redistributed = columns.map((c) => ({
      ...c,
      width: Math.max(10, Math.round((c.width / oldTotal) * remainingWidth * 10) / 10),
    }));
    commitColumns([...redistributed, newColumn]);
    setExpandedIndices((prev) => new Set(prev).add(newIndex));
  }, [columns, commitColumns, schemaWidth, totalColumnWidth]);

  /** Distribute all columns to equal width */
  const handleDistributeEvenly = useCallback(() => {
    if (columns.length === 0) return;
    const evenWidth = Math.round((schemaWidth / columns.length) * 10) / 10;
    const newColumns = columns.map((c) => ({ ...c, width: evenWidth }));
    commitColumns(newColumns);
  }, [columns, commitColumns, schemaWidth]);

  /** Handle drag-to-reorder */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortableIds.indexOf(String(active.id));
      const newIndex = sortableIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(columns, oldIndex, newIndex);

      // Remap expanded indices
      setExpandedIndices((prev) => {
        const next = new Set<number>();
        for (const idx of prev) {
          if (idx === oldIndex) {
            next.add(newIndex);
          } else if (oldIndex < newIndex) {
            // Moved down: items in between shift up
            if (idx > oldIndex && idx <= newIndex) next.add(idx - 1);
            else next.add(idx);
          } else {
            // Moved up: items in between shift down
            if (idx >= newIndex && idx < oldIndex) next.add(idx + 1);
            else next.add(idx);
          }
        }
        return next;
      });

      commitColumns(reordered);
    },
    [columns, sortableIds, commitColumns],
  );

  /** Toggle expand/collapse of a column card */
  const toggleExpand = useCallback((index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Only render for lineItemsTable schemas (after all hooks)
  if (activeSchema.type !== 'lineItemsTable') return null;

  const columnCount = columns.length;

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
        <Columns3
          size={14}
          color={columnCount > 0 ? token.colorPrimary : token.colorTextTertiary}
        />
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Columns
        </Text>
        <Tag
          style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}
          color={columnCount > 0 ? 'blue' : undefined}
        >
          {columnCount}
        </Tag>
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
        <div style={{ padding: '0 8px 8px' }}>
          {/* Empty state */}
          {columnCount === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '16px 8px',
                border: `1px dashed ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusSM,
                marginBottom: 8,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                No columns configured
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Add a column to define the table structure
              </Text>
            </div>
          )}

          {/* Sortable column cards */}
          {columnCount > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortableIds}
                strategy={verticalListSortingStrategy}
              >
                {columns.map((col, idx) => (
                  <SortableColumnCard
                    key={`col-${idx}`}
                    column={col}
                    index={idx}
                    isExpanded={expandedIndices.has(idx)}
                    onToggleExpand={() => toggleExpand(idx)}
                    onUpdate={handleUpdateColumn}
                    onRemove={handleRemoveColumn}
                    fieldOptions={fieldOptions}
                    allFields={allFields}
                    allColumnKeys={allColumnKeys}
                    fontNames={fontNames}
                    schemaWidth={schemaWidth}
                    totalColumnWidth={totalColumnWidth}
                    token={token}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, marginTop: columnCount > 0 ? 4 : 0 }}>
            <Button
              type="dashed"
              size="small"
              icon={<Plus size={12} />}
              onClick={handleAddColumn}
              style={{ flex: 1, fontSize: 11 }}
            >
              Add Column
            </Button>
            {columnCount >= 2 && (
              <Tooltip title="Set all columns to equal width">
                <Button
                  size="small"
                  icon={<Columns3 size={12} />}
                  onClick={handleDistributeEvenly}
                  style={{ fontSize: 11 }}
                >
                  Even
                </Button>
              </Tooltip>
            )}
          </div>

          {/* Width total indicator */}
          {columnCount > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 4,
                padding: '2px 4px',
                fontSize: 9,
                color: Math.abs(totalColumnWidth - schemaWidth) > 1 ? token.colorWarning : token.colorTextQuaternary,
              }}
            >
              <Text type="secondary" style={{ fontSize: 9 }}>
                Total: {totalColumnWidth.toFixed(1)}mm / {schemaWidth}mm
              </Text>
              {Math.abs(totalColumnWidth - schemaWidth) > 1 && (
                <Text style={{ fontSize: 9, color: token.colorWarning }}>
                  {totalColumnWidth > schemaWidth ? 'Over' : 'Under'} by {Math.abs(totalColumnWidth - schemaWidth).toFixed(1)}mm
                </Text>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ColumnConfigWidget;
