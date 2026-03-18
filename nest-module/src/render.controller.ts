/**
 * RenderController - REST endpoints for PDF rendering
 *
 * Endpoints:
 * - POST   /api/pdfme/render/now       (synchronous render)
 */

import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RenderService, RenderNowDto } from './render.service';

@Controller('api/pdfme/render')
export class RenderController {
  constructor(private readonly renderService: RenderService) {}

  @Post('now')
  async renderNow(
    @Body() body: RenderNowDto,
    @Req() req: any,
  ) {
    if (!body.templateId || !body.entityId || !body.channel) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'templateId, entityId, and channel are required',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

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

    const result = await this.renderService.renderNow(
      body,
      user.orgId,
      user.sub,
    );

    if ('error' in result && !('document' in result)) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: result.error,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if ('error' in result && 'document' in result) {
      throw new HttpException(
        {
          statusCode: 500,
          error: 'Internal Server Error',
          message: result.error,
          document: result.document,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return result;
  }
}
