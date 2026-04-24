export const DEFAULT_LANG = 'en';

export const DESTROYED_ERR_MSG = '[@pdfme/ui] this instance is already destroyed';

export const SELECTABLE_CLASSNAME = 'selectable';

export const RULER_HEIGHT = 30;

export const PAGE_GAP = 10;

export const LEFT_SIDEBAR_WIDTH = 45;

/** Width when ERP field groups are available */
export const LEFT_SIDEBAR_WIDTH_EXPANDED = 220;

export const RIGHT_SIDEBAR_WIDTH = 400;

export const BACKGROUND_COLOR = '#e2e8f0'; // slate-200 — blends with host app light UI

export const DEFAULT_MAX_ZOOM = 2;

export const DESIGNER_CLASSNAME = 'pdfme-designer-';

export const UI_CLASSNAME = 'pdfme-ui-';

/** Page size definition with name and dimensions in mm */
export interface PageSizeOption {
  name: string;
  width: number;
  height: number;
  group: 'standard' | 'labels' | 'custom';
}

/** Predefined page sizes for the Designer toolbar selector */
export const PAGE_SIZES: PageSizeOption[] = [
  // Standard paper sizes
  { name: 'A4', width: 210, height: 297, group: 'standard' },
  { name: 'Letter', width: 215.9, height: 279.4, group: 'standard' },
  { name: 'Legal', width: 215.9, height: 355.6, group: 'standard' },
  { name: 'A3', width: 297, height: 420, group: 'standard' },
  { name: 'A5', width: 148, height: 210, group: 'standard' },
  // Label sizes
  { name: 'Label 100×50', width: 100, height: 50, group: 'labels' },
  { name: 'Label 100×30', width: 100, height: 30, group: 'labels' },
  { name: 'Label 70×30', width: 70, height: 30, group: 'labels' },
  { name: 'Label 50×25', width: 50, height: 25, group: 'labels' },
];
