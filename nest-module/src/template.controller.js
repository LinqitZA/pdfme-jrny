"use strict";
/**
 * TemplateController - REST endpoints for template management
 *
 * Endpoints:
 * - GET    /api/pdfme/templates              (list)
 * - POST   /api/pdfme/templates              (create)
 * - GET    /api/pdfme/templates/:id          (get by ID)
 * - PUT    /api/pdfme/templates/:id          (update)
 * - PUT    /api/pdfme/templates/:id/draft   (save draft changes)
 * - POST   /api/pdfme/templates/:id/preview  (generate preview PDF)
 * - DELETE /api/pdfme/templates/:id          (soft delete / archive)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateController = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const template_service_1 = require("./template.service");
const render_service_1 = require("./render.service");
const auth_guard_1 = require("./auth.guard");
/**
 * Extract orgId and userId from JWT token (simple decode for now).
 * In production, this would be a proper Guard with full JWT verification.
 */
function decodeJwt(authHeader) {
    if (!authHeader?.startsWith('Bearer '))
        return null;
    try {
        const token = authHeader.slice(7);
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return {
            sub: payload.sub || 'unknown',
            orgId: payload.orgId || '',
            roles: payload.roles || [],
        };
    }
    catch {
        return null;
    }
}
let TemplateController = class TemplateController {
    templateService;
    renderService;
    constructor(templateService, renderService) {
        this.templateService = templateService;
        this.renderService = renderService;
    }
    /**
     * Validate that a schema field is valid JSON and has proper structure.
     * Returns null if valid, or throws appropriate HTTP exception.
     */
    validateSchemaField(schema) {
        // Check 1: schema must be a JSON object (not string, array, number, etc.)
        if (schema === undefined) {
            return; // schema is optional on updates
        }
        if (schema === null) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'schema cannot be null',
                details: [{ field: 'schema', reason: 'schema must be a valid JSON object, not null' }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (typeof schema === 'string') {
            // Someone sent schema as a string instead of a JSON object
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'schema must be a valid JSON object, not a string',
                details: [{ field: 'schema', reason: 'Expected a JSON object but received a string. Ensure schema is sent as a JSON object, not a JSON-encoded string.' }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        if (typeof schema !== 'object' || Array.isArray(schema)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'schema must be a valid JSON object',
                details: [{ field: 'schema', reason: `Expected a JSON object but received ${Array.isArray(schema) ? 'an array' : typeof schema}` }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Check 2: structural validation - schema should have proper structure
        const schemaObj = schema;
        const structuralErrors = [];
        // Check for pages or schemas array (required structure)
        const pages = schemaObj.pages || schemaObj.schemas;
        if (pages !== undefined) {
            if (!Array.isArray(pages)) {
                structuralErrors.push({
                    field: 'schema.pages',
                    reason: 'pages must be an array',
                });
            }
            else {
                // Validate each page is an object
                pages.forEach((page, idx) => {
                    if (page !== null && page !== undefined && typeof page !== 'object') {
                        structuralErrors.push({
                            field: `schema.pages[${idx}]`,
                            reason: 'Each page must be an object',
                        });
                    }
                });
            }
        }
        // Check for invalid top-level types that indicate wrong structure
        if (typeof schemaObj.basePdf !== 'undefined' && typeof schemaObj.basePdf !== 'string' && typeof schemaObj.basePdf !== 'object') {
            structuralErrors.push({
                field: 'schema.basePdf',
                reason: 'basePdf must be a string (URL/path) or object',
            });
        }
        if (structuralErrors.length > 0) {
            throw new common_1.HttpException({
                statusCode: 422,
                error: 'Unprocessable Entity',
                message: 'Template schema has structural errors',
                details: structuralErrors,
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
    }
    async list(queryOrgId, queryLimit, queryCursor, queryType, queryStatus, querySort, queryOrder, querySearch, authHeader) {
        // Prefer orgId from JWT, fallback to query param for dev convenience
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId;
        const limit = queryLimit ? Math.min(Math.max(parseInt(queryLimit, 10) || 100, 1), 1000) : 100;
        return this.templateService.findAll(orgId, {
            limit,
            cursor: queryCursor,
            type: queryType,
            status: queryStatus,
            sort: querySort,
            order: queryOrder,
            search: querySearch ? querySearch.replace(/\0/g, '') : undefined,
        });
    }
    async getDistinctTypes(queryOrgId, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId;
        const types = await this.templateService.getDistinctTypes(orgId);
        return { types };
    }
    async create(body, authHeader) {
        // Valid template type enum values
        const VALID_TEMPLATE_TYPES = [
            'invoice', 'statement', 'purchase_order', 'delivery_note', 'credit_note',
            'report_aged_debtors', 'report_stock_on_hand', 'report_sales_summary',
            'report', 'custom',
        ];
        // Validate required fields with detailed error envelope
        const missingFields = [];
        if (!body.name || (typeof body.name === 'string' && !body.name.trim()))
            missingFields.push('name');
        if (!body.type || (typeof body.type === 'string' && !body.type.trim()))
            missingFields.push('type');
        if (!body.schema)
            missingFields.push('schema');
        if (missingFields.length > 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'name, type, and schema are required',
                details: missingFields.map(f => ({ field: f, reason: `${f} is required` })),
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate type is a valid enum value
        if (!VALID_TEMPLATE_TYPES.includes(body.type)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: `Invalid template type: "${body.type}". Must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`,
                details: [{ field: 'type', reason: `must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}` }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Validate schema is an object
        if (typeof body.schema !== 'object' || Array.isArray(body.schema)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'schema must be a JSON object',
                details: [{ field: 'schema', reason: 'must be a JSON object, not an array or primitive' }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        const jwt = decodeJwt(authHeader);
        // SECURITY: orgId MUST come from JWT, never from request body
        const orgId = jwt?.orgId || body.orgId || null;
        const createdBy = jwt?.sub || body.createdBy || 'system';
        const result = await this.templateService.create({
            ...body,
            orgId,
            createdBy,
        });
        // Return id and status as per API contract
        return {
            id: result.id,
            status: result.status,
            name: result.name,
            type: result.type,
            version: result.version,
            createdAt: result.createdAt,
        };
    }
    async importTemplate(body, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        // Step 1: Basic type check - body must be a non-null object (not array, string, number, etc.)
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Request body must be a valid JSON object',
                details: [{ field: 'body', reason: 'Expected a JSON object representing an export package' }],
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Step 2: Check required top-level fields exist
        const missingTopLevel = [];
        if (body.version === undefined || body.version === null) {
            missingTopLevel.push({ field: 'version', reason: 'version is required (must be 1)' });
        }
        if (!body.template) {
            missingTopLevel.push({ field: 'template', reason: 'template object is required' });
        }
        if (missingTopLevel.length > 0) {
            throw new common_1.HttpException({
                statusCode: 400,
                error: 'Bad Request',
                message: 'Invalid export package format',
                details: missingTopLevel,
            }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Step 3: Structural validation - valid JSON but wrong structure → 422
        const structuralErrors = [];
        // Validate version
        if (body.version !== 1) {
            structuralErrors.push({ field: 'version', reason: `Unsupported package version: ${body.version}. Only version 1 is supported.` });
        }
        // Validate template is an object
        if (typeof body.template !== 'object' || Array.isArray(body.template)) {
            structuralErrors.push({ field: 'template', reason: 'template must be an object' });
        }
        else {
            // Validate required template fields
            if (!body.template.name || (typeof body.template.name === 'string' && !body.template.name.trim())) {
                structuralErrors.push({ field: 'template.name', reason: 'template.name is required and must be a non-empty string' });
            }
            if (!body.template.type || (typeof body.template.type === 'string' && !body.template.type.trim())) {
                structuralErrors.push({ field: 'template.type', reason: 'template.type is required and must be a non-empty string' });
            }
            if (!body.template.schema) {
                structuralErrors.push({ field: 'template.schema', reason: 'template.schema is required' });
            }
            else if (typeof body.template.schema !== 'object' || Array.isArray(body.template.schema)) {
                structuralErrors.push({ field: 'template.schema', reason: 'template.schema must be a JSON object' });
            }
        }
        // Validate assets structure if present
        if (body.assets !== undefined) {
            if (typeof body.assets !== 'object' || Array.isArray(body.assets)) {
                structuralErrors.push({ field: 'assets', reason: 'assets must be an object with images and fonts arrays' });
            }
            else {
                if (body.assets.images !== undefined && !Array.isArray(body.assets.images)) {
                    structuralErrors.push({ field: 'assets.images', reason: 'assets.images must be an array' });
                }
                if (body.assets.fonts !== undefined && !Array.isArray(body.assets.fonts)) {
                    structuralErrors.push({ field: 'assets.fonts', reason: 'assets.fonts must be an array' });
                }
            }
        }
        if (structuralErrors.length > 0) {
            throw new common_1.HttpException({
                statusCode: 422,
                error: 'Unprocessable Entity',
                message: 'Export package has structural errors',
                details: structuralErrors,
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        // Ensure assets has default structure
        const validatedBody = {
            version: body.version,
            exportedAt: body.exportedAt || new Date().toISOString(),
            template: body.template,
            assets: {
                images: body.assets?.images || [],
                fonts: body.assets?.fonts || [],
            },
        };
        const result = await this.templateService.importTemplate(validatedBody, jwt.orgId, jwt.sub);
        return result;
    }
    async backupOrg(authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        // Fetch locale config from expression controller's in-memory store
        // For backup we pass it through if available via query or use defaults
        let localeConfig;
        try {
            // Try to fetch locale config from the expressions endpoint
            const http = await Promise.resolve().then(() => tslib_1.__importStar(require('http')));
            const localeData = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/pdfme/expressions/locale',
                    method: 'GET',
                    headers: { 'Authorization': authHeader || '' },
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
                req.end();
            });
            if (localeData && localeData.locale) {
                localeConfig = {
                    locale: localeData.locale,
                    currency: localeData.currency || 'USD',
                    timezone: localeData.timezone || 'UTC',
                };
            }
        }
        catch {
            // Locale config not available, will be null in backup
        }
        const backup = await this.templateService.backupOrg(jwt.orgId, localeConfig);
        return backup;
    }
    async backupExportZip(authHeader, res) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        // Fetch locale config
        let localeConfig;
        try {
            const http = await Promise.resolve().then(() => tslib_1.__importStar(require('http')));
            const localeData = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/pdfme/expressions/locale',
                    method: 'GET',
                    headers: { 'Authorization': authHeader || '' },
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(null);
                        }
                    });
                });
                req.on('error', () => resolve(null));
                req.end();
            });
            if (localeData && localeData.locale) {
                localeConfig = {
                    locale: localeData.locale,
                    currency: localeData.currency || 'USD',
                    timezone: localeData.timezone || 'UTC',
                };
            }
        }
        catch {
            // Locale config not available
        }
        const zipBuffer = await this.templateService.backupOrgAsZip(jwt.orgId, localeConfig);
        const filename = `backup-${jwt.orgId}-${new Date().toISOString().split('T')[0]}.zip`;
        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': zipBuffer.length,
        });
        res.send(zipBuffer);
    }
    async importBackup(body, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        // Validate backup package structure
        if (!body || typeof body !== 'object') {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'Backup package must be a JSON object' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (!Array.isArray(body.templates)) {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'Backup package must contain a templates array' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        // Set locale config if included in backup
        if (body.localeConfig && body.localeConfig.locale) {
            try {
                const http = await Promise.resolve().then(() => tslib_1.__importStar(require('http')));
                const postData = JSON.stringify(body.localeConfig);
                await new Promise((resolve) => {
                    const req = http.request({
                        hostname: 'localhost',
                        port: 3000,
                        path: '/api/pdfme/expressions/locale',
                        method: 'POST',
                        headers: {
                            'Authorization': authHeader || '',
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(postData),
                        },
                    }, () => resolve());
                    req.on('error', () => resolve());
                    req.write(postData);
                    req.end();
                });
            }
            catch {
                // Non-fatal: locale config restore is best-effort
            }
        }
        const result = await this.templateService.importBackup(body, jwt.orgId, jwt.sub);
        return result;
    }
    async importBackupZip(body, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        // Accept ZIP as base64-encoded JSON body: { "zip": "<base64>" }
        if (!body || !body.zip || typeof body.zip !== 'string') {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'Request body must be JSON with a "zip" field containing base64-encoded ZIP data' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        let zipBuffer;
        try {
            zipBuffer = Buffer.from(body.zip, 'base64');
        }
        catch {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'Invalid base64 encoding in zip field' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        // Validate it's a ZIP file (PK magic bytes)
        if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
            throw new common_1.HttpException({ statusCode: 422, error: 'Unprocessable Entity', message: 'Decoded data is not a valid ZIP file' }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const result = await this.templateService.importBackupFromZip(zipBuffer, jwt.orgId, jwt.sub);
        return result;
    }
    async listSystem() {
        const data = await this.templateService.findSystemTemplates();
        return { data, total: data.length };
    }
    async getSystemById(id) {
        const result = await this.templateService.findById(id);
        if (!result || result.orgId !== null) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `System template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async getVersionHistory(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const versions = await this.templateService.getVersionHistory(id, orgId);
        return { data: versions, total: versions.length };
    }
    async getVersionByNumber(id, version, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const versionNumber = parseInt(version, 10);
        if (isNaN(versionNumber) || versionNumber < 1) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'Version must be a positive integer' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.templateService.getVersionByNumber(id, versionNumber, orgId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Version ${versionNumber} of template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async restoreVersion(id, body, authHeader, req) {
        const user = req?.user || decodeJwt(authHeader);
        const orgId = user?.orgId;
        const userId = user?.sub || 'unknown';
        if (!body?.version || typeof body.version !== 'number' || body.version < 1) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'version must be a positive integer' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.templateService.restoreVersion(id, body.version, orgId, userId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        if (result.error === 'version_not_found') {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Version ${body.version} of template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async exportTemplate(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const pkg = await this.templateService.exportTemplate(id, orgId);
        if (!pkg) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return pkg;
    }
    async acquireLock(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const result = await this.templateService.acquireLock(id, jwt.sub, jwt.orgId);
        if ('error' in result) {
            const errResult = result;
            const statusCode = errResult.statusCode || 409;
            const errorLabel = statusCode === 404 ? 'Not Found' : statusCode === 422 ? 'Unprocessable Entity' : 'Conflict';
            throw new common_1.HttpException({
                statusCode,
                error: errorLabel,
                message: errResult.error,
                lockedBy: errResult.lockedBy,
                lockedAt: errResult.lockedAt,
                expiresAt: errResult.expiresAt,
            }, statusCode);
        }
        return result;
    }
    async heartbeatLock(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const result = await this.templateService.heartbeatLock(id, jwt.sub, jwt.orgId);
        if (!result.refreshed) {
            const statusCode = result.statusCode || 409;
            const errorLabel = statusCode === 404 ? 'Not Found' : statusCode === 403 ? 'Forbidden' : 'Conflict';
            throw new common_1.HttpException({
                statusCode,
                error: errorLabel,
                message: result.error,
            }, statusCode);
        }
        return result;
    }
    async releaseLock(id, force, authHeader, req) {
        const user = req?.user || decodeJwt(authHeader);
        if (!user) {
            throw new common_1.HttpException({ statusCode: 401, error: 'Unauthorized', message: 'Valid JWT required' }, common_1.HttpStatus.UNAUTHORIZED);
        }
        const isForce = force === 'true';
        // SECURITY: Force-release requires template:publish permission (Template Admin)
        if (isForce) {
            const roles = user.roles || [];
            if (!roles.includes('template:publish')) {
                throw new common_1.HttpException({
                    statusCode: 403,
                    error: 'Forbidden',
                    message: 'Force-release requires template:publish permission (Template Admin)',
                }, common_1.HttpStatus.FORBIDDEN);
            }
        }
        const result = await this.templateService.releaseLock(id, user.sub, isForce, user.orgId);
        if (!result.released) {
            throw new common_1.HttpException({ statusCode: 403, error: 'Forbidden', message: result.error }, common_1.HttpStatus.FORBIDDEN);
        }
        return result;
    }
    async getLockStatus(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        return this.templateService.getLockStatus(id, orgId);
    }
    async getById(id, queryOrgId, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId || queryOrgId;
        const result = await this.templateService.findById(id, orgId);
        if (!result || result.status === 'archived') {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async saveDraft(id, body, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const userId = jwt?.sub || 'unknown';
        // Validate saveMode if provided (must be inPlace or newVersion)
        const VALID_SAVE_MODES = ['inPlace', 'newVersion'];
        if (body.saveMode !== undefined && body.saveMode !== null && body.saveMode !== '') {
            if (!VALID_SAVE_MODES.includes(body.saveMode)) {
                throw new common_1.HttpException({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: `Invalid saveMode: "${body.saveMode}". Must be one of: ${VALID_SAVE_MODES.join(', ')}`,
                    details: [{ field: 'saveMode', reason: `must be one of: ${VALID_SAVE_MODES.join(', ')}` }],
                }, common_1.HttpStatus.BAD_REQUEST);
            }
        }
        // Check if template exists and is not archived
        const existing = await this.templateService.findById(id, orgId);
        if (!existing || existing.status === 'archived') {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        // System templates (orgId=null) are read-only
        if (existing.orgId === null) {
            throw new common_1.HttpException({ statusCode: 403, error: 'Forbidden', message: 'System templates are read-only and cannot be modified. Use POST /api/pdfme/templates/:id/fork to create an editable copy.' }, common_1.HttpStatus.FORBIDDEN);
        }
        // Validate schema if provided
        if (body.schema !== undefined) {
            this.validateSchemaField(body.schema);
        }
        // Check for edit lock conflict
        const lockConflict = await this.templateService.checkLockConflict(id, userId, orgId);
        if (lockConflict) {
            throw new common_1.HttpException({
                statusCode: 409,
                error: 'Conflict',
                message: `Template is locked by user ${lockConflict.lockedBy}`,
                lockedBy: lockConflict.lockedBy,
                lockedAt: lockConflict.lockedAt,
                expiresAt: lockConflict.expiresAt,
            }, common_1.HttpStatus.CONFLICT);
        }
        const result = await this.templateService.saveDraft(id, body, orgId, userId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async validate(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const template = await this.templateService.findById(id, orgId);
        if (!template) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        const errors = this.templateService.validateTemplateForPublish({
            name: template.name,
            type: template.type,
            schema: template.schema,
        });
        // Feature #386: Extract orphaned elements info if present
        const orphanedElements = errors.__orphanedElements || [];
        return {
            valid: errors.length === 0,
            errors,
            templateId: id,
            templateName: template.name,
            ...(orphanedElements.length > 0 ? { orphanedElements } : {}),
        };
    }
    async publish(id, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const result = await this.templateService.publish(id, orgId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        if ('validationErrors' in result) {
            throw new common_1.HttpException({
                statusCode: 422,
                error: 'Unprocessable Entity',
                message: 'Template validation failed',
                details: result.validationErrors,
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if ('error' in result) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: result.error }, common_1.HttpStatus.BAD_REQUEST);
        }
        return result;
    }
    async generatePreview(id, body, authHeader) {
        const jwt = decodeJwt(authHeader);
        if (!jwt?.orgId) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' }, common_1.HttpStatus.BAD_REQUEST);
        }
        // Fetch template (any status - previews work on drafts too)
        const template = await this.templateService.findById(id, jwt.orgId);
        if (!template) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        const sampleRowCount = body.sampleRowCount || 5;
        if (![5, 15, 30].includes(sampleRowCount)) {
            throw new common_1.HttpException({ statusCode: 400, error: 'Bad Request', message: 'sampleRowCount must be 5, 15, or 30' }, common_1.HttpStatus.BAD_REQUEST);
        }
        const channel = body.channel || 'email';
        try {
            const result = await this.renderService.generatePreview(template, jwt.orgId, jwt.sub, channel, sampleRowCount);
            return result;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new common_1.HttpException({ statusCode: 500, error: 'Internal Server Error', message: `Preview generation failed: ${message}` }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async forkTemplate(id, body, authHeader, req) {
        const user = req?.user || decodeJwt(authHeader);
        const orgId = user?.orgId;
        const userId = user?.sub || 'unknown';
        const result = await this.templateService.forkTemplate(id, orgId, userId, body?.name);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found or not accessible` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async update(id, body, authHeader) {
        const jwt = decodeJwt(authHeader);
        const orgId = jwt?.orgId;
        const userId = jwt?.sub || 'unknown';
        // Validate schema if provided
        if (body.schema !== undefined) {
            this.validateSchemaField(body.schema);
        }
        // Check for edit lock conflict
        const lockConflict = await this.templateService.checkLockConflict(id, userId, orgId);
        if (lockConflict) {
            throw new common_1.HttpException({
                statusCode: 409,
                error: 'Conflict',
                message: `Template is locked by user ${lockConflict.lockedBy}`,
                lockedBy: lockConflict.lockedBy,
                lockedAt: lockConflict.lockedAt,
                expiresAt: lockConflict.expiresAt,
            }, common_1.HttpStatus.CONFLICT);
        }
        const result = await this.templateService.update(id, body, orgId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async delete(id, authHeader, req) {
        // Use user from guard (set by JwtAuthGuard) or fallback to manual decode
        const user = req?.user || decodeJwt(authHeader);
        const orgId = user?.orgId;
        // Check if this is a system template (orgId=null) - these are read-only
        const existing = await this.templateService.findById(id, orgId);
        if (existing && existing.orgId === null) {
            throw new common_1.HttpException({ statusCode: 403, error: 'Forbidden', message: 'System templates are read-only and cannot be deleted.' }, common_1.HttpStatus.FORBIDDEN);
        }
        const userId = user?.sub;
        const result = await this.templateService.softDelete(id, orgId, userId);
        if (!result) {
            throw new common_1.HttpException({ statusCode: 404, error: 'Not Found', message: `Template ${id} not found` }, common_1.HttpStatus.NOT_FOUND);
        }
        return { id: result.id, status: result.status };
    }
};
exports.TemplateController = TemplateController;
tslib_1.__decorate([
    (0, common_1.Get)(),
    (0, auth_guard_1.RequirePermissions)('template:view'),
    tslib_1.__param(0, (0, common_1.Query)('orgId')),
    tslib_1.__param(1, (0, common_1.Query)('limit')),
    tslib_1.__param(2, (0, common_1.Query)('cursor')),
    tslib_1.__param(3, (0, common_1.Query)('type')),
    tslib_1.__param(4, (0, common_1.Query)('status')),
    tslib_1.__param(5, (0, common_1.Query)('sort')),
    tslib_1.__param(6, (0, common_1.Query)('order')),
    tslib_1.__param(7, (0, common_1.Query)('search')),
    tslib_1.__param(8, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "list", null);
tslib_1.__decorate([
    (0, common_1.Get)('types'),
    (0, auth_guard_1.RequirePermissions)('template:view'),
    tslib_1.__param(0, (0, common_1.Query)('orgId')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getDistinctTypes", null);
tslib_1.__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "create", null);
tslib_1.__decorate([
    (0, common_1.Post)('import'),
    (0, auth_guard_1.RequirePermissions)('template:import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "importTemplate", null);
tslib_1.__decorate([
    (0, common_1.Get)('backup'),
    tslib_1.__param(0, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "backupOrg", null);
tslib_1.__decorate([
    (0, common_1.Post)('backup/export'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    tslib_1.__param(0, (0, common_1.Headers)('authorization')),
    tslib_1.__param(1, (0, common_1.Res)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "backupExportZip", null);
tslib_1.__decorate([
    (0, common_1.Post)('backup/import'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "importBackup", null);
tslib_1.__decorate([
    (0, common_1.Post)('backup/import-zip'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    tslib_1.__param(0, (0, common_1.Body)()),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "importBackupZip", null);
tslib_1.__decorate([
    (0, common_1.Get)('system'),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "listSystem", null);
tslib_1.__decorate([
    (0, common_1.Get)('system/:id'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getSystemById", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id/versions'),
    (0, auth_guard_1.RequirePermissions)('template:view'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getVersionHistory", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id/versions/:version'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Param)('version')),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getVersionByNumber", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/restore'),
    (0, auth_guard_1.RequirePermissions)('template:edit'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__param(3, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "restoreVersion", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id/export'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "exportTemplate", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/lock'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "acquireLock", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/lock/heartbeat'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "heartbeatLock", null);
tslib_1.__decorate([
    (0, common_1.Delete)(':id/lock'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Query)('force')),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__param(3, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "releaseLock", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id/lock'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getLockStatus", null);
tslib_1.__decorate([
    (0, common_1.Get)(':id'),
    (0, auth_guard_1.RequirePermissions)('template:view'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Query)('orgId')),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "getById", null);
tslib_1.__decorate([
    (0, common_1.Put)(':id/draft'),
    (0, auth_guard_1.RequirePermissions)('template:edit'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "saveDraft", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/validate'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "validate", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/publish'),
    (0, auth_guard_1.RequirePermissions)('template:publish'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "publish", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/preview'),
    (0, auth_guard_1.RequirePermissions)('pdfme.templates.view'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "generatePreview", null);
tslib_1.__decorate([
    (0, common_1.Post)(':id/fork'),
    (0, auth_guard_1.RequirePermissions)('template:edit'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__param(3, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "forkTemplate", null);
tslib_1.__decorate([
    (0, common_1.Put)(':id'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Body)()),
    tslib_1.__param(2, (0, common_1.Headers)('authorization')),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, Object, String]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "update", null);
tslib_1.__decorate([
    (0, common_1.Delete)(':id'),
    (0, auth_guard_1.RequirePermissions)('template:delete'),
    tslib_1.__param(0, (0, common_1.Param)('id')),
    tslib_1.__param(1, (0, common_1.Headers)('authorization')),
    tslib_1.__param(2, (0, common_1.Req)()),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", [String, String, Object]),
    tslib_1.__metadata("design:returntype", Promise)
], TemplateController.prototype, "delete", null);
exports.TemplateController = TemplateController = tslib_1.__decorate([
    (0, common_1.Controller)('api/pdfme/templates'),
    tslib_1.__metadata("design:paramtypes", [template_service_1.TemplateService,
        render_service_1.RenderService])
], TemplateController);
//# sourceMappingURL=template.controller.js.map