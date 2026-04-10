"use strict";
/**
 * Signature Block schema plugin
 *
 * Renders a horizontal signature line with a configurable label below it,
 * and an optional sub-label resolved from field bindings.
 *
 * Visual layout (top to bottom):
 * - Empty signing area
 * - Horizontal signature line
 * - Label text (e.g., "Authorized Signature")
 * - Sub-label text (e.g., resolved from {{signer.name}})
 *
 * Schema properties:
 * - type: 'signatureBlock'
 * - name: string (field name)
 * - label: string (text below the line, e.g., "Authorized Signature")
 * - subLabel: string (optional, may contain {{field}} bindings)
 * - position: { x: number, y: number } (mm)
 * - width: number (mm)
 * - height: number (mm)
 * - lineColor: string (hex color for signature line, default: '#000000')
 * - lineThickness: number (pt, default: 0.5)
 * - labelFontSize: number (pt, default: 9)
 * - subLabelFontSize: number (pt, default: 8)
 * - labelColor: string (hex color, default: '#333333')
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
exports.signatureBlock = void 0;
exports.extractSignatureBlocks = extractSignatureBlocks;
exports.resolveSignatureBlocks = resolveSignatureBlocks;
exports.applySignatureBlocks = applySignatureBlocks;
const DEFAULTS = {
    lineColor: '#000000',
    lineThickness: 0.5,
    labelFontSize: 9,
    subLabelFontSize: 8,
    labelColor: '#333333',
};
/**
 * Parse hex color to RGB 0-1 range.
 */
function parseHex(hex) {
    const clean = (hex || '').replace(/^#/, '');
    if (clean.length !== 6)
        return { r: 0, g: 0, b: 0 };
    return {
        r: parseInt(clean.slice(0, 2), 16) / 255,
        g: parseInt(clean.slice(2, 4), 16) / 255,
        b: parseInt(clean.slice(4, 6), 16) / 255,
    };
}
/**
 * Resolve {{field.key}} bindings in a string.
 */
function resolveBindings(text, context) {
    if (!text || !context)
        return text || '';
    return text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
        const trimmed = key.trim();
        if (context[trimmed] !== undefined)
            return context[trimmed];
        const parts = trimmed.split('.');
        let value = context;
        for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
                value = value[part];
            }
            else {
                return '';
            }
        }
        return String(value ?? '');
    });
}
/**
 * Extract signatureBlock elements from template schemas and prepare render info.
 * Returns the extracted render info and modifies schemas to remove signatureBlock elements.
 */
function extractSignatureBlocks(schemas, inputs) {
    const signatureBlockInfo = [];
    const inputContext = inputs.length > 0 ? inputs[0] : {};
    const cleanedSchemas = schemas.map((page, pageIndex) => {
        if (!Array.isArray(page))
            return page;
        const cleanedPage = [];
        for (const field of page) {
            if (field &&
                typeof field === 'object' &&
                'type' in field &&
                field.type === 'signatureBlock') {
                const sb = field;
                const label = sb.label || 'Signature';
                let subLabel = sb.subLabel || '';
                if (sb.name && inputContext[sb.name]) {
                    subLabel = inputContext[sb.name];
                }
                subLabel = resolveBindings(subLabel, inputContext);
                const resolvedLabel = resolveBindings(label, inputContext);
                signatureBlockInfo.push({
                    name: sb.name || 'signatureBlock',
                    position: sb.position || { x: 10, y: 200 },
                    width: sb.width || 80,
                    height: sb.height || 30,
                    label: resolvedLabel,
                    subLabel,
                    lineColor: parseHex(sb.lineColor || DEFAULTS.lineColor),
                    lineThickness: sb.lineThickness ?? DEFAULTS.lineThickness,
                    labelFontSize: sb.labelFontSize ?? DEFAULTS.labelFontSize,
                    subLabelFontSize: sb.subLabelFontSize ?? DEFAULTS.subLabelFontSize,
                    labelColor: parseHex(sb.labelColor || DEFAULTS.labelColor),
                    pageIndex,
                });
            }
            else {
                cleanedPage.push(field);
            }
        }
        return cleanedPage;
    });
    return { signatureBlockInfo, cleanedSchemas };
}
/**
 * Process signatureBlock elements in the render pipeline.
 * Returns modified template (with signatureBlock elements removed)
 * and render info for pdf-lib post-processing.
 */
