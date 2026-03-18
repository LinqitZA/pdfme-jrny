/**
 * SystemController - Administrative system operations
 *
 * POST /api/pdfme/system/seed - Re-seed system templates (requires system:seed permission)
 * POST /api/pdfme/admin/seed - Seed comprehensive ERP test data (requires admin role)
 * GET  /api/pdfme/admin/seed/data - Get all seed datasets
 * GET  /api/pdfme/admin/seed/data/:templateType - Get seed data for a specific template type
 * GET  /api/pdfme/admin/seed/summary - Get summary of available seed data
 */

import { Controller, Post, Get, Param, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { RequirePermissions } from './auth.guard';
import { SeedService } from './seeds/seed.service';

@Controller('api/pdfme')
export class SystemController {
  constructor(private readonly seedService: SeedService) {}

  /**
   * Trigger system template seeding.
   * Requires the 'system:seed' permission in the JWT roles array.
   */
  @Post('system/seed')
  @HttpCode(200)
  @RequirePermissions('system:seed')
  async seedSystemTemplates() {
    await this.seedService.seedSystemTemplates();
    return {
      success: true,
      message: 'System templates seeded successfully',
    };
  }

  /**
   * Seed comprehensive ERP test data into the system.
   * Populates sample data for all template types.
   * Requires 'admin' role.
   */
  @Post('admin/seed')
  @HttpCode(200)
  @RequirePermissions('admin')
  async seedErpData() {
    const result = await this.seedService.seedSampleData();
    return {
      success: result.success,
      message: 'ERP seed data loaded successfully',
      summary: result.summary,
      templateTypes: Object.keys(result.sampleInputsByType),
    };
  }

  /**
   * Get all raw seed datasets for inspection.
   */
  @Get('admin/seed/data')
  @RequirePermissions('admin')
  getAllSeedData() {
    return {
      success: true,
      data: this.seedService.getAllSeedData(),
    };
  }

  /**
   * Get seed input data for a specific template type.
   * Useful for populating the designer preview.
   */
  @Get('admin/seed/data/:templateType')
  getSeedDataForType(@Param('templateType') templateType: string) {
    const inputs = this.seedService.getSeedInputsForType(templateType);
    if (!inputs || Object.keys(inputs).length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'Not Found',
          message: `No seed data available for template type: ${templateType}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      success: true,
      templateType,
      inputs,
    };
  }

  /**
   * Get summary of available seed data.
   */
  @Get('admin/seed/summary')
  getSeedSummary() {
    return {
      success: true,
      summary: this.seedService.getSeedSummary(),
    };
  }
}
