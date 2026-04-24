import React, { useContext, useState, useMemo } from 'react';
import { Size } from '@pdfme/common';
// Import icons from lucide-react
// Note: In tests, these will be mocked by the mock file in __mocks__/lucide-react.js
import { Plus, Minus, ChevronLeft, ChevronRight, Ellipsis, FileType, Grid3x3, RectangleVertical, RectangleHorizontal } from 'lucide-react';

import type { MenuProps } from 'antd';
import { theme, Typography, Button, Dropdown, Select, InputNumber, Popover } from 'antd';
import { I18nContext } from '../contexts.js';
import { useMaxZoom } from '../helper.js';
import { UI_CLASSNAME, PAGE_SIZES, type PageSizeOption } from '../constants.js';
import type { GridSizeMm } from '../contexts/GridContext.js';

const { Text } = Typography;

type TextStyle = { color: string; fontSize: number; margin: number };
type ZoomProps = {
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  style: { textStyle: TextStyle };
};

const Zoom = ({ zoomLevel, setZoomLevel, style }: ZoomProps) => {
  const zoomStep = 0.25;
  const maxZoom = useMaxZoom();
  const minZoom = 0.25;

  const nextZoomOut = zoomLevel - zoomStep;
  const nextZoomIn = zoomLevel + zoomStep;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Button
        className={UI_CLASSNAME + 'zoom-out'}
        type="text"
        disabled={minZoom >= nextZoomOut}
        onClick={() => setZoomLevel(nextZoomOut)}
        icon={<Minus size={16} color={style.textStyle.color} />}
      />
      <Text strong style={style.textStyle}>
        {Math.round(zoomLevel * 100)}%
      </Text>
      <Button
        className={UI_CLASSNAME + 'zoom-in'}
        type="text"
        disabled={maxZoom < nextZoomIn}
        onClick={() => setZoomLevel(nextZoomIn)}
        icon={<Plus size={16} color={style.textStyle.color} />}
      />
    </div>
  );
};

type PagerProps = {
  pageCursor: number;
  pageNum: number;
  setPageCursor: (page: number) => void;
  style: { textStyle: TextStyle };
};

const Pager = ({ pageCursor, pageNum, setPageCursor, style }: PagerProps) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Button className={UI_CLASSNAME + 'page-prev'} type="text" disabled={pageCursor <= 0} onClick={() => setPageCursor(pageCursor - 1)}>
        <ChevronLeft size={16} color={style.textStyle.color} />
      </Button>
      <Text strong style={style.textStyle}>
        {pageCursor + 1}/{pageNum}
      </Text>
      <Button
        className={UI_CLASSNAME + 'page-next'}
        type="text"
        disabled={pageCursor + 1 >= pageNum}
        onClick={() => setPageCursor(pageCursor + 1)}
      >
        <ChevronRight size={16} color={style.textStyle.color} />
      </Button>
    </div>
  );
};

type ContextMenuProps = {
  items: MenuProps['items'];
  style: { textStyle: TextStyle };
};
const ContextMenu = ({ items, style }: ContextMenuProps) => (
  <Dropdown menu={{ items }} placement="top" arrow trigger={['click']}>
    <Button className={UI_CLASSNAME + 'context-menu'} type="text">
      <Ellipsis size={16} color={style.textStyle.color} />
    </Button>
  </Dropdown>
);

/** Finds the matching predefined page size (portrait or landscape), or returns 'Custom' */
function detectPageSize(width: number, height: number): string {
  const tolerance = 0.5; // mm
  // Check portrait match
  const portraitMatch = PAGE_SIZES.find(
    (ps) =>
      Math.abs(ps.width - width) < tolerance && Math.abs(ps.height - height) < tolerance,
  );
  if (portraitMatch) return portraitMatch.name;
  // Check landscape match (swapped width/height)
  const landscapeMatch = PAGE_SIZES.find(
    (ps) =>
      Math.abs(ps.width - height) < tolerance && Math.abs(ps.height - width) < tolerance,
  );
  if (landscapeMatch) return landscapeMatch.name;
  return 'Custom';
}

type PageSizeSelectorProps = {
  currentWidth: number;
  currentHeight: number;
  onPageSizeChange: (width: number, height: number) => void;
  style: { textStyle: TextStyle };
};

