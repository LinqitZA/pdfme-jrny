"use strict";
/**
 * DataSourceRegistry - Registry for document type data sources
 *
 * Each document/report type registers a DataSource implementation.
 * Host ERP registers DataSources at module initialisation.
 *
 * Usage:
 *   registry.register({ templateType: 'invoice', resolve: async (entityId, orgId) => [...] });
 *   const ds = registry.resolve('invoice'); // returns the DataSource
 *   registry.resolve('unknown'); // throws Error
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataSourceRegistry = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
let DataSourceRegistry = class DataSourceRegistry {
    sources = new Map();
    /**
     * Register a DataSource for a template type.
     * Overwrites any existing registration for the same type.
     */
    register(source) {
        this.sources.set(source.templateType, source);
    }
    /**
     * Resolve a DataSource by template type.
     * Throws an Error if no DataSource is registered for the given type.
     */
    resolve(templateType) {
        const source = this.sources.get(templateType);
        if (!source) {
            throw new Error(`No DataSource registered for template type "${templateType}". ` +
                `Registered types: [${this.getRegisteredTypes().join(', ')}]`);
        }
        return source;
    }
    /**
     * Check if a DataSource is registered for a template type.
     */
    has(templateType) {
        return this.sources.has(templateType);
    }
    /**
     * Get all registered template types.
     */
    getRegisteredTypes() {
        return Array.from(this.sources.keys());
    }
    /**
     * Unregister a DataSource for a template type.
     * Returns true if a DataSource was removed, false if none existed.
     */
    unregister(templateType) {
        return this.sources.delete(templateType);
    }
};
exports.DataSourceRegistry = DataSourceRegistry;
exports.DataSourceRegistry = DataSourceRegistry = tslib_1.__decorate([
    (0, common_1.Injectable)()
], DataSourceRegistry);
//# sourceMappingURL=datasource.registry.js.map