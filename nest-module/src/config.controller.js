"use strict";
/**
 * ConfigController - Configuration endpoint for frontend clients
 *
 * GET /api/pdfme/config
 * Returns fonts, locale configuration, and feature flags.
 * Requires authentication (JWT).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
let ConfigController = class ConfigController {
    getConfig() {
        return {
            fonts: [
                {
                    name: 'Helvetica',
                    label: 'Helvetica',
                    default: true,
                },
                {
                    name: 'Times-Roman',
                    label: 'Times New Roman',
                    default: false,
                },
                {
                    name: 'Courier',
                    label: 'Courier',
                    default: false,
                },
            ],
            locale: {
                locale: 'en-ZA',
                currency: {
                    code: 'ZAR',
                    symbol: 'R',
                    position: 'before',
                    thousandSeparator: ' ',
                    decimalSeparator: '.',
                    decimalPlaces: 2,
                },
                date: {
                    shortFormat: 'yyyy-MM-dd',
                    longFormat: 'dd MMMM yyyy',
                },
                number: {
                    thousandSeparator: ' ',
                    decimalSeparator: '.',
                },
            },
            features: {
                pdfA: false,
                bulkRender: true,
                signatures: true,
                expressionEngine: true,
                richText: false,
                watermark: true,
            },
        };
    }
};
exports.ConfigController = ConfigController;
tslib_1.__decorate([
    (0, common_1.Get)('config'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", void 0)
], ConfigController.prototype, "getConfig", null);
exports.ConfigController = ConfigController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme')
], ConfigController);
//# sourceMappingURL=config.controller.js.map