import type { ALIGNMENT, VERTICAL_ALIGNMENT } from '../text/types.js';
import type { Schema } from '@pdfme/common';

export type Spacing = { top: number; right: number; bottom: number; left: number };
type BorderInsets = Spacing;
type BoxDimensions = Spacing;

export interface CellStyle {
  fontName?: string;
  alignment: ALIGNMENT;
  verticalAlignment: VERTICAL_ALIGNMENT;
  fontSize: number;
  lineHeight: number;
  characterSpacing: number;
  fontColor: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: BoxDimensions;
  padding: BoxDimensions;
  /** Text overflow behaviour per cell/column: 'wrap' (default), 'truncate', or 'clip' */
  overflow?: 'wrap' | 'truncate' | 'clip';
}

export type CellSchema = Schema & CellStyle;

export interface TableSchema extends Schema {
  showHead: boolean;
  head: string[];
  headWidthPercentages: number[];
  repeatHead?: boolean;

  tableStyles: {
    borderColor: string;
    borderWidth: number;
  };
  headStyles: CellStyle;
  bodyStyles: CellStyle & { alternateBackgroundColor: string };
  columnStyles: {
    alignment?: { [colIndex: number]: ALIGNMENT };
  };
  /** Per-column body cell style overrides (fontName, fontSize, textColor) keyed by column index */
  bodyColumnStyles?: { [colIndex: number]: Partial<CellStyle> };
  /** Per-column header cell style overrides (fontName, fontSize, textColor) keyed by column index */
  headColumnStyles?: { [colIndex: number]: Partial<CellStyle> };
}

export interface Styles {
  fontName: string | undefined;
  backgroundColor: string;
  textColor: string;
  lineHeight: number;
  characterSpacing: number;
  alignment: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment: 'top' | 'middle' | 'bottom';
  fontSize: number;
  cellPadding: Spacing;
  lineColor: string;
  lineWidth: BorderInsets;
  cellWidth: number;
  minCellHeight: number;
  minCellWidth: number;
  /** Text overflow behaviour: 'wrap' (default), 'truncate', or 'clip' */
  overflow?: 'wrap' | 'truncate' | 'clip';
}

export interface TableInput {
  settings: Settings;
  styles: StylesProps;
  content: ContentInput;
}

interface ContentInput {
  body: string[][];
  head: string[][];
  columns: number[];
}

export interface Settings {
  startY: number;
  margin: Spacing;
  tableWidth: number;
  showHead: boolean;
  tableLineWidth: number;
  tableLineColor: string;
}

export interface StylesProps {
  styles: Partial<Styles>;
  headStyles: Partial<Styles>;
  bodyStyles: Partial<Styles>;
  alternateRowStyles: Partial<Styles>;
  columnStyles: { [key: string]: Partial<Styles> };
  /** Per-column body cell style overrides keyed by column index */
  bodyColumnStyles?: { [key: string]: Partial<Styles> };
  /** Per-column header cell style overrides keyed by column index */
  headColumnStyles?: { [key: string]: Partial<Styles> };
}

export type Section = 'head' | 'body';
