import React, { useState, useCallback, useMemo } from 'react';
import { theme, Typography, Switch, Tag, InputNumber, Checkbox, Tooltip } from 'antd';
import { ScanBarcode, HelpCircle } from 'lucide-react';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';

const { Text } = Typography;

interface TrackingDetailWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

/** Default serial detail fields */
const DEFAULT_SERIAL_FIELDS = ['serialNo', 'status'];
/** Default lot detail fields */
const DEFAULT_LOT_FIELDS = ['lotNo', 'qty', 'expiryDate'];

/** Available serial fields with labels */
const SERIAL_FIELD_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'serialNo', label: 'Serial Number' },
  { key: 'status', label: 'Status' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'condition', label: 'Condition' },
  { key: 'location', label: 'Location' },
];

/** Available lot fields with labels */
const LOT_FIELD_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'lotNo', label: 'Lot Number' },
  { key: 'qty', label: 'Quantity' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'manufacturingDate', label: 'Manufacturing Date' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'batchRef', label: 'Batch Reference' },
];

/**
 * TrackingDetailWidget — configures serial and lot tracking detail sub-rows
 * for lineItemsTable schema elements. Provides a toggle to enable tracking
 * details, field selection for serial and lot data, and styling controls
 * for the detail sub-rows.
 *
 * Only renders when activeSchema.type === 'lineItemsTable'.
 *
 * Schema properties managed:
 * - showTrackingDetails: boolean — master toggle
 * - trackingSerialFields: string[] — which serial fields to show
 * - trackingLotFields: string[] — which lot fields to show
 * - trackingDetailStyle: { fontSize, backgroundColor, indent, fontColor }
 */
