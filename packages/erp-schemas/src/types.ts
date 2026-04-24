/**
 * Type definitions for ERP schema plugins
 */

// Column font style for per-column font overrides
export interface ColumnFontStyle {
  fontName?: string;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
}

// Line Items Table types
export interface ColumnDefinition {
  key: string;
  header: string;
  width: number; // mm
  align?: 'left' | 'center' | 'right';
  format?: string;
  colSpan?: number;
  /** Column type: 'field' (default) binds to data, 'calculated' evaluates an expression, 'static' shows fixed text */
  columnType?: 'field' | 'calculated' | 'static';
  /** Expression string for calculated columns (e.g., 'qty * unitPrice'). Evaluated per-row using ExpressionEngine. */
  expression?: string;
  /** Per-column body cell font style overrides (inherits from global bodyStyle if not set) */
  columnStyle?: ColumnFontStyle;
  /** Per-column header cell font style overrides (inherits from global headerStyle if not set) */
  headerColumnStyle?: ColumnFontStyle;
  /** Text overflow behaviour: 'wrap' (default, multi-line), 'truncate' (single-line with ellipsis), 'clip' (single-line, clipped) */
  overflow?: 'wrap' | 'truncate' | 'clip';
  /** Vertical alignment for body cells in this column */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Horizontal alignment override for header cells (inherits from align if not set) */
  headerAlign?: 'left' | 'center' | 'right';
  /** Vertical alignment override for header cells */
  headerVerticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface RowTemplate {
  id: string;
  cells: CellDefinition[];
  condition?: RowCondition;
  style?: RowStyle;
}

export interface RowCondition {
  type: 'fieldNonEmpty' | 'expression';
  field?: string;
  expression?: string;
}

export interface CellDefinition {
  columnKey: string;
  content: string; // May contain {{field.key}} bindings
  colSpan?: number;
}

export interface RowStyle {
  backgroundColor?: string;
  fontWeight?: 'normal' | 'bold';
  fontSize?: number;
  borderBottom?: string;
}

// Field Schema types
export interface FieldGroup {
  key: string;
  label: string;
  fields: FieldDefinition[];
  children?: FieldGroup[];
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'image' | 'currency' | 'array';
  exampleValue?: unknown;
  description?: string;
}

// Locale types
export interface LocaleConfig {
  locale: string; // BCP-47
  currency: {
    code: string;
    symbol: string;
    position: 'before' | 'after';
    thousandSeparator: string;
    decimalSeparator: string;
    decimalPlaces: number;
  };
  date: {
    shortFormat: string;
    longFormat: string;
  };
  number: {
    thousandSeparator: string;
    decimalSeparator: string;
  };
}

// Condition types
export interface ElementCondition {
  type: 'fieldNonEmpty' | 'expression';
  field?: string;
  expression?: string;
}

// Page scope
export type PageScope = 'all' | 'first' | 'last' | 'notFirst';

// Output channel
export type OutputChannel = 'both' | 'email' | 'print';

// Serial/Lot tracking detail types
export interface SerialDetail {
  serialNo: string;
  status?: string;
  [key: string]: unknown;
}

export interface LotDetail {
  lotNo: string;
  qty: number;
  expiryDate?: string;
  [key: string]: unknown;
}

export interface TrackingDetailStyle {
  /** Font size for detail sub-rows (typically smaller than body) */
  fontSize?: number;
  /** Background color for detail sub-rows */
  backgroundColor?: string;
  /** Left indent in characters for detail text */
  indent?: number;
  /** Font color for detail sub-rows */
  fontColor?: string;
}

// Text overflow strategy
export type TextOverflowStrategy = 'clip' | 'truncate' | 'shrinkToFit';

// Max rows per page config
export type MaxRowsPerPage = number | {
  first: number;
  middle: number;
  last: number;
};
