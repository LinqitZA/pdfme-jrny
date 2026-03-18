/**
 * SystemController - Administrative system operations
 *
 * POST /api/pdfme/system/seed - Re-seed system templates (requires system:seed permission)
 */

import { Controller, Post, HttpCode } from '@nestjs/common';
import { RequirePermissions } from './auth.guard';
import { SeedService } from './seeds/seed.service';

@Controller('api/pdfme/system')
export class SystemController {
  constructor(private readonly seedService: SeedService) {}

  /**
   * Trigger system template seeding.
   * Requires the 'system:seed' permission in the JWT roles array.
   */
  @Post('seed')
  @HttpCode(200)
  @RequirePermissions('system:seed')
  async seedSystemTemplates() {
    await this.seedService.seedSystemTemplates();
    return {
      success: true,
      message: 'System templates seeded successfully',
    };
  }
}
