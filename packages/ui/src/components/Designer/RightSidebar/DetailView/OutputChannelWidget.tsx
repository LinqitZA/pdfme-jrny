import React, { useState, useCallback } from 'react';
import { theme, Typography, Select, Tag } from 'antd';
import { Send } from 'lucide-react';
import type { SchemaForUI, ChangeSchemaItem } from '@pdfme/common';

const { Text } = Typography;

type OutputChannel = 'both' | 'email' | 'print';

interface OutputChannelWidgetProps {
  activeSchema: SchemaForUI;
  changeSchemas: (changes: ChangeSchemaItem[]) => void;
}

const OUTPUT_CHANNEL_OPTIONS: Array<{ label: string; value: OutputChannel; description: string }> = [
  { label: 'Both (Email & Print)', value: 'both', description: 'Element appears in all outputs' },
  { label: 'Email Only', value: 'email', description: 'Element only in emailed PDFs' },
  { label: 'Print Only', value: 'print', description: 'Element only in printed PDFs' },
];

const CHANNEL_BADGE_COLORS: Record<OutputChannel, string> = {
  both: '',
  email: 'purple',
  print: 'gold',
};

/**
 * OutputChannelWidget - provides a dropdown to control whether an element
 * appears in printed PDFs, emailed PDFs, or both. Sits in the RightSidebar
 * DetailView properties panel below Page Visibility.
 *
 * Output channels:
 * - 'both' (default): element appears in all outputs
 * - 'email': element only appears in emailed PDFs
 * - 'print': element only appears in printed PDFs
 *
 * The outputChannel value is stored as a custom property on the schema object.
 * The backend render pipeline's resolveOutputChannels() reads this property
 * to filter elements per output channel during PDF generation.
 */
const OutputChannelWidget: React.FC<OutputChannelWidgetProps> = ({
  activeSchema,
  changeSchemas,
}) => {
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);

  // Read current outputChannel from the schema (default to 'both')
  const currentChannel = ((activeSchema as Record<string, unknown>).outputChannel as OutputChannel) || 'both';
  const isNonDefault = currentChannel !== 'both';

  /** Update the outputChannel on the schema */
  const handleChannelChange = useCallback(
    (value: OutputChannel) => {
      changeSchemas([
        { key: 'outputChannel', value, schemaId: activeSchema.id },
      ]);
    },
    [changeSchemas, activeSchema.id],
  );

  // Find the label for the current channel
  const currentLabel = OUTPUT_CHANNEL_OPTIONS.find((o) => o.value === currentChannel)?.label || 'Both';

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
        <Send
          size={14}
          color={isNonDefault ? token.colorPrimary : token.colorTextTertiary}
        />
        <Text strong style={{ flex: 1, fontSize: 12 }}>
          Output Channel
        </Text>
        {isNonDefault && (
          <Tag
            color={CHANNEL_BADGE_COLORS[currentChannel] || 'gold'}
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
            value={currentChannel}
            onChange={handleChannelChange}
            options={OUTPUT_CHANNEL_OPTIONS.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
          />
          {isNonDefault && (
            <Text
              type="secondary"
              style={{ fontSize: 11, display: 'block', marginTop: 4 }}
            >
              {OUTPUT_CHANNEL_OPTIONS.find((o) => o.value === currentChannel)?.description}
            </Text>
          )}
        </div>
      )}
    </div>
  );
};

export default OutputChannelWidget;
