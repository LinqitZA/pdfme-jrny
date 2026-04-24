import React, { useState, useMemo, useCallback } from 'react';
import { theme, Typography, Select, Input, Tag } from 'antd';
import { Eye } from 'lucide-react';

const { Text } = Typography;

// ─── Format Preset Definitions ──────────────────────────────────────

interface FormatPreset {
  label: string;
  value: string;
}

interface FormatCategory {
  key: string;
  label: string;
  presets: FormatPreset[];
}

const FORMAT_CATEGORIES: FormatCategory[] = [
  {
    key: 'currency',
    label: 'Currency',
    presets: [
      { label: 'R #,##0.00 (ZAR)', value: 'R #,##0.00' },
      { label: '$ #,##0.00 (USD)', value: '$ #,##0.00' },
      { label: '€ #,##0.00 (EUR)', value: '€ #,##0.00' },
      { label: '#,##0.00 (plain)', value: '#,##0.00' },
    ],
  },
  {
    key: 'number',
    label: 'Number',
    presets: [
      { label: '#,##0', value: '#,##0' },
      { label: '#,##0.00', value: '#,##0.00' },
      { label: '#,##0.000', value: '#,##0.000' },
      { label: '0', value: '0' },
      { label: '0.00', value: '0.00' },
    ],
  },
  {
    key: 'percentage',
    label: 'Percentage',
    presets: [
      { label: '0%', value: '0%' },
      { label: '0.0%', value: '0.0%' },
      { label: '0.00%', value: '0.00%' },
    ],
  },
  {
    key: 'date',
    label: 'Date',
    presets: [
      { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
      { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
      { label: 'DD MMM YYYY', value: 'DD MMM YYYY' },
    ],
  },
  {
    key: 'text',
    label: 'Text (no format)',
    presets: [{ label: 'None', value: '' }],
  },
];

/** All preset values for matching */
const ALL_PRESET_VALUES = new Set(
  FORMAT_CATEGORIES.flatMap((cat) => cat.presets.map((p) => p.value)),
);

/** Custom option sentinel */
const CUSTOM_VALUE = '__custom__';

// ─── Format Preview Logic ───────────────────────────────────────────

const SAMPLE_VALUE = 12345.6789;

/** Date format examples for preview */
const DATE_EXAMPLES: Record<string, string> = {
  'DD/MM/YYYY': '24/04/2026',
  'YYYY-MM-DD': '2026-04-24',
  'DD MMM YYYY': '24 Apr 2026',
};

/**
 * Format a numeric sample value using a format string for live preview.
 * Mirrors the logic in formatNumber() from line-items-table plugin.
 */
export function formatPreview(value: number, format: string): string {
  if (!format) return String(value);

  // Date formats — show date example
  if (DATE_EXAMPLES[format]) return DATE_EXAMPLES[format];

  // Check for percentage suffix
  const isPercentage = format.endsWith('%');
  let numberFormat = isPercentage ? format.slice(0, -1) : format;

  // Extract prefix (everything before first # or 0)
  let prefix = '';
  const firstFormatChar = numberFormat.search(/[#0]/);
  if (firstFormatChar > 0) {
    prefix = numberFormat.slice(0, firstFormatChar);
    numberFormat = numberFormat.slice(firstFormatChar);
  } else if (firstFormatChar < 0) {
    // No numeric format chars found — return raw value
    return String(value);
  }

  // Count decimal places from format
  const dotIdx = numberFormat.indexOf('.');
  let decimals = 0;
  if (dotIdx >= 0) {
    decimals = numberFormat.length - dotIdx - 1;
  }

  // Thousand separator
  const hasThousandSep = numberFormat.includes(',');

  let result = value.toFixed(decimals);

  if (hasThousandSep) {
    const parts = result.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    result = parts.join('.');
  }

  return prefix + result + (isPercentage ? '%' : '');
}

// ─── Component ──────────────────────────────────────────────────────

interface FormatPickerWidgetProps {
  value: string | undefined;
  onChange: (format: string) => void;
}

const FormatPickerWidget: React.FC<FormatPickerWidgetProps> = ({
  value,
  onChange,
}) => {
  const { token } = theme.useToken();
  const currentFormat = value || '';

  // Determine if the current format is a known preset or custom
  const isCustom = currentFormat !== '' && !ALL_PRESET_VALUES.has(currentFormat);
  const [showCustomInput, setShowCustomInput] = useState(isCustom);
  const [customValue, setCustomValue] = useState(isCustom ? currentFormat : '');

  // Build Select options with optgroups
  const selectOptions = useMemo(() => {
    const groups = FORMAT_CATEGORIES.map((cat) => ({
      label: cat.label,
      options: cat.presets.map((p) => ({
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{p.label}</span>
            {p.value && (
              <span
                style={{
                  fontSize: 10,
                  color: token.colorTextQuaternary,
                  marginLeft: 'auto',
                }}
              >
                {formatPreview(SAMPLE_VALUE, p.value)}
              </span>
            )}
          </span>
        ),
        value: p.value,
        searchLabel: `${p.label} ${p.value} ${cat.label}`,
      })),
    }));

    // Add custom option at the end
    groups.push({
      label: 'Custom',
      options: [
        {
          label: (
            <span style={{ fontStyle: 'italic', color: token.colorTextSecondary }}>
              Enter custom format...
            </span>
          ),
          value: CUSTOM_VALUE,
          searchLabel: 'custom format',
        },
      ],
    });

    return groups;
  }, [token]);

  // Determine the Select's displayed value
  const selectValue = useMemo(() => {
    if (!currentFormat) return undefined; // Show placeholder
    if (isCustom || showCustomInput) return CUSTOM_VALUE;
    return currentFormat;
  }, [currentFormat, isCustom, showCustomInput]);

  const handleSelectChange = useCallback(
    (val: string | undefined) => {
      if (val === CUSTOM_VALUE) {
        setShowCustomInput(true);
        // Don't change the format yet — wait for custom input
        return;
      }
      setShowCustomInput(false);
      setCustomValue('');
      onChange(val || '');
    },
    [onChange],
  );

  const handleCustomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value;
      setCustomValue(newVal);
      onChange(newVal);
    },
    [onChange],
  );

  // Detect category for color badge
  const formatCategory = useMemo(() => {
    if (!currentFormat) return null;
    for (const cat of FORMAT_CATEGORIES) {
      if (cat.presets.some((p) => p.value === currentFormat)) {
        return cat.key;
      }
    }
    return 'custom';
  }, [currentFormat]);

  const categoryColors: Record<string, string> = {
    currency: '#faad14',
    number: '#1677ff',
    percentage: '#52c41a',
    date: '#722ed1',
    custom: '#eb2f96',
  };

  // Compute preview
  const preview = useMemo(() => {
    if (!currentFormat) return null;
    return formatPreview(SAMPLE_VALUE, currentFormat);
  }, [currentFormat]);

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>
        Format
        {formatCategory && (
          <Tag
            style={{
              fontSize: 9,
              lineHeight: '14px',
              margin: '0 0 0 4px',
              padding: '0 3px',
              verticalAlign: 'middle',
            }}
            color={categoryColors[formatCategory]}
          >
            {formatCategory === 'custom' ? 'Custom' : FORMAT_CATEGORIES.find((c) => c.key === formatCategory)?.label}
          </Tag>
        )}
      </Text>

      {/* Preset Select */}
      <Select
        showSearch
        allowClear
        size="small"
        style={{ width: '100%' }}
        placeholder="None (plain text)"
        value={selectValue}
        options={selectOptions}
        filterOption={(input, option) => {
          const searchLabel = (option as Record<string, unknown>)?.searchLabel;
          if (typeof searchLabel === 'string') {
            return searchLabel.toLowerCase().includes(input.toLowerCase());
          }
          const val = String(option?.value ?? '');
          return val.toLowerCase().includes(input.toLowerCase());
        }}
        onChange={handleSelectChange}
      />

      {/* Custom format input — shown when "Custom" is selected or format doesn't match presets */}
      {showCustomInput && (
        <Input
          size="small"
          placeholder="e.g. R #,##0.00"
          value={customValue}
          onChange={handleCustomChange}
          style={{ marginTop: 4, fontSize: 12 }}
        />
      )}

      {/* Live preview */}
      {preview && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            padding: '3px 6px',
            background: token.colorBgTextHover,
            borderRadius: token.borderRadiusSM,
            fontSize: 11,
          }}
        >
          <Eye size={10} color={token.colorTextSecondary} />
          <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>
            Preview:
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview}
          </Text>
        </div>
      )}
    </div>
  );
};

export default FormatPickerWidget;
