"use strict";
/**
 * ERP Image schema plugin
 *
 * Storage-resolved assets (logos, stamps) via FileStorageService.
 * At render time, resolves the image from file storage, converts to base64
 * data URI, and maps to pdfme's standard image plugin.
 *
 * Schema properties:
 * - type: 'erpImage'
 * - name: string (field name)
 * - assetPath: string (storage path, e.g., "test-org/assets/uuid_logo.png")
 * - assetId: string (asset UUID - alternative to assetPath)
 * - position: { x: number, y: number } (mm)
 * - width: number (mm)
 * - height: number (mm)
 * - objectFit: 'contain' | 'cover' | 'fill' (default: 'contain')
 * - opacity: number (0-1, default: 1)
 *
 * Input resolution order:
 * 1. Input value for the field name (if provided as base64 or storage path)
 * 2. Schema's assetPath property
 * 3. Schema's assetId property (looked up from org's asset list)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.erpImage = exports.PLACEHOLDER_IMAGE_MARKER = void 0;
exports.imageBufferToDataUri = imageBufferToDataUri;
exports.generatePlaceholderImage = generatePlaceholderImage;
exports.generateMarkedPlaceholderImage = generateMarkedPlaceholderImage;
exports.resolveAssetPath = resolveAssetPath;
exports.extractErpImages = extractErpImages;
exports.resolveErpImages = resolveErpImages;
/**
 * Detect MIME type from file extension or magic bytes.
 */
function detectMimeType(storagePath, buffer) {
    const ext = storagePath.split('.').pop()?.toLowerCase() || '';
    const mimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        gif: 'image/gif',
    };
    if (mimeMap[ext])
        return mimeMap[ext];
    if (buffer && buffer.length >= 4) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
            return 'image/png';
        if (buffer[0] === 0xff && buffer[1] === 0xd8)
            return 'image/jpeg';
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46)
            return 'image/gif';
        if (buffer.toString('utf8', 0, 5) === '<?xml' || buffer.toString('utf8', 0, 4) === '<svg')
            return 'image/svg+xml';
    }
    return 'image/png';
}
/**
 * Convert an image buffer to a base64 data URI.
 */
function imageBufferToDataUri(buffer, storagePath) {
    const mime = detectMimeType(storagePath, buffer);
    return `data:${mime};base64,${buffer.toString('base64')}`;
}
/**
 * Generate a placeholder PNG image for missing/unresolvable images.
 * Creates a minimal valid PNG with a light grey background.
 * pdfme will scale it to the element dimensions.
 * The actual "Image not found" text overlay is applied via pdf-lib post-processing
 * (see resolveMissingImages in render.service.ts).
 */
function generatePlaceholderImage(_width, _height) {
    // Minimal valid 1x1 PNG with a light grey (#f0f0f0) pixel
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8BQDwAEgAF/pooBPQAAAABJRU5ErkJggg==';
    return `data:image/png;base64,${pngBase64}`;
}
/** Sentinel value prefix to identify placeholder images in the pipeline */
exports.PLACEHOLDER_IMAGE_MARKER = 'PLACEHOLDER_IMG:';
/**
 * Generate a placeholder data URI and mark it as a placeholder for post-processing.
 * The marker allows the render pipeline to identify placeholders and draw
 * "Image not found" text on top via pdf-lib.
 */
function generateMarkedPlaceholderImage(width, height) {
    return {
        dataUri: generatePlaceholderImage(width, height),
        isPlaceholder: true,
        width,
        height,
    };
}
/**
 * Resolve an erpImage element's asset path to a storage path.
 * Returns the storage path to fetch from FileStorageService.
 */
function resolveAssetPath(element, inputValue, orgId) {
    if (inputValue) {
        if (inputValue.startsWith('data:'))
            return null;
        return inputValue;
    }
    if (element.assetPath)
        return element.assetPath;
    if (element.assetId) {
        return `${orgId}/assets/${element.assetId}`;
    }
    return null;
}
/**
 * Extract erpImage elements from template schemas.
 * Returns element info for async resolution.
 */
