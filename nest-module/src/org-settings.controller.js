"use strict";
/**
 * OrgSettingsController - REST endpoints for per-org settings
 *
 * Endpoints:
 * - GET  /api/pdfme/org-settings         (get current org settings)
 * - PUT  /api/pdfme/org-settings         (update org settings)
 * - POST /api/pdfme/org-settings/reset   (reset to defaults)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgSettingsController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const org_settings_service_1 = require("./org-settings.service");
let OrgSettingsController = class OrgSettingsController {
    orgSettingsService;
    constructor(orgSettingsService) {
        this.orgSettingsService = orgSettingsService;
    }
    getSettings(req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const settings = this.orgSettingsService.get(user.orgId);
        return {
            orgId: user.orgId,
            settings,
        };
    }
    updateSettings(body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate known boolean fields
        if (body.pdfUA !== undefined && typeof body.pdfUA !== 'boolean') {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'pdfUA must be a boolean' }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (body.pdfA !== undefined && typeof body.pdfA !== 'boolean') {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'pdfA must be a boolean' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const updated = this.orgSettingsService.update(user.orgId, body);
        return {
            orgId: user.orgId,
            settings: updated,
            message: 'Settings updated successfully',
        };
    }
    resetSettings(req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const settings = this.orgSettingsService.reset(user.orgId);
        return {
            orgId: user.orgId,
            settings,
            message: 'Settings reset to defaults',
        };
    }
};
exports.OrgSettingsController = OrgSettingsController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], OrgSettingsController.prototype, "getSettings", null);
tslib_1.__decorate([
    (0, common_1.Put)(),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", void 0)
], OrgSettingsController.prototype, "updateSettings", null);
tslib_1.__decorate([
    (0, common_1.Post)('reset'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], OrgSettingsController.prototype, "resetSettings", null);
exports.OrgSettingsController = OrgSettingsController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/org-settings'),
    tslib_1.__metadata("design:paramtypes", [org_settings_service_1.OrgSettingsService])
], OrgSettingsController);
//# sourceMappingURL=org-settings.controller.js.map