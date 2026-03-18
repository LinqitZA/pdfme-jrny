/**
 * Type definitions for ERP schema plugins
 */

// Line Items Table types
export interface ColumnDefinition {
  key: string;
  header: string;
  width: number; // mm
  align?: 'left' | 'center' | 'right';
  format?: string;
  colSpan?: number;
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

// Text overflow strategy
export type TextOverflowStrategy = 'clip' | 'truncate' | 'shrinkToFit';

// Max rows per page config
export type MaxRowsPerPage = number | {
  first: number;
  middle: number;
  last: number;
};
