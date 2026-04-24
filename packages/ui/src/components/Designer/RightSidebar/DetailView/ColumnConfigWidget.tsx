import React, { useState, useCallback, useMemo } from 'react';
import { theme, Typography, Button, Select, InputNumber, Tag, Tooltip, Popconfirm } from 'antd';
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
} from 'lucide-react';
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

const { Text } = Typography;

// ─── Types ───────────────────────────────────────────────────────────

interface ColumnDefinition {
  key: string;
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  format?: string;
  colSpan?: number;
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

const DEFAULT_COLUMN: ColumnDefinition = {
  key: '',
  header: 'New Column',
  width: 30,
  align: 'left',
  format: '',
};

/** Flatten FieldGroups into Select options */
const buildFieldOptions = (
  groups: FieldGroup[],
  prefix = '',
): Array<{ label: string; options: Array<{ label: string; value: string }> }> => {
  const result: Array<{ label: string; options: Array<{ label: string; value: string }> }> = [];
  for (const group of groups) {
    const groupLabel = prefix ? `${prefix} > ${group.label}` : group.label;
    if (group.fields.length > 0) {
      result.push({
        label: groupLabel,
        options: group.fields.map((field) => ({
          label: field.label,
          value: field.key,
        })),
      });
    }
    if (group.children) {
      result.push(...buildFieldOptions(group.children, groupLabel));
    }
  }
  return result;
};

/** Flatten all fields for lookup */
const flattenFields = (groups: FieldGroup[]): FieldEntry[] => {
  const result: FieldEntry[] = [];
  for (const group of groups) {
    result.push(...group.fields);
    if (group.children) result.push(...flattenFields(group.children));
  }
  return result;
};

// ─── SortableColumnCard ──────────────────────────────────────────────

interface SortableColumnCardProps {
  column: ColumnDefinition;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (index: number, updated: ColumnDefinition) => void;
  onRemove: (index: number) => void;
  fieldOptions: Array<{ label: string; options: Array<{ label: string; value: string }> }>;
  allFields: FieldEntry[];
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

  const alignIcon = ALIGN_OPTIONS.find((a) => a.value === (column.align || 'left'))?.icon;
  const fieldLabel = allFields.find((f) => f.key === column.key)?.label;

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

        {/* Bound field indicator */}
        {column.key && (
          <Tooltip title={`Field: ${column.key}`}>
            <Tag
              color="blue"
              style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 3px', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {fieldLabel || column.key}
            </Tag>
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

          {/* Field key binding */}
          <div>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
              Data Field
            </Text>
            {fieldOptions.length > 0 ? (
              <Select
                showSearch
                allowClear
                style={{ width: '100%' }}
                size="small"
                placeholder="Select field..."
                value={column.key || undefined}
                options={fieldOptions}
                filterOption={(input, option) => {
                  const label = String(option?.label ?? '');
                  const value = String(option?.value ?? '');
                  const search = input.toLowerCase();
                  return label.toLowerCase().includes(search) || value.toLowerCase().includes(search);
                }}
                onChange={(value) => onUpdate(index, { ...column, key: value || '' })}
              />
            ) : (
              <input
                type="text"
                value={column.key}
                onChange={(e) => onUpdate(index, { ...column, key: e.target.value })}
                placeholder="e.g. lineItems.description"
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

          {/* Width + Alignment row */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Width (mm)
              </Text>
              <InputNumber
                size="small"
                style={{ width: '100%' }}
                min={5}
                max={500}
                step={5}
                value={column.width}
                onChange={(val) => onUpdate(index, { ...column, width: val ?? 30 })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
                Alignment
              </Text>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={column.align || 'left'}
                options={ALIGN_OPTIONS.map((a) => ({
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {a.icon} {a.label}
                    </span>
                  ),
                  value: a.value,
                }))}
                onChange={(val) => onUpdate(index, { ...column, align: val })}
              />
            </div>
          </div>

          {/* Format */}
          <div>
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
              Number Format
            </Text>
            <Select
              size="small"
              style={{ width: '100%' }}
              allowClear
              placeholder="None"
              value={column.format || undefined}
              options={[
                { label: '#,##0', value: '#,##0' },
                { label: '#,##0.00', value: '#,##0.00' },
                { label: '#,##0.0000', value: '#,##0.0000' },
                { label: '0.00', value: '0.00' },
                { label: '0', value: '0' },
              ]}
              onChange={(val) => onUpdate(index, { ...column, format: val || '' })}
            />
          </div>

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
 * drag-and-drop.
 *
 * Only renders when activeSchema.type === 'lineItemsTable'.
 */
const ColumnConfigWidget: React.FC<ColumnConfigWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const { fieldGroups, hasFields } = useFieldPalette();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());

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
    () => (hasFields ? flattenFields(fieldGroups) : []),
    [fieldGroups, hasFields],
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

  /** Remove a column */
  const handleRemoveColumn = useCallback(
    (index: number) => {
      const newColumns = columns.filter((_, i) => i !== index);
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
    };
    commitColumns([...columns, newColumn]);
    setExpandedIndices((prev) => new Set(prev).add(newIndex));
  }, [columns, commitColumns]);

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
                    token={token}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}

          {/* Add Column button */}
          <Button
            type="dashed"
            size="small"
            icon={<Plus size={12} />}
            onClick={handleAddColumn}
            style={{
              width: '100%',
              fontSize: 11,
              marginTop: columnCount > 0 ? 4 : 0,
            }}
          >
            Add Column
          </Button>
        </div>
      )}
    </div>
  );
};

export default ColumnConfigWidget;
