"use strict";
/**
 * FieldSchemaRegistry - Registry for template type field schemas
 *
 * Field schemas registered per template type, served via
 * GET /api/pdfme/field-schema/:templateType
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldSchemaRegistry = void 0;
class FieldSchemaRegistry {
    schemas = new Map();
    register(templateType, fieldGroups) {
        this.schemas.set(templateType, fieldGroups);
    }
    resolve(templateType) {
        return this.schemas.get(templateType);
    }
    has(templateType) {
        return this.schemas.has(templateType);
    }
}
exports.FieldSchemaRegistry = FieldSchemaRegistry;
//# sourceMappingURL=field-schema.registry.js.map