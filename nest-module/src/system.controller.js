"use strict";
/**
 * SystemController - Administrative system operations
 *
 * POST /api/pdfme/system/seed - Re-seed system templates (requires system:seed permission)
 * POST /api/pdfme/admin/seed - Seed comprehensive ERP test data (requires admin role)
 * GET  /api/pdfme/admin/seed/data - Get all seed datasets
 * GET  /api/pdfme/admin/seed/data/:templateType - Get seed data for a specific template type
 * GET  /api/pdfme/admin/seed/summary - Get summary of available seed data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("./auth.guard");
const seed_service_1 = require("./seeds/seed.service");
let SystemController = class SystemController {
    seedService;
    constructor(seedService) {
        this.seedService = seedService;
    }
    /**
     * Trigger system template seeding.
     * Requires the 'system:seed' permission in the JWT roles array.
     */
    async seedSystemTemplates() {
        await this.seedService.seedSystemTemplates();
        return {
            success: true,
            message: 'System templates seeded successfully',
        };
    }
    /**
     * Seed comprehensive ERP test data into the system.
     * Populates sample data for all template types.
     * Requires 'admin' role.
     */
    async seedErpData() {
        const result = await this.seedService.seedSampleData();
        return {
            success: result.success,
            message: 'ERP seed data loaded successfully',
            summary: result.summary,
            templateTypes: Object.keys(result.sampleInputsByType),
        };
    }
    /**
     * Get all raw seed datasets for inspection.
     */
    getAllSeedData() {
        return {
            success: true,
            data: this.seedService.getAllSeedData(),
        };
    }
    /**
     * Get seed input data for a specific template type.
     * Useful for populating the designer preview.
     */
    getSeedDataForType(templateType) {
        const inputs = this.seedService.getSeedInputsForType(templateType);
        if (!inputs || Object.keys(inputs).length === 0) {
            throw new common_1.HttpException({
                statusCode: 404,
                error: 'Not Found',
                message: `No seed data available for template type: ${templateType}`,
            }, common_1.HttpStatus.NOT_FOUND);
        }
        return {
            success: true,
            templateType,
            inputs,
        };
    }
    /**
     * Get summary of available seed data.
     */
    getSeedSummary() {
        return {
            success: true,
            summary: this.seedService.getSeedSummary(),
        };
    }
};
exports.SystemController = SystemController;
tslib_1.__decorate([
    (0, common_1.Post)('system/seed'),
    (0, common_1.HttpCode)(200),
    (0, auth_guard_1.RequirePermissions)('system:seed'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], SystemController.prototype, "seedSystemTemplates", null);
tslib_1.__decorate([
    (0, common_1.Post)('admin/seed'),
    (0, common_1.HttpCode)(200),
    (0, auth_guard_1.RequirePermissions)('admin'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], SystemController.prototype, "seedErpData", null);
tslib_1.__decorate([
    (0, common_1.Get)('admin/seed/data'),
    (0, auth_guard_1.RequirePermissions)('admin'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], SystemController.prototype, "getAllSeedData", null);
tslib_1.__decorate([
    (0, common_1.Get)('admin/seed/data/:templateType'),
    tslib_1.__param(0, (0, common_1.Param)('templateType')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", void 0)
], SystemController.prototype, "getSeedDataForType", null);
tslib_1.__decorate([
    (0, common_1.Get)('admin/seed/summary'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], SystemController.prototype, "getSeedSummary", null);
exports.SystemController = SystemController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme'),
    tslib_1.__metadata("design:paramtypes", [seed_service_1.SeedService])
], SystemController);
//# sourceMappingURL=system.controller.js.map