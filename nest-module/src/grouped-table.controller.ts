/**
 * GroupedTableController - REST endpoint for grouped table rendering
 *
 * Endpoints:
 * - POST /api/pdfme/grouped-table/render   - Render grouped table to structured output
 * - POST /api/pdfme/grouped-table/pdf      - Render grouped table to PDF via pdfme
 */

import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { GroupedTable } from '@pdfme-erp/schemas';
import type { GroupedTableConfig } from '@pdfme-erp/schemas';
import { createId } from '@paralleldrive/cuid2';
import { templates, generatedDocuments } from './db/schema';
import type { PdfmeDatabase } from './db/connection';
import { FileStorageService } from './file-storage.service';
import { HashService } from './hash.service';
import { eq, and } from 'drizzle-orm';

@Controller('api/pdfme/grouped-table')
export class GroupedTableController {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: PdfmeDatabase,
    @Inject('FILE_STORAGE') private readonly fileStorage: FileStorageService,
    private readonly hashService: HashService,
  ) {}

  /**
   * Render grouped table data into a structured row output.
   * Returns the rendered rows with group headers, data rows, subtotals, and grand total.
   */
  @Post('render')
  async renderGroupedTable(
    @Body() body: {
      columns: GroupedTableConfig['columns'];
      groupBy: string[];
      data: Record<string, unknown>[];
      showGroupHeaders?: boolean;
      showGroupFooters?: boolean;
      showGrandTotal?: boolean;
    },
    @Req() req: any,
  ) {
    if (!body.columns || !body.groupBy || !body.data) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'columns, groupBy, and data are required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (body.groupBy.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'groupBy must contain at least one field',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (body.groupBy.length > 3) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Maximum 3 levels of grouping supported',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const table = new GroupedTable({
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: `Grouped table render failed: ${message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Render grouped table data to a PDF document.
   * Creates a pdfme template with a table element and generates a PDF.
   */
  @Post('pdf')
  async renderGroupedTablePdf(
    @Body() body: {
      columns: GroupedTableConfig['columns'];
      groupBy: string[];
      data: Record<string, unknown>[];
      showGroupHeaders?: boolean;
      showGroupFooters?: boolean;
      showGrandTotal?: boolean;
      title?: string;
    },
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'orgId is required in JWT claims',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.columns || !body.groupBy || !body.data) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'columns, groupBy, and data are required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const table = new GroupedTable({
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
      const tableSchema: Record<string, unknown> = {
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
          alignment: Object.fromEntries(
            body.columns.map((col, i) => [i, col.align || 'left']),
          ),
        },
      };

      const schemaArray: Record<string, unknown>[] = [tableSchema];
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
      const bodyRows: string[][] = tableData.slice(1);
      const inputs: Record<string, string> = {
        groupedTable: JSON.stringify(bodyRows),
      };
      if (body.title) {
        inputs.title = body.title;
      }

      // Generate PDF
      const { generate } = await import('@pdfme/generator');
      const schemas = await import('@pdfme/schemas');

      const plugins = {
        text: schemas.text,
        table: schemas.table,
      };

      const pdfBuffer = await generate({
        template: pdfmeTemplate as any,
        inputs: [inputs],
        plugins,
      });

      // Store PDF
      const docId = createId();
      const pdfBuf = Buffer.from(pdfBuffer);
      const pdfHash = this.hashService.computeHash(pdfBuf);
      const filePath = `${user.orgId}/documents/grouped_${docId}.pdf`;
      await this.fileStorage.write(filePath, pdfBuf);

      // Create or find an ad-hoc grouped-table template for document records
      let adhocTemplateId: string;
      const existingTemplates = await this.db
        .select({ id: templates.id })
        .from(templates)
        .where(
          and(
            eq(templates.id, 'sys-grouped-table-adhoc'),
          ),
        );

      if (existingTemplates.length > 0) {
        adhocTemplateId = existingTemplates[0].id;
      } else {
        const [newTemplate] = await this.db
          .insert(templates)
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
        .insert(generatedDocuments)
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
          inputSnapshot: body as any,
        })
        .returning();

      return {
        document,
        summary: table.getSummary(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: `Grouped table PDF render failed: ${message}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
