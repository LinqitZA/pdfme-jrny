/**
 * OrgSettingsController - REST endpoints for per-org settings
 *
 * Endpoints:
 * - GET  /api/pdfme/org-settings         (get current org settings)
 * - PUT  /api/pdfme/org-settings         (update org settings)
 * - POST /api/pdfme/org-settings/reset   (reset to defaults)
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { OrgSettingsService, OrgSettings } from './org-settings.service';

@Controller('api/pdfme/org-settings')
export class OrgSettingsController {
  constructor(private readonly orgSettingsService: OrgSettingsService) {}

  @Get()
  getSettings(@Req() req: any) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const settings = this.orgSettingsService.get(user.orgId);
    return {
      orgId: user.orgId,
      settings,
    };
  }

  @Put()
  updateSettings(
    @Body() body: Partial<OrgSettings>,
    @Req() req: any,
  ) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate known boolean fields
    if (body.pdfUA !== undefined && typeof body.pdfUA !== 'boolean') {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'pdfUA must be a boolean' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (body.pdfA !== undefined && typeof body.pdfA !== 'boolean') {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'pdfA must be a boolean' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = this.orgSettingsService.update(user.orgId, body);
    return {
      orgId: user.orgId,
      settings: updated,
      message: 'Settings updated successfully',
    };
  }

  @Post('reset')
  resetSettings(@Req() req: any) {
    const user = req.user;
    if (!user?.orgId) {
      throw new HttpException(
        { statusCode: 400, error: 'Bad Request', message: 'orgId is required in JWT claims' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const settings = this.orgSettingsService.reset(user.orgId);
    return {
      orgId: user.orgId,
      settings,
      message: 'Settings reset to defaults',
    };
  }
}