function extractErpImages(schemas) {
    const results = [];
    if (!Array.isArray(schemas))
        return results;
    for (let pi = 0; pi < schemas.length; pi++) {
        const page = schemas[pi];
        if (!Array.isArray(page))
            continue;
        for (let ei = 0; ei < page.length; ei++) {
            const field = page[ei];
            if (field &&
                typeof field === 'object' &&
                'type' in field &&
                field.type === 'erpImage') {
                results.push({
                    pageIndex: pi,
                    elementIndex: ei,
                    element: field,
                    fieldName: field.name || `erpImage_${pi}_${ei}`,
                });
            }
        }
    }
    return results;
}
async function resolveErpImages(template, inputs, context) {
    const erpImages = extractErpImages(template.schemas);
    if (erpImages.length === 0)
        return { template, inputs, placeholders: [] };
    const inputRecord = inputs.length > 0 ? inputs[0] : {};
    const newSchemas = template.schemas.map((page) => {
        if (!Array.isArray(page))
            return page;
        return [...page];
    });
    const newInputs = inputs.map((inp) => ({ ...inp }));
    const placeholders = [];
    for (const { pageIndex, elementIndex, element, fieldName } of erpImages) {
        const page = newSchemas[pageIndex];
        const inputValue = inputRecord[fieldName];
        let dataUri = '';
        if (inputValue && inputValue.startsWith('data:')) {
            dataUri = inputValue;
        }
        else {
            const storagePath = resolveAssetPath(element, inputValue, context.orgId);
            if (storagePath) {
                try {
                    const exists = await context.fileExists(storagePath);
                    if (exists) {
                        const buffer = await context.readFile(storagePath);
                        if (buffer && buffer.length > 0) {
                            dataUri = imageBufferToDataUri(buffer, storagePath);
                        }
                    }
                    else {
                        const files = await context.listFiles(`${context.orgId}/assets`);
                        const match = files.find((f) => f.includes(element.assetId || '') && element.assetId);
                        if (match) {
                            const buffer = await context.readFile(match);
                            if (buffer && buffer.length > 0) {
                                dataUri = imageBufferToDataUri(buffer, match);
                            }
                        }
                    }
                }
                catch (err) {
                    console.error(`Failed to resolve erpImage asset: ${storagePath}`, err);
                }
            }
        }
        // If no image could be resolved, generate a placeholder rectangle with "Image not found"
        if (!dataUri) {
            dataUri = generatePlaceholderImage(element.width, element.height);
            placeholders.push({
                pageIndex,
                x: element.position.x,
                y: element.position.y,
                width: element.width,
                height: element.height,
                fieldName,
            });
        }
        page[elementIndex] = {
            name: fieldName,
            type: 'image',
            position: element.position,
            width: element.width,
            height: element.height,
            ...(element.readOnly !== undefined ? { readOnly: element.readOnly } : {}),
        };
        if (newInputs.length > 0) {
            newInputs[0][fieldName] = dataUri;
        }
        else {
            newInputs.push({ [fieldName]: dataUri });
        }
    }
    return {
        template: { basePdf: template.basePdf, schemas: newSchemas },
        inputs: newInputs,
        placeholders,
    };
}
/**
 * The erpImage plugin definition.
 */
exports.erpImage = {
    type: 'erpImage',
    defaultSchema: {
        type: 'erpImage',
        assetPath: '',
        assetId: '',
        position: { x: 10, y: 10 },
        width: 50,
        height: 50,
        objectFit: 'contain',
        opacity: 1,
    },
    extractErpImages,
    resolveErpImages,
    resolveAssetPath,
    imageBufferToDataUri,
    detectMimeType,
};
//# sourceMappingURL=index.js.map