/**
 * Expression Engine
 *
 * Built on expr-eval (MIT) with custom extensions:
 * - Arithmetic with field references
 * - String: LEFT, RIGHT, MID, UPPER, LOWER, TRIM, CONCAT, LEN
 * - Conditional: IF (nested), AND, OR, NOT
 * - Date: FORMAT, DATEDIFF, TODAY, YEAR, MONTH, DAY
 * - Numeric: FORMAT, ROUND, ABS
 * - Locale-aware: FORMAT_CURRENCY, FORMAT_DATE, FORMAT_NUMBER
 * - Sandboxed: no Node.js globals, no require(), no eval()
 */

export class ExpressionEngine {
  // To be implemented by coding agents
  evaluate(_expression: string, _context: Record<string, unknown>): unknown {
    throw new Error('Not implemented');
  }
}