const TrackingDetailWidget: React.FC<TrackingDetailWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);

  // Read current tracking config from schema
  const schemaRaw = activeSchema as Record<string, unknown>;
  const showTrackingDetails = schemaRaw.showTrackingDetails === true;
  const trackingSerialFields = useMemo(
    () => (Array.isArray(schemaRaw.trackingSerialFields) ? schemaRaw.trackingSerialFields as string[] : DEFAULT_SERIAL_FIELDS),
    [schemaRaw.trackingSerialFields],
  );
  const trackingLotFields = useMemo(
    () => (Array.isArray(schemaRaw.trackingLotFields) ? schemaRaw.trackingLotFields as string[] : DEFAULT_LOT_FIELDS),
    [schemaRaw.trackingLotFields],
  );
  const trackingDetailStyle = useMemo(
    () => (schemaRaw.trackingDetailStyle as Record<string, unknown>) || {},
    [schemaRaw.trackingDetailStyle],
  );

  /** Helper to commit a single schema property */
  const setSchemaProperty = useCallback(
    (key: string, value: unknown) => {
      changeSchemas([{ key, value, schemaId: activeSchema.id }]);
    },
    [changeSchemas, activeSchema.id],
  );

  /** Toggle the master tracking details switch */
  const handleToggle = useCallback(
    (checked: boolean) => {
      setSchemaProperty('showTrackingDetails', checked);
      // Set defaults when enabling for the first time
      if (checked && !Array.isArray(schemaRaw.trackingSerialFields)) {
        changeSchemas([
          { key: 'showTrackingDetails', value: true, schemaId: activeSchema.id },
          { key: 'trackingSerialFields', value: DEFAULT_SERIAL_FIELDS, schemaId: activeSchema.id },
          { key: 'trackingLotFields', value: DEFAULT_LOT_FIELDS, schemaId: activeSchema.id },
          {
            key: 'trackingDetailStyle',
            value: { fontSize: 7, backgroundColor: '#f9fafb', indent: 4, fontColor: '#6b7280' },
            schemaId: activeSchema.id,
          },
        ]);
      }
    },
    [changeSchemas, activeSchema.id, schemaRaw.trackingSerialFields, setSchemaProperty],
  );

  /** Toggle a serial field */
  const handleSerialFieldToggle = useCallback(
    (field: string, checked: boolean) => {
      const newFields = checked
        ? [...trackingSerialFields, field]
        : trackingSerialFields.filter((f) => f !== field);
      setSchemaProperty('trackingSerialFields', newFields);
    },
    [trackingSerialFields, setSchemaProperty],
  );

  /** Toggle a lot field */
  const handleLotFieldToggle = useCallback(
    (field: string, checked: boolean) => {
      const newFields = checked
        ? [...trackingLotFields, field]
        : trackingLotFields.filter((f) => f !== field);
      setSchemaProperty('trackingLotFields', newFields);
    },
    [trackingLotFields, setSchemaProperty],
  );

  /** Update a style property */
  const handleStyleChange = useCallback(
    (prop: string, value: unknown) => {
      const newStyle = { ...trackingDetailStyle, [prop]: value };
      setSchemaProperty('trackingDetailStyle', newStyle);
    },
    [trackingDetailStyle, setSchemaProperty],
  );

  // Only render for lineItemsTable schemas
  if (activeSchema.type !== 'lineItemsTable') return null;

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
        <ScanBarcode
          size={14}
          color={showTrackingDetails ? token.colorPrimary : token.colorTextTertiary}
        />
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Serial/Lot Details
        </Text>
        {showTrackingDetails && (
          <Tag
            color="purple"
            style={{ fontSize: 10, lineHeight: '16px', margin: 0, padding: '0 4px' }}
          >
            On
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
          {/* Master toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: showTrackingDetails ? 10 : 0,
            }}
          >
            <Switch
              size="small"
              checked={showTrackingDetails}
              onChange={handleToggle}
            />
            <Text style={{ fontSize: 12 }}>
              Show Serial/Lot Details
            </Text>
            <Tooltip
              title="When enabled, items with serial numbers or lot numbers will display detail sub-rows beneath each line item."
              placement="left"
            >
              <HelpCircle size={12} style={{ color: token.colorTextTertiary, cursor: 'help' }} />
            </Tooltip>
          </div>

          {showTrackingDetails && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Serial Fields section */}
              <div>
                <Text
                  type="secondary"
                  style={{ fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  Serial Fields
                </Text>
                <div
                  style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {SERIAL_FIELD_OPTIONS.map((opt) => (
                    <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Checkbox
                        checked={trackingSerialFields.includes(opt.key)}
                        onChange={(e) => handleSerialFieldToggle(opt.key, e.target.checked)}
                        style={{ fontSize: 11 }}
                      >
                        <span style={{ fontSize: 11 }}>{opt.label}</span>
                      </Checkbox>
                      <Text
                        type="secondary"
                        style={{ fontSize: 9, fontFamily: 'monospace', marginLeft: 'auto' }}
                      >
                        {opt.key}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lot Fields section */}
              <div>
                <Text
                  type="secondary"
                  style={{ fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  Lot Fields
                </Text>
                <div
                  style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {LOT_FIELD_OPTIONS.map((opt) => (
                    <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Checkbox
                        checked={trackingLotFields.includes(opt.key)}
                        onChange={(e) => handleLotFieldToggle(opt.key, e.target.checked)}
                        style={{ fontSize: 11 }}
                      >
                        <span style={{ fontSize: 11 }}>{opt.label}</span>
                      </Checkbox>
                      <Text
                        type="secondary"
                        style={{ fontSize: 9, fontFamily: 'monospace', marginLeft: 'auto' }}
                      >
                        {opt.key}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail Row Styling */}
              <div>
                <Text
                  type="secondary"
                  style={{ fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  Detail Row Style
                </Text>
                <div
                  style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {/* Font Size + Indent row */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 2 }}>
                        Font Size
                      </Text>
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={5}
                        max={20}
                        step={0.5}
                        value={(trackingDetailStyle.fontSize as number) ?? 7}
                        onChange={(val) => handleStyleChange('fontSize', val ?? 7)}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 2 }}>
                        Indent
                      </Text>
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={0}
                        max={20}
                        step={1}
                        value={(trackingDetailStyle.indent as number) ?? 4}
                        onChange={(val) => handleStyleChange('indent', val ?? 4)}
                      />
                    </div>
                  </div>

                  {/* Background Color + Font Color */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 2 }}>
                        Background
                      </Text>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="color"
                          value={(trackingDetailStyle.backgroundColor as string) || '#f9fafb'}
                          onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
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
                          value={(trackingDetailStyle.backgroundColor as string) || '#f9fafb'}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === '') {
                              handleStyleChange('backgroundColor', val || '#f9fafb');
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: '2px 4px',
                            fontSize: 10,
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
                    <div style={{ flex: 1 }}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block', marginBottom: 2 }}>
                        Font Color
                      </Text>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="color"
                          value={(trackingDetailStyle.fontColor as string) || '#6b7280'}
                          onChange={(e) => handleStyleChange('fontColor', e.target.value)}
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
                          value={(trackingDetailStyle.fontColor as string) || '#6b7280'}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === '') {
                              handleStyleChange('fontColor', val || '#6b7280');
                            }
                          }}
                          style={{
                            flex: 1,
                            padding: '2px 4px',
                            fontSize: 10,
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

                  {/* Preview */}
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: token.borderRadiusSM,
                      fontSize: (trackingDetailStyle.fontSize as number) ?? 7,
                      color: (trackingDetailStyle.fontColor as string) || '#6b7280',
                      backgroundColor: (trackingDetailStyle.backgroundColor as string) || '#f9fafb',
                      border: `1px dashed ${token.colorBorderSecondary}`,
                      fontFamily: 'Arial, sans-serif',
                    }}
                  >
                    {' '.repeat((trackingDetailStyle.indent as number) ?? 4)}↳ S/N: Serial No: ABC-001 | Status: Active
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TrackingDetailWidget;
