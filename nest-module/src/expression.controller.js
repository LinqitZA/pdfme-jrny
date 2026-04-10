"use strict";
/**
 * ExpressionController - Expression evaluation endpoint
 *
 * POST /api/pdfme/expressions/evaluate
 * Evaluates an expression with the given context and optional locale config.
 * Used by the designer's "Test" button and for server-side expression evaluation.
 *
 * POST /api/pdfme/expressions/locale
 * Set or get the default locale configuration for the org.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpressionController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const schemas_1 = require("@pdfme-erp/schemas");
/** In-memory locale config per org (in production, this would be stored in DB) */
const orgLocaleConfigs = new Map();
let ExpressionController = class ExpressionController {
    evaluate(body, req) {
        if (!body.expression || typeof body.expression !== 'string') {
            throw new common_1.BadRequestException('expression is required and must be a string');
        }
        // Determine locale: explicit > org config > defaults
        const orgId = req.user?.orgId || '';
        const orgConfig = orgLocaleConfigs.get(orgId);
        const engineOptions = {
            locale: body.locale || orgConfig?.locale || 'en-US',
            currency: body.currency || orgConfig?.currency || 'USD',
            timezone: body.timezone || orgConfig?.timezone || 'UTC',
            onError: body.onError,
        };
        const engine = new schemas_1.ExpressionEngine(engineOptions);
        try {
            const result = engine.evaluate(body.expression, body.context || {});
            return {
                expression: body.expression,
                result,
                type: typeof result,
                locale: engineOptions.locale,
                currency: engineOptions.currency,
                timezone: engineOptions.timezone,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new common_1.BadRequestException(`Expression error: ${message}`);
        }
    }
    /**
     * Set or get locale configuration for the current org.
     * POST body: { locale: 'en-ZA', currency: 'ZAR' }
     */
    setLocale(body, req) {
        const orgId = req.user?.orgId || '';
        if (!body.locale && !body.currency && !body.timezone) {
            throw new common_1.BadRequestException('At least one of locale, currency, or timezone is required');
        }
        const current = orgLocaleConfigs.get(orgId) || { locale: 'en-US', currency: 'USD', timezone: 'UTC' };
        if (body.locale)
            current.locale = body.locale;
        if (body.currency)
            current.currency = body.currency;
        if (body.timezone)
            current.timezone = body.timezone;
        orgLocaleConfigs.set(orgId, current);
        return {
            orgId,
            locale: current.locale,
            currency: current.currency,
            timezone: current.timezone,
            message: 'Locale config updated',
        };
    }
    /**
     * Get current locale configuration for the org.
     */
    getLocale(req) {
        const orgId = req.user?.orgId || '';
        const config = orgLocaleConfigs.get(orgId) || { locale: 'en-US', currency: 'USD', timezone: 'UTC' };
        return {
            orgId,
            locale: config.locale,
            currency: config.currency,
            timezone: config.timezone,
        };
    }
};
exports.ExpressionController = ExpressionController;
tslib_1.__decorate([
    (0, common_1.Post)('evaluate'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", void 0)
], ExpressionController.prototype, "evaluate", null);
tslib_1.__decorate([
    (0, common_1.Post)('locale'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", void 0)
], ExpressionController.prototype, "setLocale", null);
tslib_1.__decorate([
    (0, common_1.Get)('locale'),
    tslib_1.__param(0, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object]),
    tslib_1.__metadata("design:returntype", void 0)
], ExpressionController.prototype, "getLocale", null);
exports.ExpressionController = ExpressionController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/expressions')
], ExpressionController);
//# sourceMappingURL=expression.controller.js.map