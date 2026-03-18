/**
 * @pdfme-erp/schemas
 *
 * ERP-specific schema plugins for the pdfme document engine.
 * Extends the base pdfme schemas with business document types.
 */

// Schema plugins (to be implemented)
export { lineItemsTable } from './line-items-table';
export { groupedTable } from './grouped-table';
export { erpImage } from './erp-image';
export { signatureBlock } from './signature-block';
export { drawnSignature } from './drawn-signature';
export { qrBarcode } from './qr-barcode';
export { watermark } from './watermark';
export { calculatedField } from './calculated-field';
export { richText } from './rich-text';

// Expression engine
export { ExpressionEngine } from './expression-engine';

// Types
export type {
  ColumnDefinition,
  RowTemplate,
  RowCondition,
  CellDefinition,
  RowStyle,
  FieldGroup,
  FieldDefinition,
  LocaleConfig,
  ElementCondition,
} from './types';
