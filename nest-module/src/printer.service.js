"use strict";
/**
 * PrinterService - Printer CRUD and raw TCP socket send
 *
 * Manages printer configurations and sends raw PDF bytes to
 * network printers via TCP socket (port 9100 - RAW/JetDirect protocol).
 */
var PrinterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrinterService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const cuid2_1 = require("@paralleldrive/cuid2");
const net = tslib_1.__importStar(require("net"));
const schema_1 = require("./db/schema");
/** SSRF protection: only allow private network IPs */
function isPrivateNetwork(host) {
    // Allow common private network ranges and localhost
    const privatePatterns = [
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
        /^192\.168\.\d{1,3}\.\d{1,3}$/,
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
        /^localhost$/i,
        /^0\.0\.0\.0$/,
    ];
    return privatePatterns.some((p) => p.test(host));
}
let PrinterService = PrinterService_1 = class PrinterService {
    db;
    logger = new common_1.Logger(PrinterService_1.name);
    constructor(db) {
        this.db = db;
    }
    async create(orgId, dto) {
        // SSRF protection
        if (!isPrivateNetwork(dto.host)) {
            throw new Error(`SSRF_BLOCKED: Printer host '${dto.host}' is not on a private network`);
        }
        const id = (0, cuid2_1.createId)();
        const now = new Date();
        const record = {
            id,
            orgId,
            name: dto.name,
            host: dto.host,
            port: dto.port || 9100,
            type: dto.type || 'raw',
            isDefault: dto.isDefault ? 'true' : 'false',
            createdAt: now,
            updatedAt: now,
        };
        await this.db.insert(schema_1.printers).values(record);
        return record;
    }
    async findAll(orgId) {
        return this.db
            .select()
            .from(schema_1.printers)
            .where((0, drizzle_orm_1.eq)(schema_1.printers.orgId, orgId));
    }
    async findById(orgId, id) {
        const results = await this.db
            .select()
            .from(schema_1.printers)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.printers.id, id), (0, drizzle_orm_1.eq)(schema_1.printers.orgId, orgId)));
        return results[0] || null;
    }
    async delete(orgId, id) {
        const existing = await this.findById(orgId, id);
        if (!existing)
            return null;
        await this.db.delete(schema_1.printers).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.printers.id, id), (0, drizzle_orm_1.eq)(schema_1.printers.orgId, orgId)));
        return existing;
    }
    /**
     * Send raw PDF bytes to a printer via TCP socket.
     * Connection timeout: 5s, send timeout: 30s.
     */
    async sendToPrinter(host, port, pdfData) {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket();
            const connectTimeout = setTimeout(() => {
                socket.destroy();
                reject(new Error(`Connection timeout: could not connect to ${host}:${port} within 5s`));
            }, 5000);
            socket.connect(port, host, () => {
                clearTimeout(connectTimeout);
                const sendTimeout = setTimeout(() => {
                    socket.destroy();
                    reject(new Error(`Send timeout: data transfer to ${host}:${port} exceeded 30s`));
                }, 30000);
                socket.write(pdfData, (err) => {
                    clearTimeout(sendTimeout);
                    if (err) {
                        socket.destroy();
                        reject(new Error(`Send error: ${err.message}`));
                    }
                    else {
                        socket.end(() => resolve());
                    }
                });
            });
            socket.on('error', (err) => {
                clearTimeout(connectTimeout);
                reject(new Error(`Socket error: ${err.message}`));
            });
        });
    }
    /** Validate that a host is on a private network (for controller use) */
    static validateHost(host) {
        return isPrivateNetwork(host);
    }
};
exports.PrinterService = PrinterService;
exports.PrinterService = PrinterService = PrinterService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)('DRIZZLE_DB')),
    tslib_1.__metadata("design:paramtypes", [Object])
], PrinterService);
//# sourceMappingURL=printer.service.js.map