const PageSizeSelector = ({
  currentWidth,
  currentHeight,
  onPageSizeChange,
  style,
}: PageSizeSelectorProps) => {
  const { token } = theme.useToken();
  const detectedSize = detectPageSize(currentWidth, currentHeight);
  const [customWidth, setCustomWidth] = useState(currentWidth);
  const [customHeight, setCustomHeight] = useState(currentHeight);
  const [popoverOpen, setPopoverOpen] = useState(false);

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

  const handleSelect = (value: string) => {
    if (value === 'Custom') {
      setCustomWidth(currentWidth);
      setCustomHeight(currentHeight);
      setPopoverOpen(true);
      return;
    }
    const ps = PAGE_SIZES.find((p) => p.name === value);
    if (ps) {
      onPageSizeChange(ps.width, ps.height);
    }
  };

  const handleCustomApply = () => {
    if (customWidth > 0 && customHeight > 0) {
      onPageSizeChange(customWidth, customHeight);
      setPopoverOpen(false);
    }
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Popover
        content={customPopoverContent}
        trigger="click"
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        placement="top"
      >
        <span />
      </Popover>
      <FileType size={14} color={style.textStyle.color} style={{ flexShrink: 0 }} />
      <Select
        className={UI_CLASSNAME + 'page-size'}
        size="small"
        value={detectedSize}
        onChange={handleSelect}
        options={selectOptions}
        popupMatchSelectWidth={false}
        style={{
          minWidth: 80,
          maxWidth: 140,
        }}
        dropdownStyle={{
          minWidth: 220,
        }}
        variant="borderless"
        labelRender={({ label, value }) => (
          <Text strong style={{ ...style.textStyle, margin: 0, fontSize: 12, whiteSpace: 'nowrap' }}>
            {value}
          </Text>
        )}
      />
    </div>
  );
};

type OrientationToggleProps = {
  currentWidth: number;
  currentHeight: number;
  onPageSizeChange: (width: number, height: number) => void;
  style: { textStyle: TextStyle };
};

const OrientationToggle = ({
  currentWidth,
  currentHeight,
  onPageSizeChange,
  style,
}: OrientationToggleProps) => {
  const isPortrait = currentHeight > currentWidth;

  const handleToggle = () => {
    // Swap width and height to toggle orientation
    onPageSizeChange(currentHeight, currentWidth);
  };

  return (
    <Button
      className={UI_CLASSNAME + 'orientation-toggle'}
      type="text"
      onClick={handleToggle}
      title={isPortrait ? 'Switch to landscape' : 'Switch to portrait'}
      style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}
    >
      {isPortrait ? (
        <RectangleVertical size={16} color={style.textStyle.color} />
      ) : (
        <RectangleHorizontal size={16} color={style.textStyle.color} />
      )}
    </Button>
  );
};

/** Grid size options: None, 2.5mm, 5mm (default), 10mm */
const GRID_SIZE_OPTIONS: { label: string; value: GridSizeMm }[] = [
  { label: 'None', value: 0 },
  { label: '2.5mm', value: 2.5 },
  { label: '5mm', value: 5 },
  { label: '10mm', value: 10 },
];

type GridSizeSelectorProps = {
  gridSizeMm: GridSizeMm;
  setGridSizeMm: (size: GridSizeMm) => void;
  style: { textStyle: TextStyle };
};

const GridSizeSelector = ({ gridSizeMm, setGridSizeMm, style }: GridSizeSelectorProps) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Grid3x3 size={14} color={style.textStyle.color} style={{ flexShrink: 0 }} />
      <Select
        className={UI_CLASSNAME + 'grid-size'}
        size="small"
        value={gridSizeMm}
        onChange={(value) => setGridSizeMm(value as GridSizeMm)}
        options={GRID_SIZE_OPTIONS}
        popupMatchSelectWidth={false}
        style={{ minWidth: 60, maxWidth: 100 }}
        dropdownStyle={{ minWidth: 100 }}
        variant="borderless"
        labelRender={({ label }) => (
          <Text strong style={{ ...style.textStyle, margin: 0, fontSize: 12, whiteSpace: 'nowrap' }}>
            {label}
          </Text>
        )}
      />
    </div>
  );
};

