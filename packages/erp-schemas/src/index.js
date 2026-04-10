"use strict";
/**
 * @pdfme-erp/schemas
 *
 * ERP-specific schema plugins for the pdfme document engine.
 * Extends the base pdfme schemas with business document types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpressionEngine = exports.SHADOW_DEFAULTS = exports.RECTANGLE_DEFAULTS = exports.toUpstreamRectangleSchema = exports.parseHexColorWithAlpha = exports.applyRectangleShadows = exports.resolveRectangles = exports.rectangle = exports.applyRichText = exports.resolveRichText = exports.richText = exports.resolveCurrencyFields = exports.currencyField = exports.resolveCalculatedFields = exports.calculatedField = exports.parseHexColor = exports.WATERMARK_DEFAULTS = exports.extractWatermarkFromTemplate = exports.applyWatermark = exports.watermark = exports.resolveQrBarcodes = exports.qrBarcode = exports.drawnSignature = exports.applySignatureBlocks = exports.resolveSignatureBlocks = exports.signatureBlock = exports.generatePlaceholderImage = exports.resolveErpImages = exports.erpImage = exports.GroupedTable = exports.groupedTable = exports.resolveLineItemsTables = exports.lineItemsTable = void 0;
// Schema plugins
var line_items_table_1 = require("./line-items-table");
Object.defineProperty(exports, "lineItemsTable", { enumerable: true, get: function () { return line_items_table_1.lineItemsTable; } });
Object.defineProperty(exports, "resolveLineItemsTables", { enumerable: true, get: function () { return line_items_table_1.resolveLineItemsTables; } });
var grouped_table_1 = require("./grouped-table");
Object.defineProperty(exports, "groupedTable", { enumerable: true, get: function () { return grouped_table_1.groupedTable; } });
Object.defineProperty(exports, "GroupedTable", { enumerable: true, get: function () { return grouped_table_1.GroupedTable; } });
var erp_image_1 = require("./erp-image");
Object.defineProperty(exports, "erpImage", { enumerable: true, get: function () { return erp_image_1.erpImage; } });
Object.defineProperty(exports, "resolveErpImages", { enumerable: true, get: function () { return erp_image_1.resolveErpImages; } });
Object.defineProperty(exports, "generatePlaceholderImage", { enumerable: true, get: function () { return erp_image_1.generatePlaceholderImage; } });
var signature_block_1 = require("./signature-block");
Object.defineProperty(exports, "signatureBlock", { enumerable: true, get: function () { return signature_block_1.signatureBlock; } });
Object.defineProperty(exports, "resolveSignatureBlocks", { enumerable: true, get: function () { return signature_block_1.resolveSignatureBlocks; } });
Object.defineProperty(exports, "applySignatureBlocks", { enumerable: true, get: function () { return signature_block_1.applySignatureBlocks; } });
var drawn_signature_1 = require("./drawn-signature");
Object.defineProperty(exports, "drawnSignature", { enumerable: true, get: function () { return drawn_signature_1.drawnSignature; } });
var qr_barcode_1 = require("./qr-barcode");
Object.defineProperty(exports, "qrBarcode", { enumerable: true, get: function () { return qr_barcode_1.qrBarcode; } });
Object.defineProperty(exports, "resolveQrBarcodes", { enumerable: true, get: function () { return qr_barcode_1.resolveQrBarcodes; } });
var watermark_1 = require("./watermark");
Object.defineProperty(exports, "watermark", { enumerable: true, get: function () { return watermark_1.watermark; } });
Object.defineProperty(exports, "applyWatermark", { enumerable: true, get: function () { return watermark_1.applyWatermark; } });
Object.defineProperty(exports, "extractWatermarkFromTemplate", { enumerable: true, get: function () { return watermark_1.extractWatermarkFromTemplate; } });
Object.defineProperty(exports, "WATERMARK_DEFAULTS", { enumerable: true, get: function () { return watermark_1.WATERMARK_DEFAULTS; } });
Object.defineProperty(exports, "parseHexColor", { enumerable: true, get: function () { return watermark_1.parseHexColor; } });
var calculated_field_1 = require("./calculated-field");
Object.defineProperty(exports, "calculatedField", { enumerable: true, get: function () { return calculated_field_1.calculatedField; } });
Object.defineProperty(exports, "resolveCalculatedFields", { enumerable: true, get: function () { return calculated_field_1.resolveCalculatedFields; } });
var currency_field_1 = require("./currency-field");
Object.defineProperty(exports, "currencyField", { enumerable: true, get: function () { return currency_field_1.currencyField; } });
Object.defineProperty(exports, "resolveCurrencyFields", { enumerable: true, get: function () { return currency_field_1.resolveCurrencyFields; } });
var rich_text_1 = require("./rich-text");
Object.defineProperty(exports, "richText", { enumerable: true, get: function () { return rich_text_1.richText; } });
Object.defineProperty(exports, "resolveRichText", { enumerable: true, get: function () { return rich_text_1.resolveRichText; } });
Object.defineProperty(exports, "applyRichText", { enumerable: true, get: function () { return rich_text_1.applyRichText; } });
var rectangle_1 = require("./rectangle");
Object.defineProperty(exports, "rectangle", { enumerable: true, get: function () { return rectangle_1.rectangle; } });
Object.defineProperty(exports, "resolveRectangles", { enumerable: true, get: function () { return rectangle_1.resolveRectangles; } });
Object.defineProperty(exports, "applyRectangleShadows", { enumerable: true, get: function () { return rectangle_1.applyRectangleShadows; } });
Object.defineProperty(exports, "parseHexColorWithAlpha", { enumerable: true, get: function () { return rectangle_1.parseHexColorWithAlpha; } });
Object.defineProperty(exports, "toUpstreamRectangleSchema", { enumerable: true, get: function () { return rectangle_1.toUpstreamRectangleSchema; } });
Object.defineProperty(exports, "RECTANGLE_DEFAULTS", { enumerable: true, get: function () { return rectangle_1.RECTANGLE_DEFAULTS; } });
Object.defineProperty(exports, "SHADOW_DEFAULTS", { enumerable: true, get: function () { return rectangle_1.SHADOW_DEFAULTS; } });
// Expression engine
var expression_engine_1 = require("./expression-engine");
Object.defineProperty(exports, "ExpressionEngine", { enumerable: true, get: function () { return expression_engine_1.ExpressionEngine; } });
//# sourceMappingURL=index.js.map