function resolveSignatureBlocks(template, inputs) {
    const { signatureBlockInfo, cleanedSchemas } = extractSignatureBlocks(template.schemas, inputs);
    const sbNames = new Set(signatureBlockInfo.map((s) => s.name));
    const cleanedInputs = inputs.map((inp) => {
        const clean = { ...inp };
        for (const name of sbNames) {
            delete clean[name];
        }
        return clean;
    });
    return {
        template: { basePdf: template.basePdf, schemas: cleanedSchemas },
        inputs: cleanedInputs,
        signatureBlockInfo,
    };
}
/**
 * Apply signature block rendering to a PDF buffer using pdf-lib.
 * Draws a horizontal line with label and sub-label text.
 */
async function applySignatureBlocks(pdfBytes, signatureBlockInfo) {
    if (signatureBlockInfo.length === 0) {
        return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    }
    const { PDFDocument, rgb, StandardFonts } = await Promise.resolve().then(() => __importStar(require('pdf-lib')));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const mmToPt = (mm) => mm * 2.835;
    for (const sb of signatureBlockInfo) {
        if (sb.pageIndex >= pages.length)
            continue;
        const page = pages[sb.pageIndex];
        const { height: pageHeight } = page.getSize();
        const boxX = mmToPt(sb.position.x);
        const boxWidth = mmToPt(sb.width);
        const boxHeight = mmToPt(sb.height);
        const lineY = pageHeight - mmToPt(sb.position.y) - boxHeight + mmToPt(8);
        page.drawLine({
            start: { x: boxX, y: lineY },
            end: { x: boxX + boxWidth, y: lineY },
            thickness: sb.lineThickness,
            color: rgb(sb.lineColor.r, sb.lineColor.g, sb.lineColor.b),
        });
        const labelY = lineY - sb.labelFontSize - 2;
        const labelWidth = font.widthOfTextAtSize(sb.label, sb.labelFontSize);
        const labelX = boxX + (boxWidth - labelWidth) / 2;
        page.drawText(sb.label, {
            x: labelX,
            y: labelY,
            size: sb.labelFontSize,
            font,
            color: rgb(sb.labelColor.r, sb.labelColor.g, sb.labelColor.b),
        });
        if (sb.subLabel) {
            const subLabelY = labelY - sb.subLabelFontSize - 2;
            const subLabelWidth = font.widthOfTextAtSize(sb.subLabel, sb.subLabelFontSize);
            const subLabelX = boxX + (boxWidth - subLabelWidth) / 2;
            page.drawText(sb.subLabel, {
                x: subLabelX,
                y: subLabelY,
                size: sb.subLabelFontSize,
                font,
                color: rgb(sb.labelColor.r, sb.labelColor.g, sb.labelColor.b),
            });
        }
    }
    return pdfDoc.save();
}
/**
 * The signatureBlock plugin definition.
 */
exports.signatureBlock = {
    type: 'signatureBlock',
    defaultSchema: {
        type: 'signatureBlock',
        label: 'Authorized Signature',
        subLabel: '',
        position: { x: 10, y: 240 },
        width: 80,
        height: 30,
        lineColor: '#000000',
        lineThickness: 0.5,
        labelFontSize: 9,
        subLabelFontSize: 8,
        labelColor: '#333333',
    },
    extractSignatureBlocks,
    resolveSignatureBlocks,
    applySignatureBlocks,
};
//# sourceMappingURL=index.js.map