type CtlBarProps = {
  size: Size;
  pageCursor: number;
  pageNum: number;
  setPageCursor: (page: number) => void;
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  /** Current grid spacing in mm (0 = no grid). Only shown in Designer mode. */
  gridSizeMm?: GridSizeMm;
  /** Callback when grid size changes. Only shown in Designer mode. */
  setGridSizeMm?: (size: GridSizeMm) => void;
  addPageAfter?: () => void;
  removePage?: () => void;
  /** Current page width in mm (only for blank PDF templates) */
  currentPageWidth?: number;
  /** Current page height in mm (only for blank PDF templates) */
  currentPageHeight?: number;
  /** Callback when page size changes (only for blank PDF templates) */
  onPageSizeChange?: (width: number, height: number) => void;
};

const CtlBar = (props: CtlBarProps) => {
  const { token } = theme.useToken();
  const i18n = useContext(I18nContext);

  const {
    size,
    pageCursor,
    pageNum,
    setPageCursor,
    zoomLevel,
    setZoomLevel,
    gridSizeMm,
    setGridSizeMm,
    addPageAfter,
    removePage,
    currentPageWidth,
    currentPageHeight,
    onPageSizeChange,
  } = props;

  const contextMenuItems: MenuProps['items'] = [];
  if (addPageAfter) {
    contextMenuItems.push({
      key: '1',
      label: <div onClick={addPageAfter}>{i18n('addPageAfter')}</div>,
    });
  }
  if (removePage && pageNum > 1 && pageCursor !== 0) {
    contextMenuItems.push({
      key: '2',
      label: <div onClick={removePage}>{i18n('removePage')}</div>,
    });
  }

  const hasPageSize = onPageSizeChange && currentPageWidth && currentPageHeight;
  const hasGrid = gridSizeMm !== undefined && setGridSizeMm !== undefined;
  const barWidth = 300;
  const pageSizeWidth = hasPageSize ? 160 : 0;
  const orientationWidth = hasPageSize ? 36 : 0;
  const gridSelectorWidth = hasGrid ? 100 : 0;
  const contextMenuWidth = contextMenuItems.length > 0 ? 50 : 0;
  const width = (pageNum > 1 ? barWidth : barWidth / 2) + contextMenuWidth + pageSizeWidth + orientationWidth + gridSelectorWidth;

  const textStyle = {
    color: token.colorWhite,
    fontSize: token.fontSize,
    margin: token.marginXS,
  };

  return (
    <div style={{ position: 'absolute', top: 'auto', bottom: '6%', width: size.width }}>
      <div
        className={UI_CLASSNAME + 'control-bar'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-evenly',
          position: 'relative',
          zIndex: 1,
          left: `calc(50% - ${width / 2}px)`,
          width,
          height: 40,
          boxSizing: 'border-box',
          padding: token.paddingSM,
          borderRadius: token.borderRadius,
          backgroundColor: token.colorBgMask,
        }}
      >
        {hasPageSize && (
          <PageSizeSelector
            currentWidth={currentPageWidth}
            currentHeight={currentPageHeight}
            onPageSizeChange={onPageSizeChange}
            style={{ textStyle }}
          />
        )}
        {hasPageSize && (
          <OrientationToggle
            currentWidth={currentPageWidth}
            currentHeight={currentPageHeight}
            onPageSizeChange={onPageSizeChange}
            style={{ textStyle }}
          />
        )}
        {hasGrid && (
          <GridSizeSelector
            gridSizeMm={gridSizeMm}
            setGridSizeMm={setGridSizeMm}
            style={{ textStyle }}
          />
        )}
        {pageNum > 1 && (
          <div className={UI_CLASSNAME + 'pager'}>
            <Pager
              style={{ textStyle }}
              pageCursor={pageCursor}
              pageNum={pageNum}
              setPageCursor={setPageCursor}
            />
          </div>
        )}
        <div className={UI_CLASSNAME + 'zoom'}>
          <Zoom style={{ textStyle }} zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} />
        </div>
        {contextMenuItems.length > 0 && (
          <ContextMenu items={contextMenuItems} style={{ textStyle }} />
        )}
      </div>
    </div>
  );
};

export default CtlBar;
