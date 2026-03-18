/**
 * ExpressionController - Expression evaluation endpoint
 *
 * POST /api/pdfme/expressions/evaluate
 * Evaluates an expression with the given context.
 * Used by the designer's "Test" button and for server-side expression evaluation.
 */

import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ExpressionEngine } from '../../packages/erp-schemas/src/expression-engine';

@Controller('api/pdfme/expressions')
export class ExpressionController {
  private engine: ExpressionEngine;

  constructor() {
    this.engine = new ExpressionEngine();
  }

  @Post('evaluate')
  evaluate(@Body() body: { expression: string; context?: Record<string, unknown> }) {
    if (!body.expression || typeof body.expression !== 'string') {
      throw new BadRequestException('expression is required and must be a string');
    }

    try {
      const result = this.engine.evaluate(body.expression, body.context || {});
      return {
        expression: body.expression,
        result,
        type: typeof result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Expression error: ${message}`);
    }
  }
}
