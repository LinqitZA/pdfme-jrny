/**
 * @pdfme-erp/schemas
 *
 * ERP-specific schema plugins for the pdfme document engine.
 * Extends the base pdfme schemas with business document types.
 */

// Schema plugins
export { lineItemsTable, resolveLineItemsTables, resolveLineItemsTableInputs } from './line-items-table';
export { groupedTable, GroupedTable } from './grouped-table';
export type { GroupedTableConfig, GroupNode, RenderedRow } from './grouped-table';
export { erpImage, resolveErpImages, generatePlaceholderImage } from './erp-image';
export { signatureBlock, resolveSignatureBlocks, applySignatureBlocks } from './signature-block';
export type { SignatureBlockRenderInfo } from './signature-block';
export { drawnSignature } from './drawn-signature';
export { qrBarcode, resolveQrBarcodes } from './qr-barcode';
export { watermark, applyWatermark, extractWatermarkFromTemplate, WATERMARK_DEFAULTS, parseHexColor } from './watermark';
export type { WatermarkConfig } from './watermark';
export { calculatedField, resolveCalculatedFields } from './calculated-field';
export { currencyField, resolveCurrencyFields } from './currency-field';
export { richText, resolveRichText, applyRichText } from './rich-text';
export type { RichTextRenderInfo } from './rich-text';
export { rectangle, resolveRectangles, applyRectangleShadows, parseHexColorWithAlpha, toUpstreamRectangleSchema, RECTANGLE_DEFAULTS, SHADOW_DEFAULTS } from './rectangle';
export type { RectangleSchema, RectangleShadow } from './rectangle';
export { pageNumber, PAGE_NUMBER_DEFAULT_FORMAT } from './page-number';
export type { PageNumberSchema } from './page-number';

// Expression engine
export { ExpressionEngine } from './expression-engine';
export type { ExpressionEngineOptions, ExpressionErrorMode } from './expression-engine';

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
  SerialDetail,
  LotDetail,
  TrackingDetailStyle,
} from './types';
