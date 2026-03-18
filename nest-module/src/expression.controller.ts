/**
 * ExpressionController - Expression evaluation endpoint
 *
 * POST /api/pdfme/expressions/evaluate
 * Evaluates an expression with the given context and optional locale config.
 * Used by the designer's "Test" button and for server-side expression evaluation.
 *
 * POST /api/pdfme/expressions/locale
 * Set or get the default locale configuration for the org.
 */

import { Controller, Post, Get, Body, BadRequestException, Req } from '@nestjs/common';
import { ExpressionEngine, ExpressionEngineOptions } from '../../packages/erp-schemas/src/expression-engine';

/** In-memory locale config per org (in production, this would be stored in DB) */
const orgLocaleConfigs: Map<string, { locale: string; currency: string; timezone: string }> = new Map();

@Controller('api/pdfme/expressions')
export class ExpressionController {
  @Post('evaluate')
  evaluate(@Body() body: {
    expression: string;
    context?: Record<string, unknown>;
    locale?: string;
    currency?: string;
    timezone?: string;
    onError?: 'emptyString' | '#ERROR' | 'fail';
  }, @Req() req: any) {
    if (!body.expression || typeof body.expression !== 'string') {
      throw new BadRequestException('expression is required and must be a string');
    }

    // Determine locale: explicit > org config > defaults
    const orgId = req.user?.orgId || '';
    const orgConfig = orgLocaleConfigs.get(orgId);
    const engineOptions: ExpressionEngineOptions = {
      locale: body.locale || orgConfig?.locale || 'en-US',
      currency: body.currency || orgConfig?.currency || 'USD',
      timezone: body.timezone || orgConfig?.timezone || 'UTC',
      onError: body.onError,
    };

    const engine = new ExpressionEngine(engineOptions);

    try {
      const result = engine.evaluate(body.expression, body.context || {});
      return {
        expression: body.expression,
        result,
        type: typeof result,
        locale: engineOptions.locale,
        currency: engineOptions.currency,
        timezone: engineOptions.timezone,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Expression error: ${message}`);
    }
  }

  /**
   * Set or get locale configuration for the current org.
   * POST body: { locale: 'en-ZA', currency: 'ZAR' }
   */
  @Post('locale')
  setLocale(@Body() body: { locale?: string; currency?: string; timezone?: string }, @Req() req: any) {
    const orgId = req.user?.orgId || '';

    if (!body.locale && !body.currency && !body.timezone) {
      throw new BadRequestException('At least one of locale, currency, or timezone is required');
    }

    const current = orgLocaleConfigs.get(orgId) || { locale: 'en-US', currency: 'USD', timezone: 'UTC' };

    if (body.locale) current.locale = body.locale;
    if (body.currency) current.currency = body.currency;
    if (body.timezone) current.timezone = body.timezone;

    orgLocaleConfigs.set(orgId, current);

    return {
      orgId,
      locale: current.locale,
      currency: current.currency,
      timezone: current.timezone,
      message: 'Locale config updated',
    };
  }

  /**
   * Get current locale configuration for the org.
   */
  @Get('locale')
  getLocale(@Req() req: any) {
    const orgId = req.user?.orgId || '';
    const config = orgLocaleConfigs.get(orgId) || { locale: 'en-US', currency: 'USD', timezone: 'UTC' };
    return {
      orgId,
      locale: config.locale,
      currency: config.currency,
      timezone: config.timezone,
    };
  }
}
