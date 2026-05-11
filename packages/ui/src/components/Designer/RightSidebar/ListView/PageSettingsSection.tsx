import React, { useState, useEffect, useMemo } from 'react';
import { isBlankPdf, BasePdf, BlankPdf } from '@pdfme/common';
import { Typography, Select, Button, InputNumber, Collapse, Popover } from 'antd';
import { FileType, RectangleVertical, RectangleHorizontal } from 'lucide-react';
import { PAGE_SIZES, type PageSizeOption } from '../../../../constants.js';
import { SIDEBAR_H_PADDING_PX } from '../layout.js';

const { Text } = Typography;

/** Finds the matching predefined page size (portrait or landscape), or returns 'Custom' */
function detectPageSize(width: number, height: number): string {
  const tolerance = 0.5; // mm
  const portraitMatch = PAGE_SIZES.find(
    (ps) =>
      Math.abs(ps.width - width) < tolerance && Math.abs(ps.height - height) < tolerance,
  );
  if (portraitMatch) return portraitMatch.name;
  const landscapeMatch = PAGE_SIZES.find(
    (ps) =>
      Math.abs(ps.width - height) < tolerance && Math.abs(ps.height - width) < tolerance,
  );
  if (landscapeMatch) return landscapeMatch.name;
  return 'Custom';
}

type PageSettingsSectionProps = {
  basePdf: BasePdf;
  onPageSizeChange?: (width: number, height: number) => void;
  onPaddingChange?: (padding: [number, number, number, number]) => void;
};

const PageSettingsSection = ({
  basePdf,
  onPageSizeChange,
  onPaddingChange,
}: PageSettingsSectionProps) => {
  if (!isBlankPdf(basePdf)) return null;
  if (!onPageSizeChange && !onPaddingChange) return null;

  const blankPdf = basePdf as BlankPdf;
  const { width, height, padding } = blankPdf;
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = padding;

  const isPortrait = height > width;
  const detectedSize = detectPageSize(width, height);

  const [customWidth, setCustomWidth] = useState(width);
  const [customHeight, setCustomHeight] = useState(height);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Sync custom inputs when basePdf changes externally
  useEffect(() => {
    setCustomWidth(width);
    setCustomHeight(height);
  }, [width, height]);

  // Build grouped select options
  const selectOptions = useMemo(() => {
    const standard = PAGE_SIZES.filter((ps) => ps.group === 'standard');
    const labels = PAGE_SIZES.filter((ps) => ps.group === 'labels');
    return [
      {
        label: 'Standard',
        options: standard.map((ps) => ({
          label: `${ps.name} (${ps.width}×${ps.height}mm)`,
          value: ps.name,
        })),
      },
      {
        label: 'Labels',
        options: labels.map((ps) => ({
          label: `${ps.name} (${ps.width}×${ps.height}mm)`,
          value: ps.name,
        })),
      },
      {
        label: 'Other',
        options: [{ label: 'Custom...', value: 'Custom' }],
      },
    ];
  }, []);

  const handleSelectSize = (value: string) => {
    if (value === 'Custom') {
      setCustomWidth(width);
      setCustomHeight(height);
      setPopoverOpen(true);
      return;
    }
    const ps = PAGE_SIZES.find((p) => p.name === value);
    if (ps && onPageSizeChange) {
      // Match current orientation
      if (isPortrait) {
        onPageSizeChange(ps.width, ps.height);
      } else {
        onPageSizeChange(ps.height, ps.width);
      }
    }
  };

  const handleCustomApply = () => {
    if (customWidth > 0 && customHeight > 0 && onPageSizeChange) {
      onPageSizeChange(customWidth, customHeight);
      setPopoverOpen(false);
    }
  };

  const handleOrientationToggle = () => {
    if (onPageSizeChange) {
      onPageSizeChange(height, width);
    }
  };

  const handlePaddingChange = (index: number, value: number | null) => {
    if (value === null || !onPaddingChange) return;
    const newPadding: [number, number, number, number] = [...padding] as [number, number, number, number];
    newPadding[index] = value;
    onPaddingChange(newPadding);
  };

  const customPopoverContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4, minWidth: 180 }}>
      <Text strong style={{ fontSize: 12 }}>Custom page size (mm)</Text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 11, minWidth: 36 }}>Width:</Text>
        <InputNumber
          size="small"
          min={10}
          max={1000}
          value={customWidth}
          onChange={(v) => v !== null && setCustomWidth(v)}
          style={{ width: 80 }}
          precision={1}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 11, minWidth: 36 }}>Height:</Text>
        <InputNumber
          size="small"
          min={10}
          max={1000}
          value={customHeight}
          onChange={(v) => v !== null && setCustomHeight(v)}
          style={{ width: 80 }}
          precision={1}
        />
      </div>
      <Button
        size="small"
        type="primary"
        onClick={handleCustomApply}
        style={{ marginTop: 4 }}
      >
        Apply
      </Button>
    </div>
  );

  const paddingLabels = ['Top', 'Right', 'Bottom', 'Left'] as const;
  const paddingValues = [paddingTop, paddingRight, paddingBottom, paddingLeft];

  const collapseItems = [
    {
      key: 'page-settings',
      label: (
        <Text strong style={{ fontSize: 13 }}>
          Page Settings
        </Text>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Page Size */}
          {onPageSizeChange && (
            <div>
              <Text style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                Page Size
              </Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Popover
                  content={customPopoverContent}
                  trigger="click"
                  open={popoverOpen}
                  onOpenChange={setPopoverOpen}
                  placement="left"
                >
                  <span />
                </Popover>
                <FileType size={14} style={{ flexShrink: 0, color: '#888' }} />
                <Select
                  size="small"
                  value={detectedSize}
                  onChange={handleSelectSize}
                  options={selectOptions}
                  popupMatchSelectWidth={false}
                  style={{ flex: 1 }}
                  styles={{ popup: { root: { minWidth: 220 } } }}
                />
              </div>
            </div>
          )}

          {/* Orientation */}
          {onPageSizeChange && (
            <div>
              <Text style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                Orientation
              </Text>
              <Button
                size="small"
                onClick={handleOrientationToggle}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {isPortrait ? (
                  <>
                    <RectangleVertical size={14} />
                    <span>Portrait</span>
                  </>
                ) : (
                  <>
                    <RectangleHorizontal size={14} />
                    <span>Landscape</span>
                  </>
                )}
              </Button>
              <Text style={{ fontSize: 11, color: '#aaa', marginTop: 2, display: 'block' }}>
                {width} x {height} mm
              </Text>
            </div>
          )}

          {/* Padding */}
          {onPaddingChange && (
            <div>
              <Text style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>
                Padding (mm)
              </Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {paddingLabels.map((label, index) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 11, minWidth: 32 }}>{label}:</Text>
                    <InputNumber
                      size="small"
                      min={0}
                      max={Math.min(width, height) / 2}
                      value={paddingValues[index]}
                      onChange={(v) => handlePaddingChange(index, v)}
                      style={{ width: '100%' }}
                      precision={1}
                      step={0.5}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: `0 0 8px 0` }}>
      <Collapse
        size="small"
        defaultActiveKey={['page-settings']}
        items={collapseItems}
        variant="borderless"
        style={{ background: 'transparent' }}
      />
    </div>
  );
};

export default PageSettingsSection;
