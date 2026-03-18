/**
 * DataSourceController - REST endpoints for DataSource registry management
 *
 * Endpoints:
 * - GET    /api/pdfme/datasources              (list registered types)
 * - GET    /api/pdfme/datasources/:type         (check if type is registered)
 * - POST   /api/pdfme/datasources/:type/resolve (resolve data for an entity via the registered DataSource)
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { DataSourceRegistry } from './datasource.registry';

@Controller('api/pdfme/datasources')
export class DataSourceController {
  constructor(private readonly registry: DataSourceRegistry) {}

  /**
   * List all registered DataSource template types.
   */
  @Get()
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
  @Get(':type')
  checkType(@Param('type') type: string) {
    if (!this.registry.has(type)) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: `No DataSource registered for template type "${type}"`,
          registeredTypes: this.registry.getRegisteredTypes(),
        },
        HttpStatus.NOT_FOUND,
      );
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
  @Post(':type/register-test')
  registerTestDataSource(
    @Param('type') type: string,
    @Body() body: { sampleData?: unknown[]; errorMessage?: string },
  ) {
    const sampleData = body.sampleData || [{ field1: 'value1' }];
    const errorMessage = body.errorMessage;

    this.registry.register({
      templateType: type,
      resolve: async (_entityId: string, _orgId: string) => {
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
  @Post(':type/unregister')
  unregisterDataSource(@Param('type') type: string) {
    const removed = this.registry.unregister(type);
    return { unregistered: removed, templateType: type };
  }

  /**
   * Resolve data for an entity using the registered DataSource.
   */
  @Post(':type/resolve')
  async resolveData(
    @Param('type') type: string,
    @Body() body: { entityId: string; params?: Record<string, unknown> },
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.entityId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'entityId is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let dataSource;
    try {
      dataSource = this.registry.resolve(type);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: msg,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      const data = await dataSource.resolve(body.entityId, user.orgId, body.params);
      return {
        templateType: type,
        entityId: body.entityId,
        data,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(
        { statusCode: 500, error: 'Internal Server Error', message: `DataSource resolve failed: ${msg}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
