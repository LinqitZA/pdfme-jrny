"use strict";
/**
 * Watermark schema plugin
 *
 * Diagonal text overlay (DRAFT/COPY/VOID), configurable text/colour/opacity/rotation/font size,
 * controlled by template variable.
 *
 * The watermark is applied as a post-processing step on the generated PDF using pdf-lib.
 * It draws rotated text at the center of each page with the specified styling.
 *
 * Schema properties:
 * - type: 'watermark'
 * - text: string (e.g., 'DRAFT', 'COPY', 'VOID', 'CONFIDENTIAL')
 * - opacity: number (0.0 - 1.0, default: 0.3)
 * - rotation: number (degrees, default: 45)
 * - color: { r: number, g: number, b: number } (0-1 range, default: { r: 0.5, g: 0.5, b: 0.5 })
 * - fontSize: number (default: 72)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.watermark = exports.WATERMARK_DEFAULTS = void 0;
exports.parseHexColor = parseHexColor;
exports.applyWatermark = applyWatermark;
exports.extractWatermarkFromTemplate = extractWatermarkFromTemplate;
/** Default watermark configuration */
exports.WATERMARK_DEFAULTS = {
    text: 'DRAFT',
    opacity: 0.3,
    rotation: 45,
    color: { r: 0.5, g: 0.5, b: 0.5 },
    fontSize: 72,
};
/**
 * Parse a hex color string (#RRGGBB or RRGGBB) to { r, g, b } in 0-1 range
 */
function parseHexColor(hex) {
    const clean = hex.replace(/^#/, '');
    if (clean.length !== 6)
        return exports.WATERMARK_DEFAULTS.color;
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    if (isNaN(r) || isNaN(g) || isNaN(b))
        return exports.WATERMARK_DEFAULTS.color;
    return { r, g, b };
}
/**
 * Apply a watermark overlay to a PDF buffer.
 * Draws diagonal text on every page of the PDF.
 *
 * @param pdfBytes - The source PDF as a Uint8Array or Buffer
 * @param config - Watermark configuration
 * @returns Modified PDF as Uint8Array
 */
async function applyWatermark(pdfBytes, config) {
    const { PDFDocument, rgb, degrees, StandardFonts } = await Promise.resolve().then(() => __importStar(require('pdf-lib')));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const text = config.text || exports.WATERMARK_DEFAULTS.text;
    const opacity = config.opacity ?? exports.WATERMARK_DEFAULTS.opacity;
    const rotation = config.rotation ?? exports.WATERMARK_DEFAULTS.rotation;
    const color = config.color ?? exports.WATERMARK_DEFAULTS.color;
    const fontSize = config.fontSize ?? exports.WATERMARK_DEFAULTS.fontSize;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);
    const pages = pdfDoc.getPages();
    for (const page of pages) {
        const { width, height } = page.getSize();
        // Center the watermark on the page
        const centerX = width / 2;
        const centerY = height / 2;
        page.drawText(text, {
            x: centerX - textWidth / 2,
            y: centerY - textHeight / 2,
            size: fontSize,
            font,
            color: rgb(color.r, color.g, color.b),
            opacity,
            rotate: degrees(rotation),
        });
    }
    return pdfDoc.save();
}
/**
 * Extract watermark configuration from template schema elements.
 * Scans all pages for watermark-type elements and returns the first found config.
 * Also supports watermark config from inputs.
 */
function extractWatermarkFromTemplate(schemas, inputs) {
    if (!Array.isArray(schemas))
        return null;
    for (const page of schemas) {
        if (!Array.isArray(page))
            continue;
        for (const field of page) {
            if (field &&
                typeof field === 'object' &&
                'type' in field &&
                field.type === 'watermark') {
                const wmField = field;
                const name = wmField.name;
                // Check if watermark text is overridden via inputs (variable binding)
                let text = wmField.text || exports.WATERMARK_DEFAULTS.text;
                if (name && inputs.length > 0 && name in inputs[0]) {
                    const inputValue = inputs[0][name];
                    // Empty string means "hide watermark" - return null
                    if (inputValue === '' || inputValue === null || inputValue === undefined) {
                        return null;
                    }
                    text = inputValue;
                }
                // Parse color - support hex strings from inputs
                let color = wmField.color || exports.WATERMARK_DEFAULTS.color;
                if (name && inputs.length > 0 && inputs[0][`${name}_color`]) {
                    color = parseHexColor(inputs[0][`${name}_color`]);
                }
                // Parse fontSize from inputs
                let fontSize = wmField.fontSize || exports.WATERMARK_DEFAULTS.fontSize;
                if (name && inputs.length > 0 && inputs[0][`${name}_fontSize`]) {
                    const parsed = parseInt(inputs[0][`${name}_fontSize`], 10);
                    if (!isNaN(parsed) && parsed > 0)
                        fontSize = parsed;
                }
                return {
                    text,
                    opacity: wmField.opacity ?? exports.WATERMARK_DEFAULTS.opacity,
                    rotation: wmField.rotation ?? exports.WATERMARK_DEFAULTS.rotation,
                    color,
                    fontSize,
                };
            }
        }
    }
    return null;
}
/**
 * The watermark plugin definition.
 * The actual PDF rendering is handled as a post-processing step by the render service,
 * which applies the watermark overlay after pdfme generates the base PDF.
 */
exports.watermark = {
    type: 'watermark',
    defaultSchema: {
        type: 'watermark',
        text: 'DRAFT',
        opacity: 0.3,
        rotation: 45,
        color: { r: 0.5, g: 0.5, b: 0.5 },
        fontSize: 72,
        position: { x: 0, y: 0 },
        width: 210,
        height: 297,
    },
    applyWatermark,
    extractWatermarkFromTemplate,
    parseHexColor,
    WATERMARK_DEFAULTS: exports.WATERMARK_DEFAULTS,
};
//# sourceMappingURL=index.js.map