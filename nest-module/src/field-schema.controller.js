"use strict";
/**
 * FieldSchemaController - Serves field schema definitions per template type
 *
 * GET /api/pdfme/field-schema/:templateType
 * Returns field groups with key, label, type for each field.
 * Used by the designer Fields tab to show available data bindings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldSchemaController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const field_schema_registry_1 = require("./field-schema.registry");
let FieldSchemaController = class FieldSchemaController {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    getFieldSchema(templateType) {
        const fieldGroups = this.registry.resolve(templateType);
        if (!fieldGroups) {
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: `No field schema registered for template type: ${templateType}`,
                timestamp: new Date().toISOString(),
                path: `/api/pdfme/field-schema/${templateType}`,
            }, common_1.HttpStatus.NOT_FOUND);
        }
        return {
            templateType,
            fieldGroups,
        };
    }
};
exports.FieldSchemaController = FieldSchemaController;
tslib_1.__decorate([
    (0, common_1.Get)(':templateType'),
    tslib_1.__param(0, (0, common_1.Param)('templateType')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", void 0)
], FieldSchemaController.prototype, "getFieldSchema", null);
exports.FieldSchemaController = FieldSchemaController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/field-schema'),
    tslib_1.__param(0, (0, common_1.Inject)('FIELD_SCHEMA_REGISTRY')),
    tslib_1.__metadata("design:paramtypes", [field_schema_registry_1.FieldSchemaRegistry])
], FieldSchemaController);
//# sourceMappingURL=field-schema.controller.js.map