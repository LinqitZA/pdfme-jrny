"use strict";
/**
 * GroupedTableController - REST endpoint for grouped table rendering
 *
 * Endpoints:
 * - POST /api/pdfme/grouped-table/render   - Render grouped table to structured output
 * - POST /api/pdfme/grouped-table/pdf      - Render grouped table to PDF via pdfme
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupedTableController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const schemas_1 = require("@pdfme-erp/schemas");
const cuid2_1 = require("@paralleldrive/cuid2");
const schema_1 = require("./db/schema");
const file_storage_service_1 = require("./file-storage.service");
const hash_service_1 = require("./hash.service");
const drizzle_orm_1 = require("drizzle-orm");
let GroupedTableController = class GroupedTableController {
    db;
    fileStorage;
    hashService;
    constructor(db, fileStorage, hashService) {
        this.db = db;
        this.fileStorage = fileStorage;
        this.hashService = hashService;
    }
    /**
     * Render grouped table data into a structured row output.
     * Returns the rendered rows with group headers, data rows, subtotals, and grand total.
     */
    async renderGroupedTable(body, req) {
        if (!body.columns || !body.groupBy || !body.data) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'columns, groupBy, and data are required',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (body.groupBy.length === 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'groupBy must contain at least one field',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (body.groupBy.length > 3) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Maximum 3 levels of grouping supported',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        try {
            const table = new schemas_1.GroupedTable({
                columns: body.columns,
                groupBy: body.groupBy,
                data: body.data,
                showGroupHeaders: body.showGroupHeaders,
                showGroupFooters: body.showGroupFooters,
                showGrandTotal: body.showGrandTotal,
            });
            const rendered = table.render();
            const summary = table.getSummary();
            const tree = table.buildGroupTree();
            return {
                rows: rendered,
                summary,
                tree,
                tableData: table.toPdfmeTableInput(),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({
                statusCode: 500,
                error: 'Internal Server Error',
                message: `Grouped table render failed: ${message}`,
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    /**
     * Render grouped table data to a PDF document.
     * Creates a pdfme template with a table element and generates a PDF.
     */
    async renderGroupedTablePdf(body, req) {
        const user = req.user;
        if (!user?.orgId) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'orgId is required in JWT claims',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body.columns || !body.groupBy || !body.data) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'columns, groupBy, and data are required',
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        try {
            const table = new schemas_1.GroupedTable({
                columns: body.columns,
                groupBy: body.groupBy,
                data: body.data,
                showGroupHeaders: body.showGroupHeaders,
                showGroupFooters: body.showGroupFooters,
                showGrandTotal: body.showGrandTotal,
            });
            const rendered = table.render();
            const tableData = table.toPdfmeTableInput();
            // Build pdfme template using table plugin
            // The pdfme table plugin expects: head as string[], body as JSON string of string[][]
            const columnWidths = body.columns.map((c) => c.width);
            const totalWidth = columnWidths.reduce((s, w) => s + w, 0);
            const tableWidth = Math.min(totalWidth, 190);
            // pdfme table schema matching TableSchema interface
            const tableSchema = {
                name: 'groupedTable',
                type: 'table',
                position: { x: 10, y: body.title ? 25 : 10 },
                width: tableWidth,
                height: Math.min(rendered.length * 7 + 10, 270),
                head: body.columns.map((c) => c.header),
                headWidthPercentages: columnWidths.map((w) => (w / totalWidth) * 100),
                showHead: true,
                tableStyles: { borderWidth: 0.3, borderColor: '#999999' },
                headStyles: {
                    fontName: undefined,
                    alignment: 'left',
                    verticalAlignment: 'middle',
                    fontSize: 9,
                    lineHeight: 1.2,
                    characterSpacing: 0,
                    fontColor: '#000000',
                    backgroundColor: '#d0d0d0',
                    borderColor: '#999999',
                    borderWidth: { top: 0.3, right: 0.3, bottom: 0.3, left: 0.3 },
                    padding: { top: 2, right: 2, bottom: 2, left: 2 },
                },
                bodyStyles: {
                    fontName: undefined,
                    alignment: 'left',
                    verticalAlignment: 'middle',
                    fontSize: 8,
                    lineHeight: 1.2,
                    characterSpacing: 0,
                    fontColor: '#000000',
                    backgroundColor: '#ffffff',
                    alternateBackgroundColor: '#f9f9f9',
                    borderColor: '#cccccc',
                    borderWidth: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
                    padding: { top: 1.5, right: 2, bottom: 1.5, left: 2 },
                },
                columnStyles: {
                    alignment: Object.fromEntries(body.columns.map((col, i) => [i, col.align || 'left'])),
                },
            };
            const schemaArray = [tableSchema];
            if (body.title) {
                schemaArray.push({
                    name: 'title',
                    type: 'text',
                    position: { x: 10, y: 10 },
                    width: 190,
                    height: 12,
                    fontSize: 14,
                });
            }
            const pdfmeTemplate = {
                basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
                schemas: [schemaArray],
            };
            // Build body rows (excluding the column header row from tableData since showHead handles it)
            const bodyRows = tableData.slice(1);
            const inputs = {
                groupedTable: JSON.stringify(bodyRows),
            };
            if (body.title) {
                inputs.title = body.title;
            }
            // Generate PDF
            const { generate } = await Promise.resolve().then(() => tslib_1.__importStar(require('@pdfme/generator')));
            const schemas = await Promise.resolve().then(() => tslib_1.__importStar(require('@pdfme/schemas')));
            const plugins = {
                text: schemas.text,
                table: schemas.table,
            };
            const pdfBuffer = await generate({
                template: pdfmeTemplate,
                inputs: [inputs],
                plugins,
            });
            // Store PDF
            const docId = (0, cuid2_1.createId)();
            const pdfBuf = Buffer.from(pdfBuffer);
            const pdfHash = this.hashService.computeHash(pdfBuf);
            const filePath = `${user.orgId}/documents/grouped_${docId}.pdf`;
            await this.fileStorage.write(filePath, pdfBuf);
            // Create or find an ad-hoc grouped-table template for document records
            let adhocTemplateId;
            const existingTemplates = await this.db
                .select({ id: schema_1.templates.id })
                .from(schema_1.templates)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.templates.id, 'sys-grouped-table-adhoc')));
            if (existingTemplates.length > 0) {
                adhocTemplateId = existingTemplates[0].id;
            }
            else {
                const [newTemplate] = await this.db
                    .insert(schema_1.templates)
                    .values({
                    id: 'sys-grouped-table-adhoc',
                    orgId: null,
                    type: 'report',
                    name: 'Grouped Table (Ad-hoc)',
                    schema: { type: 'grouped-table' },
                    status: 'published',
                    version: 1,
                    createdBy: 'system',
                })
                    .returning();
                adhocTemplateId = newTemplate.id;
            }
            // Create document record
            const [document] = await this.db
                .insert(schema_1.generatedDocuments)
                .values({
                id: docId,
                orgId: user.orgId,
                templateId: adhocTemplateId,
                templateVer: 1,
                entityType: 'report',
                entityId: `grouped-${docId}`,
                filePath,
                pdfHash,
                status: 'done',
                outputChannel: 'api',
                triggeredBy: user.sub,
                inputSnapshot: body,
            })
                .returning();
            return {
                document,
                summary: table.getSummary(),
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({
                statusCode: 500,
                error: 'Internal Server Error',
                message: `Grouped table PDF render failed: ${message}`,
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.GroupedTableController = GroupedTableController;
tslib_1.__decorate([
    (0, common_1.Post)('render'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], GroupedTableController.prototype, "renderGroupedTable", null);
tslib_1.__decorate([
    (0, common_1.Post)('pdf'),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], GroupedTableController.prototype, "renderGroupedTablePdf", null);
exports.GroupedTableController = GroupedTableController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/grouped-table'),
    tslib_1.__param(0, (0, common_1.Inject)('DRIZZLE_DB')),
    tslib_1.__param(1, (0, common_1.Inject)('FILE_STORAGE')),
    tslib_1.__metadata("design:paramtypes", [Object, file_storage_service_1.FileStorageService,
        hash_service_1.HashService])
], GroupedTableController);
//# sourceMappingURL=grouped-table.controller.js.map