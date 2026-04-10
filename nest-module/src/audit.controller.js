"use strict";
/**
 * AuditController - Query audit log entries
 *
 * GET /api/pdfme/audit - Returns paginated audit log entries
 * Supports filtering by entityType, entityId, action, and date range (from/to).
 * Results in reverse chronological order.
 *
 * APPEND-ONLY: PUT and DELETE endpoints always return 403.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const audit_service_1 = require("./audit.service");
let AuditController = class AuditController {
    auditService;
    constructor(auditService) {
        this.auditService = auditService;
    }
    /**
     * GET /api/pdfme/audit/policy - Returns the append-only policy status
     * Must be defined BEFORE audit/:id to avoid route conflict.
     */
    async getAuditPolicy() {
        const enforcement = await this.auditService.verifyAppendOnlyEnforcement();
        return {
            policy: 'append-only',
            description: 'AuditLog table rejects UPDATE and DELETE operations',
            enforcement,
        };
    }
    async getAuditLogs(req, entityType, entityId, action, limitStr, cursor, from, to) {
        const orgId = req.user.orgId;
        const limit = limitStr ? parseInt(limitStr, 10) : 20;
        return this.auditService.query({
            orgId,
            entityType,
            entityId,
            action,
            limit: isNaN(limit) ? 20 : limit,
            cursor,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
        });
    }
    /**
     * Attempt to update an audit log entry - ALWAYS fails (append-only enforcement)
     */
    async updateAuditLog(id) {
        throw new common_1.HttpException({ error: 'Forbidden', message: 'Audit log is append-only: UPDATE operations are not allowed' }, common_1.HttpStatus.FORBIDDEN);
    }
    /**
     * Attempt to delete an audit log entry - ALWAYS fails (append-only enforcement)
     */
    async deleteAuditLog(id) {
        throw new common_1.HttpException({ error: 'Forbidden', message: 'Audit log is append-only: DELETE operations are not allowed' }, common_1.HttpStatus.FORBIDDEN);
    }
};
exports.AuditController = AuditController;
tslib_1.__decorate([
    (0, common_1.Get)('audit/policy'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], AuditController.prototype, "getAuditPolicy", null);
tslib_1.__decorate([
    (0, common_1.Get)('audit'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__param(1, (0, common_1.Query)('entityType')),
    tslib_1.__param(2, (0, common_1.Query)('entityId')),
    tslib_1.__param(3, (0, common_1.Query)('action')),
    tslib_1.__param(4, (0, common_1.Query)('limit')),
    tslib_1.__param(5, (0, common_1.Query)('cursor')),
    tslib_1.__param(6, (0, common_1.Query)('from')),
    tslib_1.__param(7, (0, common_1.Query)('to')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], AuditController.prototype, "getAuditLogs", null);
tslib_1.__decorate([
    (0, common_1.Put)('audit/:id'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], AuditController.prototype, "updateAuditLog", null);
tslib_1.__decorate([
    (0, common_1.Delete)('audit/:id'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], AuditController.prototype, "deleteAuditLog", null);
exports.AuditController = AuditController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme'),
    tslib_1.__metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditController);
//# sourceMappingURL=audit.controller.js.map