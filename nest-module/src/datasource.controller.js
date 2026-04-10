"use strict";
/**
 * DataSourceController - REST endpoints for DataSource registry management
 *
 * Endpoints:
 * - GET    /api/pdfme/datasources              (list registered types)
 * - GET    /api/pdfme/datasources/:type         (check if type is registered)
 * - POST   /api/pdfme/datasources/:type/resolve (resolve data for an entity via the registered DataSource)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataSourceController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const datasource_registry_1 = require("./datasource.registry");
let DataSourceController = class DataSourceController {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    /**
     * List all registered DataSource template types.
     */
    listRegisteredTypes() {
        return {
            types: this.registry.getRegisteredTypes(),
            count: this.registry.getRegisteredTypes().length,
        };
    }
    /**
     * Check if a DataSource is registered for a template type.
     * Returns the type info if registered, 404 if not.
     */
    checkType(type) {
        if (!this.registry.has(type)) {
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: `No DataSource registered for template type "${type}"`,
                registeredTypes: this.registry.getRegisteredTypes(),
            }, common_1.HttpStatus.NOT_FOUND);
        }
        return {
            templateType: type,
            registered: true,
        };
    }
    /**
     * Register a test DataSource for development/testing.
     * The DataSource will resolve with provided sample data, or throw an error
     * if errorMessage is provided.
     */
    registerTestDataSource(type, body) {
        const sampleData = body.sampleData || [{ field1: 'value1' }];
        const errorMessage = body.errorMessage;
        this.registry.register({
            templateType: type,
            resolve: async (_entityId, _orgId) => {
                if (errorMessage) {
                    throw new Error(errorMessage);
                }
                return sampleData;
            },
        });
        return {
            registered: true,
            templateType: type,
            willThrow: !!errorMessage,
        };
    }
    /**
     * Unregister a DataSource for a template type (cleanup).
     */
    unregisterDataSource(type) {
        const removed = this.registry.unregister(type);
        return { unregistered: removed, templateType: type };
    }
    /**
     * Resolve data for an entity using the registered DataSource.
     */
    async resolveData(type, body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body.entityId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'entityId is required' }, common_1.HttpStatus.BAD_REQUEST);
        }
        let dataSource;
        try {
            dataSource = this.registry.resolve(type);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: msg,
            }, common_1.HttpStatus.NOT_FOUND);
        }
        try {
            const data = await dataSource.resolve(body.entityId, user.orgId, body.params);
            return {
                templateType: type,
                entityId: body.entityId,
                data,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({ statusCode: 500, error: 'Internal Server Error', message: `DataSource resolve failed: ${msg}` }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.DataSourceController = DataSourceController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], DataSourceController.prototype, "listRegisteredTypes", null);
tslib_1.__decorate([
    (0, common_1.Get)(':type'),
    tslib_1.__param(0, (0, common_1.Param)('type')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", void 0)
], DataSourceController.prototype, "checkType", null);
tslib_1.__decorate([
    (0, common_1.Post)(':type/register-test'),
    tslib_1.__param(0, (0, common_1.Param)('type')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", void 0)
], DataSourceController.prototype, "registerTestDataSource", null);
tslib_1.__decorate([
    (0, common_1.Post)(':type/unregister'),
    tslib_1.__param(0, (0, common_1.Param)('type')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", void 0)
], DataSourceController.prototype, "unregisterDataSource", null);
tslib_1.__decorate([
    (0, common_1.Post)(':type/resolve'),
    tslib_1.__param(0, (0, common_1.Param)('type')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], DataSourceController.prototype, "resolveData", null);
exports.DataSourceController = DataSourceController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/datasources'),
    tslib_1.__metadata("design:paramtypes", [datasource_registry_1.DataSourceRegistry])
], DataSourceController);
//# sourceMappingURL=datasource.controller.js.map