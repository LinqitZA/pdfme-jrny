"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const pdfLib = tslib_1.__importStar(require("@pdfme/pdf-lib"));
const common_1 = require("@pdfme/common");
const schemas_1 = require("@pdfme/schemas");
const helper_js_1 = require("./helper.js");
const generate = async (props) => {
    (0, common_1.checkGenerateProps)(props);
    const { inputs, template: _template, options = {}, plugins: userPlugins = {} } = props;
    const template = (0, common_1.cloneDeep)(_template);
    const basePdf = template.basePdf;
    if (inputs.length === 0) {
        throw new Error('[@pdfme/generator] inputs should not be empty, pass at least an empty object in the array');
    }
    (0, helper_js_1.validateRequiredFields)(template, inputs);
    const { pdfDoc, renderObj } = await (0, helper_js_1.preprocessing)({ template, userPlugins });
    const _cache = new Map();
    for (let i = 0; i < inputs.length; i += 1) {
        const input = inputs[i];
        // Get the dynamic template with proper typing
        const dynamicTemplate = await (0, common_1.getDynamicTemplate)({
            template,
            input,
            options,
            _cache,
            getDynamicHeights: (value, args) => {
                switch (args.schema.type) {
                    case 'table':
                        return (0, schemas_1.getDynamicHeightsForTable)(value, args);
                    default:
                        return Promise.resolve([args.schema.height]);
                }
            },
        });
        const { basePages, embedPdfBoxes } = await (0, helper_js_1.getEmbedPdfPages)({
            template: dynamicTemplate,
            pdfDoc,
        });
        // Add proper type assertion for dynamicTemplate.schemas
        const schemas = dynamicTemplate.schemas;
        // Create a type-safe array of schema names without using Set spread which requires downlevelIteration
        const schemaNameSet = new Set();
        schemas.forEach((page) => {
            page.forEach((schema) => {
                if (schema.name) {
                    schemaNameSet.add(schema.name);
                }
            });
        });
        const schemaNames = Array.from(schemaNameSet);
        for (let j = 0; j < basePages.length; j += 1) {
            const basePage = basePages[j];
            const embedPdfBox = embedPdfBoxes[j];
            const boundingBoxLeft = basePage instanceof pdfLib.PDFEmbeddedPage ? (0, common_1.pt2mm)(embedPdfBox.mediaBox.x) : 0;
            const boundingBoxBottom = basePage instanceof pdfLib.PDFEmbeddedPage ? (0, common_1.pt2mm)(embedPdfBox.mediaBox.y) : 0;
            const page = (0, helper_js_1.insertPage)({ basePage, embedPdfBox, pdfDoc });
            if ((0, common_1.isBlankPdf)(basePdf) && basePdf.staticSchema) {
                for (let k = 0; k < basePdf.staticSchema.length; k += 1) {
                    const staticSchema = basePdf.staticSchema[k];
                    const render = renderObj[staticSchema.type];
                    if (!render) {
                        continue;
                    }
                    const value = staticSchema.readOnly
                        ? (0, common_1.replacePlaceholders)({
                            content: staticSchema.content || '',
                            variables: { ...input, totalPages: basePages.length, currentPage: j + 1 },
                            schemas: schemas, // Use the properly typed schemas variable
                        })
                        : staticSchema.content || '';
                    staticSchema.position = {
                        x: staticSchema.position.x + boundingBoxLeft,
                        y: staticSchema.position.y - boundingBoxBottom,
                    };
                    // Create properly typed render props for static schema
                    const staticRenderProps = {
                        value,
                        schema: staticSchema,
                        basePdf,
                        pdfLib,
                        pdfDoc,
                        page,
                        options,
                        _cache,
                    };
                    await render(staticRenderProps);
                }
            }
            for (let l = 0; l < schemaNames.length; l += 1) {
                const name = schemaNames[l];
                const schemaPage = schemas[j] || [];
                const schema = schemaPage.find((s) => s.name == name);
                if (!schema) {
                    continue;
                }
                const render = renderObj[schema.type];
                if (!render) {
                    continue;
                }
                const value = schema.readOnly
                    ? (0, common_1.replacePlaceholders)({
                        content: schema.content || '',
                        variables: { ...input, totalPages: basePages.length, currentPage: j + 1 },
                        schemas: schemas, // Use the properly typed schemas variable
                    })
                    : (input[name] || '');
                schema.position = {
                    x: schema.position.x + boundingBoxLeft,
                    y: schema.position.y - boundingBoxBottom,
                };
                // Create properly typed render props
                const renderProps = {
                    value,
                    schema,
                    basePdf,
                    pdfLib,
                    pdfDoc,
                    page,
                    options,
                    _cache,
                };
                await render(renderProps);
            }
        }
    }
    (0, helper_js_1.postProcessing)({ pdfDoc, options });
    return pdfDoc.save();
};
exports.default = generate;
//# sourceMappingURL=generate.js.map