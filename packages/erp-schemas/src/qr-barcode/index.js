"use strict";
/**
 * QR/Barcode schema plugin
 *
 * QR code with ERP URL binding. At design time, the element stores a URL pattern
 * with {{field.key}} bindings (e.g., "https://erp.example.com/invoices/{{document.id}}").
 * At render time, bindings are resolved against input data, and the element is converted
 * to a standard pdfme qrcode barcode type.
 *
 * Schema properties:
 * - type: 'qrBarcode'
 * - name: string
 * - urlPattern: string (may contain {{field.key}} bindings)
 * - position: { x: number, y: number }
 * - width: number
 * - height: number
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.qrBarcode = void 0;
exports.resolveUrlBindings = resolveUrlBindings;
exports.resolveQrBarcodes = resolveQrBarcodes;
/**
 * Resolve {{field.key}} bindings in a URL pattern string.
 * Supports dot-notation: {{document.id}} resolves context.document.id
 */
function resolveUrlBindings(urlPattern, context) {
    return urlPattern.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
        const trimmedPath = path.trim();
        const value = resolveNestedValue(context, trimmedPath);
        return value !== undefined && value !== null ? String(value) : '';
    });
}
/**
 * Resolve a dot-notation path against a context object.
 * e.g., "document.id" resolves obj.document.id
 */
function resolveNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
/**
 * Resolve QR barcode elements in a pdfme template.
 * Converts qrBarcode type to standard pdfme qrcode type, resolving URL bindings.
 *
 * @param template - pdfme template with schemas
 * @param inputs - input data records
 * @returns Updated template and inputs with qrBarcode resolved to qrcode
 */
function resolveQrBarcodes(template, inputs) {
    const qrFieldMap = new Map(); // fieldName -> urlPattern
    // Scan schemas for qrBarcode elements
    const newSchemas = template.schemas.map((page) => {
        if (!Array.isArray(page))
            return page;
        return page.map((field) => {
            if (!field || typeof field !== 'object')
                return field;
            const f = field;
            if (f.type !== 'qrBarcode')
                return field;
            const name = f.name;
            const urlPattern = f.urlPattern || '';
            qrFieldMap.set(name, urlPattern);
            // Convert to standard pdfme qrcode type
            const { urlPattern: _removed, ...rest } = f;
            return { ...rest, type: 'qrcode' };
        });
    });
    // Resolve URL bindings in inputs
    const newInputs = inputs.map((input) => {
        const resolved = { ...input };
        for (const [fieldName, urlPattern] of qrFieldMap) {
            // If input already has a value for this field, use it as-is (may be pre-resolved)
            // Otherwise, resolve the urlPattern from the schema
            if (!resolved[fieldName] || resolved[fieldName] === '') {
                // Build a context from the full input record for binding resolution
                const context = buildContext(resolved);
                resolved[fieldName] = resolveUrlBindings(urlPattern, context);
            }
            else {
                // Even if there's a value, check if it contains {{bindings}}
                if (resolved[fieldName].includes('{{')) {
                    const context = buildContext(resolved);
                    resolved[fieldName] = resolveUrlBindings(resolved[fieldName], context);
                }
            }
        }
        return resolved;
    });
    return {
        template: { basePdf: template.basePdf, schemas: newSchemas },
        inputs: newInputs,
    };
}
/**
 * Build a nested context object from flat input keys.
 * e.g., { "document.id": "INV-001" } -> { document: { id: "INV-001" } }
 * Also keeps flat keys for direct access.
 */
function buildContext(input) {
    const context = { ...input };
    for (const [key, value] of Object.entries(input)) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let current = context;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
        }
    }
    return context;
}
/** Plugin export (placeholder for designer UI integration) */
exports.qrBarcode = {
    type: 'qrBarcode',
    resolve: resolveQrBarcodes,
};
//# sourceMappingURL=index.js.map